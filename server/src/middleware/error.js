/**
 * 404 for unknown API routes + central error handler that always answers with clear JSON:
 *   { "error": { "message": "...", "code": "...", "details": [...] } }
 */
const env = require('../config/env');

function notFound(req, res) {
  res.status(404).json({ error: { message: `No API route for ${req.method} ${req.originalUrl}`, code: 'NOT_FOUND' } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Something went wrong.';
  let code = err.code;
  let details = err.details;

  if (err.type === 'entity.parse.failed') {
    status = 400; message = 'Request body is not valid JSON.'; code = 'BAD_JSON';
  } else if (err.type === 'entity.too.large') {
    status = 413; message = 'Request body is too large.'; code = 'TOO_LARGE';
  } else if (err.name === 'CastError') {
    status = 400; message = `Invalid value for ${err.path}.`; code = 'BAD_ID';
  } else if (err.name === 'ValidationError') {
    status = 400; code = 'VALIDATION_ERROR';
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    message = details[0] ? `${details[0].field}: ${details[0].message}` : 'Validation failed.';
  } else if (err.code === 11000) {
    status = 409; code = 'DUPLICATE';
    const field = Object.keys(err.keyValue || {})[0];
    message = field ? `A record with this ${field} already exists.` : 'Duplicate record.';
  }

  if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl, '\n', err);
    if (env.isProd) message = 'Something went wrong on our side. Please try again.';
    code = code && typeof code === 'string' ? code : 'SERVER_ERROR';
  }
  if (typeof code !== 'string') code = undefined;

  res.status(status).json({ error: { message, code, ...(details ? { details } : {}) } });
}

module.exports = { notFound, errorHandler };
