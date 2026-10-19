/**
 * Rate limits. Auth/OTP routes are strict to stop OTP brute-forcing and SMS cost abuse.
 * Also enforced elsewhere: 1 code per number per 60 s (auth.controller), 5 wrong attempts per code (services/sms).
 * (In-memory store: fine for one server. Use a Redis store when running several instances.)
 */
const rateLimit = require('express-rate-limit');

function make({ windowMinutes, limit, message, keyGenerator, skipFailedRequests = false }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipFailedRequests, // only successful requests count (e.g. codes actually sent)
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res) => {
      const reset = req.rateLimit && req.rateLimit.resetTime ? new Date(req.rateLimit.resetTime).getTime() : Date.now() + windowMinutes * 60000;
      const minutes = Math.max(1, Math.ceil((reset - Date.now()) / 60000));
      res.status(429).json({ error: { message: message.replace('{minutes}', `${minutes} minute${minutes === 1 ? '' : 's'}`), code: 'RATE_LIMITED' } });
    }
  });
}

/** Key by the phone number in the body (normalised to 10 digits). */
const byPhone = (req) => {
  const digits = String((req.body && req.body.phone) || '').replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? `phone:${digits}` : `ip:${req.ip}`;
};

module.exports = {
  apiLimiter: make({ windowMinutes: 15, limit: 600, message: 'Too many requests. Please slow down and try again shortly.' }),

  // Sending codes: max 5 per hour per number, 10 per hour per IP (only codes actually sent count)
  otpRequestPerPhone: make({ windowMinutes: 60, limit: 5, keyGenerator: byPhone, skipFailedRequests: true, message: 'Too many codes requested for this number. Please try again in {minutes}.' }),
  otpRequestPerIp: make({ windowMinutes: 60, limit: 10, skipFailedRequests: true, message: 'Too many codes requested from this network. Please try again in {minutes}.' }),

  // Checking codes (each code also allows only 5 wrong attempts)
  otpVerifyPerPhone: make({ windowMinutes: 15, limit: 10, keyGenerator: byPhone, message: 'Too many login attempts for this number. Please try again in {minutes}.' }),
  otpVerifyPerIp: make({ windowMinutes: 15, limit: 40, message: 'Too many login attempts. Please try again in {minutes}.' }),

  handoverLimiter: make({ windowMinutes: 15, limit: 20, message: 'Too many handover attempts. Please wait and try again.' })
};
