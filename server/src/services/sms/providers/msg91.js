/**
 * MSG91 OTP API (v5). MSG91 generates, sends and checks the code.
 * Requires an approved DLT template in India before production use.
 * Docs: https://docs.msg91.com/otp
 */
const env = require('../../../config/env');
const { request, ProviderError } = require('../http');

const BASE = 'https://control.msg91.com/api/v5/otp';

function reasonFrom(message) {
  const m = String(message || '').toLowerCase();
  if (m.includes('not match') || m.includes('invalid otp')) return 'invalid';
  if (m.includes('expire')) return 'expired';
  if (m.includes('already verified')) return 'used';
  if (m.includes('max') && m.includes('limit')) return 'limit';
  return null;
}

module.exports = {
  name: 'msg91',
  channel: 'sms',
  managesCode: true,

  async send(phone) {
    const url = `${BASE}?template_id=${encodeURIComponent(env.MSG91_TEMPLATE_ID)}&mobile=91${phone}&otp_length=6&otp_expiry=5`;
    const r = await request(url, { method: 'POST', headers: { authkey: env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' }, body: {} });
    if (r.ok && r.json && r.json.type === 'success') return { ref: r.json.request_id || 'msg91' };
    throw new ProviderError('MSG91 send failed', { status: r.status, providerMessage: r.json && r.json.message });
  },

  async verify(phone, otp) {
    const url = `${BASE}/verify?otp=${encodeURIComponent(otp)}&mobile=91${phone}`;
    const r = await request(url, { method: 'GET', headers: { authkey: env.MSG91_AUTH_KEY } });
    if (r.ok && r.json && r.json.type === 'success') return { ok: true };
    const reason = reasonFrom(r.json && r.json.message);
    if (reason) return { ok: false, reason };
    throw new ProviderError('MSG91 verify failed', { status: r.status, providerMessage: r.json && r.json.message });
  }
};
