const AppError = require('../utils/appError');
const { assertMayPlay } = require('../services/responsibleGamblingService');

// Self-excluded or cooling-off users can't bet or deposit (they can still
// log in and withdraw). Uses the user requireAuth already loaded.
function requirePlayAllowed(req, res, next) {
  if (!req.user) return next(new AppError('Not authenticated', 401));
  try {
    assertMayPlay(req.user);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = requirePlayAllowed;
