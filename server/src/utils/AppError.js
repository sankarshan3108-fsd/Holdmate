/** An error with an HTTP status that the central error handler turns into JSON. */
class AppError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code || undefined;
    this.details = details || undefined;
  }
}
module.exports = AppError;
