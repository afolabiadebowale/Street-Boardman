const asyncHandler = require('../utils/asyncHandler');
const authService = require('../services/authService');
const deviceService = require('../services/deviceService');
const mfaService = require('../services/mfaService');
const staffSecurityService = require('../services/staffSecurityService');
const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  signMfaChallengeToken,
  verifyMfaChallengeToken,
  isCurrentTokenVersion,
  isWithinMaxSessionAge,
} = require('../utils/jwt');
const { COOKIE_NAMES } = require('../config/constants');
const env = require('../config/env');
const prisma = require('../config/db');
const AppError = require('../utils/appError');

// Derived centrally in config/env.js (TASK-032) — secure/sameSite need to
// stay coupled (SameSite=None without Secure gets silently dropped by
// browsers), so that logic lives in one place, not duplicated here.
const cookieOptions = {
  httpOnly: true,
  secure: env.cookies.secure,
  sameSite: env.cookies.sameSite,
};

// authTime defaults to now (a fresh login); /refresh passes the original.
function issueSession(res, user, authTime) {
  res.cookie(COOKIE_NAMES.ACCESS, signAccessToken(user), {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie(COOKIE_NAMES.REFRESH, signRefreshToken(user, authTime), {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function toPublicUser(user) {
  return {
    id: user.id,
    role: user.role,
    fullName: user.fullName,
    phone: user.phone,
    status: user.status,
    phoneVerifiedAt: user.phoneVerifiedAt,
    kycTier: user.kycTier,
    // Status only — the TOTP secret itself never leaves the server.
    mfaEnabled: Boolean(user.mfaEnabledAt),
    staffSecurity: staffSecurityService.statusFor(user),
  };
}

const registerBetter = asyncHandler(async (req, res) => {
  const fingerprint = deviceService.computeFingerprint(req);
  const user = await authService.registerBetter(req.body, fingerprint);
  issueSession(res, user);
  res.status(201).json({ user: toPublicUser(user) });
});

const registerBoardman = asyncHandler(async (req, res) => {
  const fingerprint = deviceService.computeFingerprint(req);
  const user = await authService.registerBoardman(req.body, fingerprint);
  issueSession(res, user);
  res.status(201).json({
    user: toPublicUser(user),
    message: 'Registered. Your account is pending Admin approval before you can run real competitions.',
  });
});

// Accounts without MFA enabled (the seeded admin, every Better/Boardman,
// any admin who hasn't completed enrollment yet) keep the existing
// single-step login — MFA is mandatory only from the moment an admin
// finishes setup, not retroactively forced on every staff account
// (TASK-031).
const login = asyncHandler(async (req, res) => {
  const user = await authService.login(req.body);

  if (user.mfaEnabledAt) {
    const mfaToken = signMfaChallengeToken(user);
    return res.json({ mfaRequired: true, mfaToken });
  }

  issueSession(res, user);
  res.json({ user: toPublicUser(user) });
});

const mfaVerify = asyncHandler(async (req, res) => {
  const { mfaToken, code } = req.body;
  if (!mfaToken || !code) throw new AppError('mfaToken and code are required', 400);

  let payload;
  try {
    payload = verifyMfaChallengeToken(mfaToken);
  } catch (err) {
    throw new AppError('MFA challenge expired, please log in again', 401);
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.mfaEnabledAt) throw new AppError('MFA challenge expired, please log in again', 401);
  if (user.status === 'SUSPENDED') throw new AppError('Account suspended, contact support', 403);
  // Wrong codes share the PIN's lockout budget — the PIN step already
  // passed, so guessing codes is what an attacker holding a stolen PIN
  // would be doing.
  authService.assertNotLocked(user);

  const isValid = await mfaService.verifyToken(user.id, code);
  if (!isValid) {
    await authService.recordFailedAttempt(user.id);
    throw new AppError('Incorrect code', 400);
  }
  await authService.clearFailedAttempts(user);

  issueSession(res, user);
  res.json({ user: toPublicUser(user) });
});

// Turning MFA on or off bumps tokenVersion, which logs out every other
// device (a stolen session shouldn't survive the owner securing their
// account). The device making the change gets fresh cookies so it stays in.
async function reissueForCurrentDevice(res, userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  issueSession(res, user);
}

const mfaSetupStart = asyncHandler(async (req, res) => {
  const { secret, otpauthUrl } = await mfaService.startSetup(req.user.id);
  res.json({ secret, otpauthUrl });
});

const mfaSetupConfirm = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) throw new AppError('code is required', 400);
  const result = await mfaService.confirmSetup(req.user.id, code);
  await reissueForCurrentDevice(res, req.user.id);
  res.json(result);
});

const mfaDisable = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) throw new AppError('code is required', 400);
  // Turning MFA off is exactly what someone holding a stolen session would
  // want, so wrong codes here burn the same lockout budget as login.
  authService.assertNotLocked(req.user);
  let result;
  try {
    result = await mfaService.disableMfa(req.user.id, code);
  } catch (err) {
    if (err.code === 'INCORRECT_CODE') await authService.recordFailedAttempt(req.user.id);
    throw err;
  }
  await authService.clearFailedAttempts(req.user);
  await reissueForCurrentDevice(res, req.user.id);
  res.json(result);
});

// Every other device is signed out (tokenVersion bump); this one gets
// fresh cookies and stays in.
const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(req.user.id, req.body.currentPassword, req.body.newPassword);
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  issueSession(res, user);
  res.json({ user: toPublicUser(user) });
});

function userIdFromSessionCookies(req) {
  const attempts = [
    [req.cookies?.[COOKIE_NAMES.REFRESH], verifyRefreshToken],
    [req.cookies?.[COOKIE_NAMES.ACCESS], verifyAccessToken],
  ];
  for (const [token, verify] of attempts) {
    try {
      return verify(token).sub;
    } catch {
      // missing, expired or tampered — try the other cookie
    }
  }
  return null;
}

// Clearing cookies alone left the refresh token valid for up to 7 days —
// anyone who had copied it could keep using the account after the owner
// logged out (ASVS 3.3.1). Bumping tokenVersion revokes it server-side.
// This signs out every device for the account, which for a money app is
// the safer default.
const logout = asyncHandler(async (req, res) => {
  const userId = userIdFromSessionCookies(req);
  if (userId) {
    await prisma.user.updateMany({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  }
  res.clearCookie(COOKIE_NAMES.ACCESS, cookieOptions);
  res.clearCookie(COOKIE_NAMES.REFRESH, cookieOptions);
  res.json({ ok: true });
});

// Lets a session outlive the 15-minute access token without asking the
// user to log in again. Re-checks the user's current role/status (not just
// what was true when the refresh token was issued) and rotates both
// cookies (TASK-009). Tokens issued before the account's last logout or
// MFA change are rejected via tokenVersion.
const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[COOKIE_NAMES.REFRESH];
  if (!token) throw new AppError('Not authenticated', 401);

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch (err) {
    res.clearCookie(COOKIE_NAMES.ACCESS, cookieOptions);
    res.clearCookie(COOKIE_NAMES.REFRESH, cookieOptions);
    throw new AppError('Session expired, please log in again', 401);
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.status === 'SUSPENDED' || !isCurrentTokenVersion(payload, user)) {
    res.clearCookie(COOKIE_NAMES.ACCESS, cookieOptions);
    res.clearCookie(COOKIE_NAMES.REFRESH, cookieOptions);
    throw new AppError('Not authenticated', 401);
  }
  if (!isWithinMaxSessionAge(payload, user)) {
    res.clearCookie(COOKIE_NAMES.ACCESS, cookieOptions);
    res.clearCookie(COOKIE_NAMES.REFRESH, cookieOptions);
    throw new AppError('Session expired, please log in again', 401);
  }

  issueSession(res, user, payload.at);
  res.json({ user: toPublicUser(user) });
});

module.exports = {
  registerBetter,
  registerBoardman,
  login,
  mfaVerify,
  mfaSetupStart,
  mfaSetupConfirm,
  mfaDisable,
  changePassword,
  logout,
  refresh,
  toPublicUser,
};
