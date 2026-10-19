/**
 * Phone + OTP login.
 */
const bcrypt = require('bcryptjs');
const { User, Otp } = require('../models');
const AppError = require('../utils/AppError');
const { randomDigits } = require('../utils/ids');
const { sendLoginOtp } = require('../services/sms.service');
const { setAuthCookie, clearAuthCookie } = require('../middleware/auth');

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_AFTER_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;
const DEFAULT_NAME = 'HoldMate customer';

// POST /api/auth/request-otp { phone }
exports.requestOtp = async (req, res) => {
  const { phone } = req.body;
  const recent = await Otp.findOne({ phone }).sort({ createdAt: -1 });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_AFTER_MS) {
    const wait = Math.ceil((RESEND_AFTER_MS - (Date.now() - recent.createdAt.getTime())) / 1000);
    throw new AppError(429, `Please wait ${wait} seconds before requesting a new OTP.`, 'OTP_TOO_SOON');
  }
  const code = randomDigits(6);
  const codeHash = await bcrypt.hash(code, 10);
  await Otp.deleteMany({ phone });
  await Otp.create({ phone, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_MS) });
  await sendLoginOtp(phone, code);
  res.json({ ok: true, message: 'OTP sent.', expiresInSeconds: OTP_TTL_MS / 1000 });
};

// POST /api/auth/verify-otp { phone, otp, name? }
exports.verifyOtp = async (req, res) => {
  const { phone, otp, name } = req.body;
  const record = await Otp.findOne({ phone }).sort({ createdAt: -1 });
  if (!record || record.expiresAt.getTime() < Date.now()) {
    if (record) await record.deleteOne();
    throw new AppError(400, 'This OTP has expired or was not requested. Please request a new one.', 'OTP_EXPIRED');
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    await record.deleteOne();
    throw new AppError(429, 'Too many wrong attempts. Please request a new OTP.', 'OTP_LOCKED');
  }
  const ok = await bcrypt.compare(otp, record.codeHash);
  if (!ok) {
    const updated = await Otp.findByIdAndUpdate(record._id, { $inc: { attempts: 1 } }, { new: true });
    const left = MAX_ATTEMPTS - (updated ? updated.attempts : MAX_ATTEMPTS);
    if (left <= 0) {
      await Otp.deleteOne({ _id: record._id });
      throw new AppError(429, 'Too many wrong attempts. Please request a new OTP.', 'OTP_LOCKED');
    }
    throw new AppError(400, `Incorrect OTP. ${left} attempt${left === 1 ? '' : 's'} left.`, 'OTP_INVALID');
  }
  await Otp.deleteMany({ phone });

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

// GET /api/auth/me
exports.me = async (req, res) => {
  res.json({ user: req.user ? req.user.toPublic() : null });
};

// POST /api/auth/logout
exports.logout = async (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
};
