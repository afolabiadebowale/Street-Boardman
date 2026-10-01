const crypto = require('crypto');

// otplib v13's default crypto/base32 plugins (@otplib/plugin-crypto-noble,
// @otplib/plugin-base32-scure) pull in @noble/hashes and @scure/base, which
// ship as ESM-only with no CJS build. Node's own require() bridges that
// transparently (Node 22.12+), but Jest's CJS-only module loader cannot
// parse their `export` syntax at all — so any test that imports otplib's
// top-level entrypoint fails immediately, unrelated to anything about MFA
// itself. These plugins reimplement the same interfaces (RFC 4648 base32,
// HMAC-SHA1/256/512) on top of Node's built-in crypto module, which is
// plain CJS everywhere (TASK-031).

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes, { padding = false } = {}) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  if (padding) {
    while (output.length % 8 !== 0) output += '=';
  }
  return output;
}

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid Base32 string: unexpected character ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

const base32Plugin = Object.freeze({
  name: 'node-base32',
  encode: base32Encode,
  decode: base32Decode,
});

const cryptoPlugin = Object.freeze({
  name: 'node-crypto',
  algorithms: Object.freeze(['sha1', 'sha256', 'sha512']),
  hmac(algorithm, key, message) {
    return crypto.createHmac(algorithm, Buffer.from(key)).update(Buffer.from(message)).digest();
  },
  randomBytes(size) {
    return crypto.randomBytes(size);
  },
  constantTimeEqual(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  },
});

module.exports = { base32Plugin, cryptoPlugin };
