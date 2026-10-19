/**
 * npm run sms:check — checks the SMS provider credentials WITHOUT sending an SMS.
 * Message Central: requests an auth token. Never prints the token or keys.
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
    if (!env.MC_CUSTOMER_ID || !env.MC_KEY) {
      console.error('[sms:check] MC_CUSTOMER_ID and MC_KEY must be set in server/.env');
      process.exitCode = 1;
      return;
    }
    try {
      const token = await require('./providers/messagecentral').getToken(true);
      console.log(`[sms:check] Message Central credentials work: auth token received (${token.length} characters). No SMS was sent.`);
    } catch (err) {
      console.error(`[sms:check] Message Central token request FAILED: http=${err.status || '-'} code=${err.providerCode ?? '-'} message="${err.providerMessage || err.message}"`);
      console.error('[sms:check] Check MC_CUSTOMER_ID and MC_KEY (MC_KEY = Base64 of your Message Central password).');
      process.exitCode = 1; // (not process.exit: avoids a libuv assertion on Windows right after fetch)
    }
    return;
  }
  console.log(`[sms:check] No credential check without sending is available for ${name}. Keys present: ${
    name === 'msg91' ? !!(env.MSG91_AUTH_KEY && env.MSG91_TEMPLATE_ID) : !!env.FAST2SMS_API_KEY}`);
})();
