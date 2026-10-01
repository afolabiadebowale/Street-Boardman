// A thrown AppError carries an HTTP status so the error middleware can
// respond correctly without every controller needing its own try/catch logic.
// `code` is optional and machine-readable, for clients that need to react
// to a specific condition (e.g. MFA_REQUIRED) without parsing messages.
class AppError extends Error {
  constructor(message, statusCode = 400, code = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

module.exports = AppError;
