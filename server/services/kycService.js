const crypto = require('crypto');
const prisma = require('../config/db');
const AppError = require('../utils/appError');
const kycProvider = require('./kycProvider');

// BVN/NIN values are never stored in plaintext — a fast, keyless SHA-256
// digest is enough here (unlike passwords/OTPs, this isn't a secret an
// attacker would brute-force against this table alone; it's the same
// input the KYC provider itself would look up, and we never re-derive or
// compare it locally — just record what was checked).
function hashIdentityValue(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const MIN_AGE_YEARS = 18;

function calculateAge(dateOfBirth) {
  const now = new Date();
  let age = now.getFullYear() - dateOfBirth.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > dateOfBirth.getMonth() ||
    (now.getMonth() === dateOfBirth.getMonth() && now.getDate() >= dateOfBirth.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

// Verifies a BVN or NIN against the (stubbed, see kycProvider.js) provider
// and records the attempt either way. A match upgrades the user to TIER_1
// — UNLESS the provider's own date of birth shows they're under 18
// (TASK-028), in which case the match is recorded but the tier stays at
// TIER_0 and no amount of retrying with the same or a different real ID
// changes that outcome; this is a genuine, not a soft, rejection. There's
// no separate "review" state in this MVP; a real provider integration
// would likely also check the returned name matches the account's
// fullName, which the stub doesn't yet model.
async function verifyBvnOrNin(userId, { idType, value }) {
  if (!['BVN', 'NIN'].includes(idType)) {
    throw new AppError('idType must be BVN or NIN', 422);
  }

  const { matched, dateOfBirth, provider } = await kycProvider.verifyIdentity({ idType, value });
  const underage = matched && dateOfBirth ? calculateAge(dateOfBirth) < MIN_AGE_YEARS : false;

  await prisma.kycVerification.create({
    data: {
      userId,
      idType,
      valueHash: hashIdentityValue(value),
      matched,
      dateOfBirth: dateOfBirth ?? undefined,
      underage,
      provider,
    },
  });

  const upgrades = matched && !underage;
  if (upgrades) {
    await prisma.user.update({ where: { id: userId }, data: { kycTier: 'TIER_1' } });
  }

  return { matched, underage, kycTier: upgrades ? 'TIER_1' : 'TIER_0' };
}

module.exports = { verifyBvnOrNin };
