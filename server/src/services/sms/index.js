/**
 * Login OTP service — one interface for every SMS provider:
 *   sendOtp(phone)        → sends a 6-digit code (valid 5 minutes)
 *   verifyOtp(phone, code) → true, or throws an AppError with a clear message
 *
 * The provider is chosen with SMS_PROVIDER in server/.env:
 *   console (default) | messagecentral | msg91 | fast2sms
 * To add a provider: create providers/<name>.js with send(phone) and (if it checks codes itself) verify(),
 * register it below and add its keys to config/env.js + .env.example.
 *
 * Providers either
 *   - return { code } from send()  → we store a bcrypt hash and check locally (console, fast2sms), or
 *   - return { ref } from send()   → the provider checks the code via verify(phone, code, ref) (messagecentral, msg91).
 */
const bcrypt = require('bcryptjs');
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const { Otp } = require('../../models');

const providers = {
  console: require('./providers/console'),
  messagecentral: require('./providers/messagecentral'),
  msg91: require('./providers/msg91'),
  fast2sms: require('./providers/fast2sms')
};

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SEND_FAILED = "We couldn't send the code. Please try again in a minute.";
const VERIFY_FAILED = "We couldn't check the code right now. Please try again in a minute.";

const current = () => providers[env.SMS_PROVIDER] || providers.console;

/** Log provider problems without secrets (no URLs, tokens, keys or codes). */
function logProviderError(provider, op, err) {
  const parts = [`[sms] ${provider} ${op} failed: ${err.message}`];
  if (err.status) parts.push(`http=${err.status}`);
  if (err.providerCode !== undefined && err.providerCode !== null) parts.push(`code=${err.providerCode}`);
  if (err.providerMessage) parts.push(`message="${String(err.providerMessage).slice(0, 200)}"`);
  console.error(parts.join(' '));
}

async function sendOtp(phone) {
  const provider = current();
  let result;
  try {
    result = await provider.send(phone);
  } catch (err) {
    logProviderError(provider.name, 'send', err);
    if (err.userStatus) throw new AppError(err.userStatus, err.userMessage, err.userCode);
    throw new AppError(502, SEND_FAILED, 'SMS_SEND_FAILED');
  }
  await Otp.deleteMany({ phone });
  await Otp.create({
    phone,
    provider: provider.name,
    codeHash: result.code ? await bcrypt.hash(result.code, 10) : undefined,
    providerRef: result.ref,
    expiresAt: new Date(Date.now() + OTP_TTL_MS)
  });
  return { channel: provider.channel, expiresInSeconds: OTP_TTL_MS / 1000 };
}

async function verifyOtp(phone, code) {
  const record = await Otp.findOne({ phone }).sort({ createdAt: -1 });
  if (!record || record.expiresAt.getTime() < Date.now()) {
    if (record) await record.deleteOne();
    throw new AppError(400, 'This code has expired or was not requested. Please request a new one.', 'OTP_EXPIRED');
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    await record.deleteOne();
    throw new AppError(429, 'Too many wrong attempts. Please request a new code.', 'OTP_LOCKED');
  }

  let outcome;
  if (record.codeHash) {
    outcome = (await bcrypt.compare(code, record.codeHash)) ? { ok: true } : { ok: false, reason: 'invalid' };
  } else {
    const provider = providers[record.provider];
    if (!provider || !provider.verify) throw new AppError(500, VERIFY_FAILED, 'SMS_VERIFY_FAILED');
    try {
      outcome = await provider.verify(phone, code, record.providerRef);
    } catch (err) {
      logProviderError(provider.name, 'verify', err);
      throw new AppError(502, VERIFY_FAILED, 'SMS_VERIFY_FAILED');
    }
  }

  if (outcome.ok) {
    await Otp.deleteMany({ phone });
    return true;
  }

  switch (outcome.reason) {
    case 'invalid': {
      const updated = await Otp.findByIdAndUpdate(record._id, { $inc: { attempts: 1 } }, { new: true });
      const left = MAX_ATTEMPTS - (updated ? updated.attempts : MAX_ATTEMPTS);
      if (left <= 0) {
        await Otp.deleteOne({ _id: record._id });
        throw new AppError(429, 'Too many wrong attempts. Please request a new code.', 'OTP_LOCKED');
      }
      throw new AppError(400, `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`, 'OTP_INVALID');
    }
    case 'expired':
      await record.deleteOne();
      throw new AppError(400, 'This code has expired. Please request a new one.', 'OTP_EXPIRED');
    case 'used':
      await record.deleteOne();
      throw new AppError(400, 'This code has already been used. Please request a new one.', 'OTP_USED');
    case 'invalid_id':
      await record.deleteOne();
      throw new AppError(400, 'This code is no longer valid. Please request a new one.', 'OTP_EXPIRED');
    case 'limit':
      await record.deleteOne();
      throw new AppError(429, 'Maximum attempts reached for this code. Please request a new one later.', 'OTP_LOCKED');
    default:
      throw new AppError(502, VERIFY_FAILED, 'SMS_VERIFY_FAILED');
  }
}

/** When the last code was sent to this phone (for the 60-second resend cooldown). */
async function lastSentAt(phone) {
  const r = await Otp.findOne({ phone }).sort({ createdAt: -1 }).select('createdAt').lean();
  return r ? r.createdAt : null;
}

module.exports = { sendOtp, verifyOtp, lastSentAt, providers, current, OTP_TTL_MS, MAX_ATTEMPTS };
