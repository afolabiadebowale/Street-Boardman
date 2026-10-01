// otplib v13 dropped the old v12 `authenticator` singleton for standalone
// functions, AND its top-level entrypoint (and default crypto/base32
// plugins) pull in ESM-only packages that Jest can't load — see
// server/utils/totpPlugins.js. Importing @otplib/core, @otplib/totp and
// @otplib/uri directly (never the `otplib` package itself) avoids that
// entirely; these three sub-packages are plain CJS with no other deps.
const { generateSecret } = require('@otplib/core');
const { verify } = require('@otplib/totp');
const { generateTOTP } = require('@otplib/uri');
const { base32Plugin, cryptoPlugin } = require('../utils/totpPlugins');
const prisma = require('../config/db');
const AppError = require('../utils/appError');

const ISSUER = 'StreetBoardman';
const plugins = { crypto: cryptoPlugin, base32: base32Plugin };

// One step (30s) of tolerance either side absorbs phone clock drift,
// which is common on budget Android handsets. Safe only because of the
// single-use rule below — without it, tolerance would widen the replay
// window instead.
const EPOCH_TOLERANCE_SECONDS = 30;

// A correct code that was already used gets its own message: "Incorrect
// code" would send someone who just typed the right digits hunting for a
// typo, when the fix is to wait for their app to show the next code.
const CODE_ALREADY_USED = 'This code has already been used. Wait for the next one in your authenticator app.';

// Verifies a code and, if valid, atomically marks its time step as used.
// The conditional update is what makes each code single-use: a replay of
// the same code (or two concurrent logins racing with it) finds the step
// already consumed and matches zero rows. Returns false for a wrong code;
// throws for a right-but-used one.
async function consumeToken(user, token, extraData = {}) {
  const result = await verify({ secret: user.mfaSecret, token, epochTolerance: EPOCH_TOLERANCE_SECONDS, ...plugins });
  if (!result.valid) return false;
  const { count } = await prisma.user.updateMany({
    where: {
      id: user.id,
      mfaSecret: user.mfaSecret,
      OR: [{ mfaLastTimeStep: null }, { mfaLastTimeStep: { lt: result.timeStep } }],
    },
    data: { mfaLastTimeStep: result.timeStep, ...extraData },
  });
  if (count !== 1) throw new AppError(CODE_ALREADY_USED, 400);
  return true;
}

// Starts enrollment: generates a new TOTP secret and stores it, but does
// NOT enable MFA yet (mfaEnabledAt stays null) until confirmSetup proves
// the user actually scanned it into a real authenticator app (TASK-031).
// Calling this again before confirming just replaces the pending secret —
// harmless, since nothing was enabled with the old one yet.
async function startSetup(userId) {
  const secret = generateSecret({ length: 20, ...plugins });
  const user = await prisma.user.update({
    where: { id: userId },
    data: { mfaSecret: secret, mfaLastTimeStep: null },
  });
  const otpauthUrl = generateTOTP({ issuer: ISSUER, label: user.phone, secret });
  return { secret, otpauthUrl };
}

// Confirms enrollment with a real code from the authenticator app. Only
// after this succeeds does mfaEnabledAt get set — this is what stops
// startSetup alone (e.g. an attacker with a stolen session hitting the
// endpoint) from silently enabling MFA with a secret the real user never
// saw.
async function confirmSetup(userId, token) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.mfaSecret) {
    throw new AppError('No MFA enrollment in progress — call the setup endpoint first', 400);
  }
  // Consumes the setup code too, so it can't be reused to log in.
  // tokenVersion bump logs out every other session (see authController).
  const isValid = await consumeToken(user, token, { mfaEnabledAt: new Date(), tokenVersion: { increment: 1 } });
  if (!isValid) throw new AppError('Incorrect code', 400);
  return { enabled: true };
}

// Verifies a code against an ALREADY-enabled secret — this is what login
// calls, not confirmSetup (TASK-031's actual login gate).
async function verifyToken(userId, token) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.mfaEnabledAt || !user.mfaSecret) {
    throw new AppError('MFA is not enabled for this account', 400);
  }
  return consumeToken(user, token);
}

// Requires a valid current code to turn MFA back off — never a bare
// toggle, since that would defeat the point of a second factor.
async function disableMfa(userId, token) {
  const isValid = await verifyToken(userId, token);
  if (!isValid) throw new AppError('Incorrect code', 400, 'INCORRECT_CODE');
  await prisma.user.update({
    where: { id: userId },
    data: { mfaSecret: null, mfaEnabledAt: null, mfaLastTimeStep: null, tokenVersion: { increment: 1 } },
  });
  return { enabled: false };
}

module.exports = { startSetup, confirmSetup, verifyToken, disableMfa };
