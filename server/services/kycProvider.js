const AppError = require('../utils/appError');
const env = require('../config/env');

// Stands in for a real BVN/NIN verification provider (Smile ID, Dojah,
// Prembly or Youverify, per the implementation plan) until one is wired
// up with real credentials — same stub pattern as smsProvider.js
// (TASK-025) and withdrawalService.transferFunds (TASK-003).
//
// DEMO mode simulates a real provider deterministically rather than
// always succeeding, so both the mismatch and under-18 paths are
// actually testable, not just the happy path:
//   - a value of 11 repeated zeros ('00000000000') simulates a no-match
//   - a value of 11 repeated twos ('22222222222') simulates a match with
//     a date of birth under 18 years ago
//   - anything else simulates a match with a plausible adult date of birth
// dateOfBirth here stands in for what a real provider returns as part of
// a successful lookup (TASK-028) — never self-reported by the user, since
// that would be trivially fakeable. PRODUCTION throws until a real
// provider is configured.
async function verifyIdentity({ idType, value }) {
  if (env.appMode === 'PRODUCTION') {
    throw new AppError(
      'No KYC verification provider is configured (see FEAT-015) — cannot verify identity',
      501
    );
  }
  if (value === '00000000000') {
    return { matched: false, dateOfBirth: null, provider: 'demo-stub', idType };
  }
  const now = new Date();
  const yearsAgo = value === '22222222222' ? 10 : 30;
  const dateOfBirth = new Date(now.getFullYear() - yearsAgo, now.getMonth(), now.getDate());
  return { matched: true, dateOfBirth, provider: 'demo-stub', idType };
}

module.exports = { verifyIdentity };
