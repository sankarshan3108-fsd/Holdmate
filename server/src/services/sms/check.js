/**
 * npm run sms:check — checks the SMS provider credentials WITHOUT sending an SMS.
 * Message Central: uses MC_AUTH_TOKEN if set (else gets a token from MC_CUSTOMER_ID + MC_KEY)
 * and makes a harmless validateOtp call with a dummy ID. Never prints the token or keys.
 */
const env = require('../../config/env');

(async () => {
  const name = env.SMS_PROVIDER;
  console.log(`[sms:check] SMS_PROVIDER=${name}`);
  if (name === 'console') {
    console.log('[sms:check] console provider: codes are printed in the server terminal. Nothing to check.');
    return;
  }
  if (name === 'messagecentral') {
    if (!env.MC_AUTH_TOKEN && !(env.MC_CUSTOMER_ID && env.MC_KEY)) {
      console.error('[sms:check] Set MC_AUTH_TOKEN (or MC_CUSTOMER_ID + MC_KEY) in server/.env');
      process.exitCode = 1;
      return;
    }
    try {
      const r = await require('./providers/messagecentral').checkAuth();
      console.log(`[sms:check] Message Central credentials work (using ${r.mode}).`);
      console.log(`[sms:check] Test call answered http=${r.httpStatus} code=${r.responseCode ?? '-'} "${r.message || ''}" (expected for a dummy verification ID). No SMS was sent.`);
    } catch (err) {
      console.error(`[sms:check] Message Central check FAILED: http=${err.status || '-'} code=${err.providerCode ?? '-'} ${err.providerMessage ? `message="${err.providerMessage}"` : err.message}`);
      if (!env.MC_AUTH_TOKEN) console.error('[sms:check] Check MC_CUSTOMER_ID and MC_KEY (MC_KEY = Base64 of your Message Central password), or set MC_AUTH_TOKEN.');
      process.exitCode = 1; // (not process.exit: avoids a libuv assertion on Windows right after fetch)
    }
    return;
  }
  console.log(`[sms:check] No credential check without sending is available for ${name}. Keys present: ${
    name === 'msg91' ? !!(env.MSG91_AUTH_KEY && env.MSG91_TEMPLATE_ID) : !!env.FAST2SMS_API_KEY}`);
})();
