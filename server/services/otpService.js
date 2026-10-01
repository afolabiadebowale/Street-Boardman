const crypto = require('crypto');
const prisma = require('../config/db');
const AppError = require('../utils/appError');
const password = require('../utils/password');
const smsProvider = require('./smsProvider');

const CODE_LENGTH = 6;
const EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;
// Applies per (phone, purpose): stops someone from spamming request after
// request for the same phone number, independent of the existing
// per-route authLimiter (which is per IP, not per phone).
const MIN_SECONDS_BETWEEN_REQUESTS = 30;

function generateCode() {
  // crypto.randomInt is cryptographically strong and avoids the modulo
  // bias a naive Math.random()-based digit generator would have.
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

// Creates a fresh OTP for (phone, purpose) and sends it. Refuses to issue
// a new one too soon after the last request for the same phone+purpose —
// this is what stops a single phone number being used to hammer the SMS
// provider (and run up its bill) even from many different IPs.
async function requestOtp(phone, purpose) {
  const recent = await prisma.otpCode.findFirst({
    where: { phone, purpose },
    orderBy: { createdAt: 'desc' },
  });
  if (recent && Date.now() - recent.createdAt.getTime() < MIN_SECONDS_BETWEEN_REQUESTS * 1000) {
    throw new AppError('Please wait before requesting another code', 429);
  }

  const code = generateCode();
  const codeHash = await password.hash(code);
  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000);

  await prisma.otpCode.create({
    data: { phone, purpose, codeHash, expiresAt },
  });
  await smsProvider.sendOtp(phone, code);

  return { expiresAt };
}

// Verifies a code against the latest unconsumed, unexpired OTP for
// (phone, purpose). Each wrong attempt increments a counter on that same
// row; after MAX_ATTEMPTS the row is dead even if the correct code is
// later supplied — a fresh requestOtp is required, so guessing has a hard
// ceiling per issued code, not per verify call.
async function verifyOtp(phone, purpose, code) {
  const record = await prisma.otpCode.findFirst({
    where: { phone, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!record) throw new AppError('No pending verification code for this phone', 400);
  if (record.expiresAt < new Date()) throw new AppError('Code has expired, request a new one', 400);
  if (record.attempts >= MAX_ATTEMPTS) {
    throw new AppError('Too many incorrect attempts, request a new code', 429);
  }

  const isValid = await password.compare(code, record.codeHash);
  if (!isValid) {
    await prisma.otpCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    throw new AppError('Incorrect code', 400);
  }

  await prisma.otpCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });

  if (purpose === 'SIGNUP') {
    await prisma.user.updateMany({ where: { phone }, data: { phoneVerifiedAt: new Date() } });
  }

  return { verified: true };
}

module.exports = { requestOtp, verifyOtp, MAX_ATTEMPTS, EXPIRY_MINUTES };
