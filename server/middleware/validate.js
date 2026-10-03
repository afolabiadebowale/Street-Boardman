const AppError = require('../utils/appError');

// Usage: validate(zodSchema) as route middleware. Parses req.body against
// the schema and replaces it with the parsed (and type-coerced) result, so
// controllers can trust the shape of what they receive.
function validate(schema) {
  return function (req, res, next) {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues.map((e) => e.message).join(', ');
      throw new AppError(message, 422);
    }
    req.body = result.data;
    next();
  };
}

module.exports = validate;
