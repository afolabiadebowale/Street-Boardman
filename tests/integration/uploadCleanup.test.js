// Evidence photos never attached to a result within a week are deleted
// (A5), so the server's disk doesn't fill with abandoned uploads.
const fs = require('fs');
const os = require('os');
const path = require('path');
const env = require('../../server/config/env');
const { resetDatabase, prisma } = require('../helpers/reset');
const uploadService = require('../../server/services/uploadService');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0xaa, 0xff, 0xd9]);
let originalDir;
let dir;

beforeAll(() => {
  originalDir = env.uploads.dir;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cleanup-'));
  env.uploads.dir = dir;
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  env.uploads.dir = originalDir;
  fs.rmSync(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

const exists = (id) => fs.existsSync(path.join(dir, `${id}.jpg`));
const daysAgo = (n) => new Date(Date.now() - n * 24 * 3600 * 1000);

describe('Abandoned upload cleanup (A5)', () => {
  it('deletes week-old unattached photos (row and file) and keeps attached or recent ones', async () => {
    const user = await prisma.user.create({ data: { role: 'BOARDMAN', fullName: 'B', phone: '08099990001', passwordHash: 'x' } });
    const abandoned = await uploadService.saveEvidence(user.id, JPEG);
    const attached = await uploadService.saveEvidence(user.id, JPEG);
    const recent = await uploadService.saveEvidence(user.id, JPEG);
    await prisma.upload.updateMany({ where: { id: { in: [abandoned.id, attached.id] } }, data: { createdAt: daysAgo(8) } });
    await prisma.upload.update({ where: { id: recent.id }, data: { createdAt: daysAgo(6) } });
    await prisma.upload.update({ where: { id: attached.id }, data: { attachedToResultId: 'some-result' } });

    expect(await uploadService.purgeAbandoned()).toEqual({ purged: 1 });

    expect(await prisma.upload.findUnique({ where: { id: abandoned.id } })).toBeNull();
    expect(exists(abandoned.id)).toBe(false);
    expect(exists(attached.id) && exists(recent.id)).toBe(true);
    expect(await prisma.upload.count()).toBe(2);
  });

  it('keeps a photo that gets attached between being picked and being deleted', async () => {
    const user = await prisma.user.create({ data: { role: 'BOARDMAN', fullName: 'B', phone: '08099990002', passwordHash: 'x' } });
    const upload = await uploadService.saveEvidence(user.id, JPEG);
    await prisma.upload.update({ where: { id: upload.id }, data: { createdAt: daysAgo(8) } });

    // Attach it right after the purge has listed it as a candidate.
    const findMany = prisma.upload.findMany.bind(prisma.upload);
    const spy = jest.spyOn(prisma.upload, 'findMany').mockImplementationOnce(async (args) => {
      const rows = await findMany(args);
      await prisma.upload.update({ where: { id: upload.id }, data: { attachedToResultId: 'just-now' } });
      return rows;
    });
    expect(await uploadService.purgeAbandoned()).toEqual({ purged: 0 });
    spy.mockRestore();

    expect(exists(upload.id)).toBe(true);
    expect((await prisma.upload.findUnique({ where: { id: upload.id } })).attachedToResultId).toBe('just-now');
  });

  it('copes with a file that is already gone', async () => {
    const user = await prisma.user.create({ data: { role: 'BOARDMAN', fullName: 'B', phone: '08099990003', passwordHash: 'x' } });
    const upload = await uploadService.saveEvidence(user.id, JPEG);
    await prisma.upload.update({ where: { id: upload.id }, data: { createdAt: daysAgo(30) } });
    fs.unlinkSync(path.join(dir, `${upload.id}.jpg`));

    expect(await uploadService.purgeAbandoned()).toEqual({ purged: 1 });
    expect(await prisma.upload.count()).toBe(0);
  });
});
