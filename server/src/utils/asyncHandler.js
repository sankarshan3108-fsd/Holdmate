/** Wrap async route handlers so rejected promises reach the error handler (Express 4). */
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
