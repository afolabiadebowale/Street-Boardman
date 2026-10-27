const crypto = require('crypto');
const prisma = require('../config/db');
const AppError = require('../utils/appError');
const storage = require('./storage/localDisk');

// Result evidence photos (FEAT-042). Uploads are hostile input until
// proven otherwise:
// - the type comes from the file's own first bytes, never the client's
//   Content-Type, and only JPEG and PNG are accepted (no SVG/HTML, which a
//   browser could run as script);
// - metadata is stripped before storing: phone photos carry GPS location
//   and device details in EXIF, and evidence is shown to other users;
// - names are random UUIDs, so nothing about the file comes from the user.
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = {
  jpg: { contentType: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  png: { contentType: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
};

function detectType(buffer) {
  return Object.keys(TYPES).find((ext) => TYPES[ext].magic.every((byte, i) => buffer[i] === byte)) || null;
}

// JPEG: drop APP1 (EXIF/XMP), APP13 (Photoshop/IPTC) and comment segments
// before the image data; everything from start-of-scan on is copied as is.
function stripJpeg(buffer) {
  const out = [buffer.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buffer.length) {
    if (buffer[i] !== 0xff) throw new AppError('This JPEG is damaged', 422);
    const marker = buffer[i + 1];
    if (marker === 0xda) {
      out.push(buffer.subarray(i)); // start of scan: the rest is image data
      return Buffer.concat(out);
    }
    const length = buffer.readUInt16BE(i + 2);
    const segment = buffer.subarray(i, i + 2 + length);
    if (segment.length < 2 + length) throw new AppError('This JPEG is damaged', 422);
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) out.push(segment);
    i += 2 + length;
  }
  throw new AppError('This JPEG is damaged', 422);
}

// PNG: drop the text and EXIF chunks; image chunks pass through untouched
// (each carries its own CRC, so removing others keeps the file valid).
const PNG_METADATA = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
function stripPng(buffer) {
  const out = [buffer.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(i);
    const type = buffer.toString('latin1', i + 4, i + 8);
    const chunk = buffer.subarray(i, i + 12 + length);
    if (chunk.length < 12 + length) throw new AppError('This PNG is damaged', 422);
    if (!PNG_METADATA.has(type)) out.push(chunk);
    i += 12 + length;
    if (type === 'IEND') return Buffer.concat(out);
  }
  throw new AppError('This PNG is damaged', 422);
}

async function saveEvidence(userId, body) {
  // express.raw gives a Buffer; a JSON body could be an object, array or
  // string. Only a non-empty Buffer goes further.
  if (typeof body === 'string' || Array.isArray(body) || !Buffer.isBuffer(body) || body.length === 0) {
    throw new AppError('Send the photo as the request body (Content-Type image/jpeg or image/png)', 422);
  }
  const buffer = Buffer.from(body);
  if (buffer.length > MAX_BYTES) throw new AppError('Photos can be at most 5 MB', 413);
  const ext = detectType(buffer);
  if (!ext) throw new AppError('Only JPEG and PNG photos are accepted', 415);

  const clean = ext === 'jpg' ? stripJpeg(buffer) : stripPng(buffer);
  const id = crypto.randomUUID();
  await storage.put(`${id}.${ext}`, clean);
  return prisma.upload.create({
    data: { id, ownerUserId: userId, purpose: 'RESULT_EVIDENCE', contentType: TYPES[ext].contentType, sizeBytes: clean.length },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function readEvidence(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new AppError('Not found', 404);
  const upload = await prisma.upload.findUnique({ where: { id } });
  if (!upload) throw new AppError('Not found', 404);
  const ext = upload.contentType === 'image/png' ? 'png' : 'jpg';
  // The storage key comes from our own record, never the URL.
  const bytes = await storage.get(`${upload.id}.${ext}`);
  if (!bytes) throw new AppError('Not found', 404);
  return { contentType: upload.contentType, bytes };
}

const evidencePath = (id) => `/api/uploads/evidence/${id}`;

const ABANDONED_AFTER_DAYS = 7;
const PURGE_BATCH = 500;

// Photos uploaded but never attached to a result within a week (A5): the
// result was never submitted, or other photos were used. They'd otherwise
// fill the server's disk forever. The row is deleted first, conditionally
// on still being unattached, and only then the file: if a result attaches
// the photo at the same moment, exactly one of the two wins, and a result
// can never point at a deleted file.
async function purgeAbandoned({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - ABANDONED_AFTER_DAYS * 24 * 3600 * 1000);
  const candidates = await prisma.upload.findMany({
    where: { attachedToResultId: null, createdAt: { lt: cutoff } },
    take: PURGE_BATCH,
  });
  let purged = 0;
  for (const upload of candidates) {
    const claim = await prisma.upload.deleteMany({ where: { id: upload.id, attachedToResultId: null } });
    if (claim.count === 0) continue; // attached meanwhile: keep it
    await storage.remove(`${upload.id}.${upload.contentType === 'image/png' ? 'png' : 'jpg'}`);
    purged += 1;
  }
  return { purged };
}

// Inside the result's transaction: the uploads must be the Boardman's own
// and not already used; claiming them is a conditional update, so two
// results can't share a photo.
async function attachToResult(tx, uploadIds, ownerUserId, resultId) {
  if (!uploadIds || uploadIds.length === 0) return [];
  const unique = [...new Set(uploadIds)];
  const claim = await tx.upload.updateMany({
    where: { id: { in: unique }, ownerUserId, purpose: 'RESULT_EVIDENCE', attachedToResultId: null },
    data: { attachedToResultId: resultId },
  });
  if (claim.count !== unique.length) {
    throw new AppError('Attach only photos you uploaded yourself that are not already on a result', 422);
  }
  return unique.map(evidencePath);
}

module.exports = { purgeAbandoned, ABANDONED_AFTER_DAYS, saveEvidence, readEvidence, attachToResult, evidencePath, detectType, stripJpeg, stripPng, MAX_BYTES };
