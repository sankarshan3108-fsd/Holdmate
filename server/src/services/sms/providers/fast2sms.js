/**
 * Fast2SMS (OTP route). We generate the code; Fast2SMS only delivers it.
 * The code is stored hashed (bcrypt) and checked locally.
 * Docs: https://docs.fast2sms.com
 */
const env = require('../../../config/env');
const { randomDigits } = require('../../../utils/ids');
const { request, ProviderError } = require('../http');

module.exports = {
  name: 'fast2sms',
  channel: 'sms',
  managesCode: false,

  async send(phone) {
    const code = randomDigits(6);
    const url = `https://www.fast2sms.com/dev/bulkV2?route=otp&variables_values=${code}&flash=0&numbers=${phone}`;
    const r = await request(url, { method: 'GET', headers: { authorization: env.FAST2SMS_API_KEY } });
    if (r.ok && r.json && r.json.return === true) return { code };
    const msg = r.json && r.json.message;
    throw new ProviderError('Fast2SMS send failed', { status: r.status, providerMessage: Array.isArray(msg) ? msg.join(' ') : msg });
  }
};
