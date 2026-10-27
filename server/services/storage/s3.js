const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const env = require('../../config/env');

// Upload storage in S3 (B1): what AWS needs, where several API tasks share
// no disk. Same put/get/remove interface as localDisk. Credentials come
// from the ECS task role through the SDK's default chain; nothing is
// configured in the app. Keys are server-generated and checked the same
// way as on disk.
const SAFE_KEY = /^[0-9a-f-]{36}\.(jpg|png)$/;
const PREFIX = 'evidence/';
let client;

function s3() {
  if (!client) client = new S3Client({ region: env.uploads.s3Region });
  return client;
}

function objectKey(key) {
  if (!SAFE_KEY.test(key)) throw new Error(`Refusing unsafe storage key: ${key}`);
  return PREFIX + key;
}

async function put(key, buffer, { contentType } = {}) {
  await s3().send(
    new PutObjectCommand({
      Bucket: env.uploads.s3Bucket,
      Key: objectKey(key),
      Body: buffer,
      ContentType: contentType,
      IfNoneMatch: '*', // never overwrite, like the disk store's 'wx'
    })
  );
}

async function get(key) {
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: env.uploads.s3Bucket, Key: objectKey(key) }));
    return Buffer.from(await out.Body.transformToByteArray());
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

// S3 deletes are idempotent: a missing object is not an error.
async function remove(key) {
  await s3().send(new DeleteObjectCommand({ Bucket: env.uploads.s3Bucket, Key: objectKey(key) }));
}

module.exports = { put, get, remove, _setClient: (c) => { client = c; } };
