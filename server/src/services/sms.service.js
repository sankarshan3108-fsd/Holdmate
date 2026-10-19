/**
 * Sends login OTPs.
 */
const env = require('../config/env');
const AppError = require('../utils/AppError');

async function sendLoginOtp(phone, code) {
  if (env.isDev) {
    // Development: no SMS. The code is printed in the server console.
    console.log('\n+--------------------------------------+');
    console.log(`|  HoldMate login OTP for ${phone}   |`);
    console.log(`|              ${code}                  |`);
    console.log('|  (valid for 5 minutes)               |');
    console.log('+--------------------------------------+\n');
    return;
  }

  // ===================================================================
  // SMS PROVIDER HOOK: send the OTP by SMS in production.
  // Example with MSG91 (OTP API) or Twilio:
  //   await msg91.sendOtp({ mobile: '91' + phone, otp: code, template_id: process.env.MSG91_TEMPLATE_ID });
  //   await twilio.messages.create({ to: '+91' + phone, from: process.env.TWILIO_FROM,
  //                                  body: `Your HoldMate login code is ${code}. Valid for 5 minutes.` });
  // Never log the code in production.
  // ===================================================================
  throw new AppError(503, 'SMS sending is not configured yet. Please try again later.', 'SMS_NOT_CONFIGURED');
}

module.exports = { sendLoginOtp };
