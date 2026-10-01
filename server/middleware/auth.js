const { verifyAccessToken, isCurrentTokenVersion } = require('../utils/jwt');
const { COOKIE_NAMES } = require('../config/constants');
const prisma = require('../config/db');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');

// Reads the access token cookie, verifies it, and loads the current user
// onto req.user. Every route that needs to know "who is calling" uses this.
const requireAuth = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAMES.ACCESS];
  if (!token) throw new AppError('Not authenticated', 401);

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    throw new AppError('Session expired, please log in again', 401);
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) throw new AppError('User not found', 401);
  // Revoked by logout or an MFA change since this token was issued.
  if (!isCurrentTokenVersion(payload, user)) throw new AppError('Session expired, please log in again', 401);
  if (user.status === 'SUSPENDED') throw new AppError('Account suspended', 403);

  req.user = user;
  next();
});

module.exports = requireAuth;
