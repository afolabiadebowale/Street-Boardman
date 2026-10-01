const jwt = require('jsonwebtoken');
const env = require('../config/env');

// `tv` is the account's tokenVersion at issue time. Bumping the column
// (logout, MFA change) makes every token issued before it invalid,
// because requireAuth and /refresh compare the two (ASVS 3.3.1).
function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, tv: user.tokenVersion }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessTtl,
  });
}

// `at` is when the user actually authenticated (PIN, plus code if MFA).
// It's carried forward unchanged through every refresh, so rotating the
// refresh token can't extend a session forever (ASVS 3.3.2).
function signRefreshToken(user, authTime = Math.floor(Date.now() / 1000)) {
  return jwt.sign({ sub: user.id, tv: user.tokenVersion, at: authTime }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshTtl,
  });
}

// Staff can move money and change other accounts: re-login at least
// every 12 hours. Bettors and Boardmen get 30 days — a phone-first
// consumer app where a daily PIN prompt would push people to weaker habits.
const MAX_SESSION_SECONDS = { ADMIN: 12 * 60 * 60, DEFAULT: 30 * 24 * 60 * 60 };

function isWithinMaxSessionAge(payload, user) {
  if (typeof payload.at !== 'number') return false;
  const limit = MAX_SESSION_SECONDS[user.role] || MAX_SESSION_SECONDS.DEFAULT;
  return Math.floor(Date.now() / 1000) - payload.at <= limit;
}

function isCurrentTokenVersion(payload, user) {
  return payload.tv === user.tokenVersion;
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}

// Proves only "phone/PIN were correct" — signed with a separate secret from
// the real session tokens so it can never be presented to requireAuth as a
// substitute for completing the MFA step (TASK-031).
function signMfaChallengeToken(user) {
  return jwt.sign({ sub: user.id, purpose: 'mfa_challenge' }, env.jwt.mfaChallengeSecret, {
    expiresIn: env.jwt.mfaChallengeTtl,
  });
}

function verifyMfaChallengeToken(token) {
  const payload = jwt.verify(token, env.jwt.mfaChallengeSecret);
  if (payload.purpose !== 'mfa_challenge') throw new Error('Invalid token purpose');
  return payload;
}

module.exports = {
  isCurrentTokenVersion,
  isWithinMaxSessionAge,
  MAX_SESSION_SECONDS,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  signMfaChallengeToken,
  verifyMfaChallengeToken,
};
