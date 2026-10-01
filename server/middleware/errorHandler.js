const logger = require('../utils/logger');
const errorTracking = require('../utils/errorTracking');

// Centralized error handler. Any thrown AppError (or asyncHandler-caught
// rejection) ends up here instead of each controller formatting its own
// error response.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const statusCode = err.statusCode || 500;
  if (!err.isOperational) {
    // Unexpected error — log the full thing server-side, but don't leak
    // internals to the client. The requestId in the response lets a user
    // or support agent point straight at this log line (TASK-041).
    logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled error');
    // Operational AppErrors (4xx, expected) are deliberately not sent —
    // only genuine bugs, or Sentry fills up with "wrong PIN".
    errorTracking.captureException(err, { method: req.method, url: req.originalUrl });
    return res.status(statusCode).json({ error: 'Something went wrong', requestId: req.id });
  }
  res.status(statusCode).json(err.code ? { error: err.message, code: err.code } : { error: err.message });
}

function notFound(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
}

module.exports = { errorHandler, notFound };
