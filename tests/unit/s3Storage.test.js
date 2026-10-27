// S3 upload storage (B1), against an in-memory stand-in for S3: no AWS
// account or network involved.
jest.mock('../../server/config/db', () => ({
  upload: { create: jest.fn(async ({ data }) => data), findUnique: jest.fn() },
}));

const env = require('../../server/config/env');
const s3Storage = require('../../server/services/storage/s3');
const prisma = require('../../server/config/db');
const uploadService = require('../../server/services/uploadService');

const KEY = '8f14e45f-ceea-467a-9575-6e8e3c6b0b7d.jpg';

function fakeS3() {
  const objects = new Map();
  const sent = [];
  return {
    objects,
    sent,
    send: jest.fn(async (command) => {
      const name = command.constructor.name;
      const input = command.input;
      sent.push({ name, input });
      if (name === 'PutObjectCommand') {
        if (input.IfNoneMatch === '*' && objects.has(input.Key)) {
          throw Object.assign(new Error('exists'), { name: 'PreconditionFailed' });
        }
        objects.set(input.Key, Buffer.from(input.Body));
        return {};
      }
      if (name === 'GetObjectCommand') {
        if (!objects.has(input.Key)) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
        const body = objects.get(input.Key);
        return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
      }
      if (name === 'DeleteObjectCommand') {
        objects.delete(input.Key);
        return {};
      }
      throw new Error(`unexpected ${name}`);
    }),
  };
}

let original;
let fake;

beforeEach(() => {
  original = { ...env.uploads };
  env.uploads.driver = 's3';
  env.uploads.s3Bucket = 'sb-test-uploads';
  fake = fakeS3();
  s3Storage._setClient(fake);
});

afterEach(() => {
  Object.assign(env.uploads, original);
});

describe('S3 storage (B1)', () => {
  it('stores under evidence/, with the content type, never overwriting', async () => {
    await s3Storage.put(KEY, Buffer.from('photo'), { contentType: 'image/jpeg' });
    expect(fake.sent[0]).toEqual({
      name: 'PutObjectCommand',
      input: expect.objectContaining({ Bucket: 'sb-test-uploads', Key: `evidence/${KEY}`, ContentType: 'image/jpeg', IfNoneMatch: '*' }),
    });
    await expect(s3Storage.put(KEY, Buffer.from('other'))).rejects.toThrow();
    expect((await s3Storage.get(KEY)).toString()).toBe('photo');
  });

  it('returns null for a missing object and deletes idempotently', async () => {
    expect(await s3Storage.get(KEY)).toBeNull();
    await s3Storage.put(KEY, Buffer.from('photo'));
    await s3Storage.remove(KEY);
    await s3Storage.remove(KEY);
    expect(await s3Storage.get(KEY)).toBeNull();
  });

  it('refuses keys that did not come from the upload service', async () => {
    for (const bad of ['../etc/passwd', 'evidence/x.jpg', 'abc.svg']) {
      await expect(s3Storage.put(bad, Buffer.from('x'))).rejects.toThrow(/unsafe storage key/);
    }
    expect(fake.send).not.toHaveBeenCalled();
  });

  it('is what the upload service uses when UPLOAD_STORAGE=s3', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0xaa, 0xff, 0xd9]);
    const saved = await uploadService.saveEvidence('user-1', jpeg);
    expect(fake.objects.has(`evidence/${saved.id}.jpg`)).toBe(true);

    prisma.upload.findUnique.mockResolvedValueOnce({ id: saved.id, contentType: 'image/jpeg' });
    const { bytes, contentType } = await uploadService.readEvidence(saved.id);
    expect(contentType).toBe('image/jpeg');
    expect(Buffer.compare(bytes, jpeg)).toBe(0);
  });
});
