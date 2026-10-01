const env = require('../config/env');
const AppError = require('../utils/appError');

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// CSRF defence that doesn't depend on cookie settings (ASVS 13.2.3).
// SameSite=Lax cookies already stop cross-site POSTs carrying the session,
// but COOKIE_SAME_SITE=none (cross-domain deployments, TASK-032) turns that
// off — and several admin actions (approve Boardman, suspend user) are
// body-less PATCHes a hostile page could fire. Browsers always send
// Origin on cross-origin state-changing requests, so a foreign Origin is
// rejected outright. Requests with no Origin (curl, server-to-server,
// Paystack's webhook) aren't browser-driven and can't carry a victim's
// cookies, so they pass.
function requireSameOrigin(req, res, next) {
  if (!STATE_CHANGING.has(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  const ownOrigin = `${req.protocol}://${req.get('host')}`;
  if (origin === env.clientOrigin || origin === ownOrigin) return next();
  throw new AppError('Cross-origin request blocked', 403);
}

module.exports = requireSameOrigin;
