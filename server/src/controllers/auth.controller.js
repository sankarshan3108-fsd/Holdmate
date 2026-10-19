/**
 * Phone + OTP login. Codes are sent and checked by services/sms (provider chosen by SMS_PROVIDER).
 * The OTP is never returned in any response.
 */
const { User } = require('../models');
const AppError = require('../utils/AppError');
const sms = require('../services/sms');
const { setAuthCookie, clearAuthCookie } = require('../middleware/auth');

const RESEND_AFTER_MS = 60 * 1000; // 1 code per number per 60 seconds
const DEFAULT_NAME = 'HoldMate customer';

// POST /api/auth/request-otp { phone }
exports.requestOtp = async (req, res) => {
  const { phone } = req.body;
  const last = await sms.lastSentAt(phone);
  if (last && Date.now() - new Date(last).getTime() < RESEND_AFTER_MS) {
    const wait = Math.ceil((RESEND_AFTER_MS - (Date.now() - new Date(last).getTime())) / 1000);
    throw new AppError(429, `Please wait ${wait} seconds before requesting another code.`, 'OTP_TOO_SOON', [
      { field: 'phone', message: 'Resend cooldown', retryAfterSeconds: wait }
    ]);
  }
  const sent = await sms.sendOtp(phone);
  res.json({
    ok: true,
    message: 'Code sent.',
    channel: sent.channel, // "sms" or "console" (development)
    expiresInSeconds: sent.expiresInSeconds,
    resendAfterSeconds: RESEND_AFTER_MS / 1000
  });
};

// POST /api/auth/verify-otp { phone, otp, name? }
exports.verifyOtp = async (req, res) => {
  const { phone, otp, name } = req.body;
  await sms.verifyOtp(phone, otp); // throws a clear AppError when wrong / expired / locked

  let user = await User.findOne({ phone });
  let isNew = false;
  if (!user) {
    user = await User.create({ phone, name: name || DEFAULT_NAME, role: 'customer' });
    isNew = true;
  } else if (name && user.name === DEFAULT_NAME) {
    user.name = name;
    await user.save();
  }
  setAuthCookie(res, user);
  res.json({ ok: true, isNew, user: user.toPublic() });
};

// GET /api/auth/me  → { user } or { user: null } when logged out
exports.me = async (req, res) => {
  res.json({ user: req.user ? req.user.toPublic() : null });
};

// POST /api/auth/logout
exports.logout = async (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
};
