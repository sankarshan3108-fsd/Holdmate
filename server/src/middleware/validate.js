/**
 * zod validation for body / params / query. Parsed (and coerced) values replace the originals.
 */
const AppError = require('../utils/AppError');

module.exports = (schemas) => (req, res, next) => {
  for (const key of ['params', 'query', 'body']) {
    if (!schemas[key]) continue;
    const result = schemas[key].safeParse(req[key] === undefined ? {} : req[key]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.') || key, message: i.message }));
      const first = details[0];
      return next(new AppError(400, `${first.field}: ${first.message}`, 'VALIDATION_ERROR', details));
    }
    if (key === 'query') Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
    else req[key] = result.data;
  }
  next();
};
