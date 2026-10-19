/**
 * Rate limits. Auth/OTP routes are strict to stop OTP brute-forcing and SMS abuse.
 * (In-memory store: fine for one server. Use a Redis store when running several instances.)
 */
const rateLimit = require('express-rate-limit');

const make = (windowMinutes, limit, message, keyGenerator) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res) => res.status(429).json({ error: { message, code: 'RATE_LIMITED' } })
  });

/** Key by the phone number in the body, so people sharing one mobile-carrier IP don't block each other. */
const byPhone = (req) => {
  const digits = String((req.body && req.body.phone) || '').replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? `phone:${digits}` : `ip:${req.ip}`;
};

module.exports = {
  apiLimiter: make(15, 600, 'Too many requests. Please slow down and try again shortly.'),
  // OTP requests: 5 per phone and 20 per IP every 15 minutes
  otpRequestPerPhone: make(15, 5, 'Too many OTP requests for this number. Please wait 15 minutes and try again.', byPhone),
  otpRequestPerIp: make(15, 20, 'Too many OTP requests from this network. Please wait 15 minutes and try again.'),
  // OTP verification: 10 per phone and 40 per IP (each OTP also allows only 5 wrong attempts)
  otpVerifyPerPhone: make(15, 10, 'Too many login attempts for this number. Please wait 15 minutes and try again.', byPhone),
  otpVerifyPerIp: make(15, 40, 'Too many login attempts. Please wait 15 minutes and try again.'),
  handoverLimiter: make(15, 20, 'Too many handover attempts. Please wait and try again.')
};
