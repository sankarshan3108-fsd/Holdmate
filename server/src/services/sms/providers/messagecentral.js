/**
 * Message Central VerifyNow (India).
 * Message Central generates, sends and checks the code; we only store its verificationId.
 *
 * Auth (in order of preference):
 *   1. MC_AUTH_TOKEN: the ready-made token from console.messagecentral.com → Developer Guide → API Credentials.
 *      Used directly in the "authToken" header; the token API is never called.
 *   2. MC_CUSTOMER_ID + MC_KEY (Base64 password): a token is fetched from the token API, cached in memory
 *      and refreshed once on 401.
 */
const env = require('../../../config/env');
const { request, ProviderError } = require('../http');

const BASE = 'https://cpaas.messagecentral.com';
const TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1000; // generated tokens: refresh at least every 12 h (and on 401)
const EXPIRED_MSG = 'Message Central auth token expired or invalid — copy a new one from console.messagecentral.com → Developer Guide → API Credentials';

let cached = null; // generated token { token, at }: memory only, never logged

const usingStaticToken = () => !!env.MC_AUTH_TOKEN;

/** Response code can be at the top level or inside data. */
const mcCode = (r) => {
  const j = r.json || {};
  const c = j.responseCode ?? (j.data && j.data.responseCode);
  return c === undefined || c === null ? null : Number(c);
};
const mcMessage = (r) => {
  const j = r.json || {};
  return (j.data && j.data.errorMessage) || j.message || j.error || j.errorMessage || (r.text || '').slice(0, 120);
};

/** Token from the token API (fallback when MC_AUTH_TOKEN is empty). */
async function fetchToken(force = false) {
  if (!force && cached && Date.now() - cached.at < TOKEN_MAX_AGE_MS) return cached.token;
  const url = `${BASE}/auth/v1/authentication/token?customerId=${encodeURIComponent(env.MC_CUSTOMER_ID)}`
    + `&key=${encodeURIComponent(env.MC_KEY)}&scope=NEW&country=91`;
  const r = await request(url, { method: 'GET' });
  const token = r.json && r.json.token;
  if (!r.ok || !token) {
    cached = null;
    throw new ProviderError('Message Central token request failed', { status: r.status, providerCode: mcCode(r), providerMessage: mcMessage(r) });
  }
  cached = { token, at: Date.now() };
  return token;
}

async function getToken(force = false) {
  if (usingStaticToken()) return env.MC_AUTH_TOKEN;
  return fetchToken(force);
}

/**
 * Run a request with the auth token.
 * Static token + 401 → clear "expired or invalid" error (nothing to refresh).
 * Generated token + 401 → fetch a new token and retry once.
 */
async function withToken(doRequest) {
  let r = await doRequest(await getToken());
  if (r.status === 401 && !usingStaticToken()) r = await doRequest(await getToken(true));
  if (r.status === 401) {
    if (usingStaticToken()) console.error(`[sms] ${EXPIRED_MSG}`);
    throw new ProviderError(usingStaticToken() ? EXPIRED_MSG : 'Message Central rejected the generated auth token (401)', { status: 401 });
  }
  return r;
}

// Send-side errors the user should see clearly (others → generic "couldn't send" message)
const SEND_ERRORS = {
  506: { userStatus: 429, userCode: 'OTP_TOO_SOON', userMessage: 'A code was sent recently. Please wait a minute before requesting another.' },
  800: { userStatus: 429, userCode: 'OTP_LIMIT', userMessage: 'Too many codes were requested for this number. Please try again later.' }
};

// Validate-side codes → outcome reasons understood by services/sms/index.js
const VERIFY_REASONS = {
  702: 'invalid',     // wrong OTP
  703: 'used',        // already verified
  705: 'expired',     // OTP expired
  505: 'invalid_id',  // invalid verification ID
  800: 'limit'        // maximum limit reached
};

/**
 * Check that the credentials are accepted WITHOUT sending an SMS:
 * calls validateOtp with a dummy verificationId. A valid token gets a normal
 * "invalid verification ID"-style answer; an invalid one gets 401.
 */
async function checkAuth() {
  const mode = usingStaticToken() ? 'MC_AUTH_TOKEN' : 'MC_CUSTOMER_ID + MC_KEY';
  if (!usingStaticToken()) await fetchToken(true);
  const url = `${BASE}/verification/v3/validateOtp?verificationId=0&code=000000`;
  const r = await withToken((token) => request(url, { method: 'GET', headers: { authToken: token } }));
  return { mode, httpStatus: r.status, responseCode: mcCode(r), message: mcMessage(r) };
}

module.exports = {
  name: 'messagecentral',
  channel: 'sms',
  managesCode: true,
  getToken,
  checkAuth,
  usingStaticToken,

  async send(phone) {
    const url = `${BASE}/verification/v3/send?countryCode=91&mobileNumber=${phone}&flowType=SMS&otpLength=6`;
    const r = await withToken((token) => request(url, { method: 'POST', headers: { authToken: token } }));
    const code = mcCode(r);
    const verificationId = r.json && r.json.data && r.json.data.verificationId;
    if (r.ok && verificationId && (code === null || code === 200)) return { ref: String(verificationId) };
    throw new ProviderError('Message Central send failed', {
      status: r.status, providerCode: code, providerMessage: mcMessage(r), ...(SEND_ERRORS[code] || {})
    });
  },

  async verify(phone, otp, verificationId) {
    const url = `${BASE}/verification/v3/validateOtp?verificationId=${encodeURIComponent(verificationId)}&code=${encodeURIComponent(otp)}`;
    const r = await withToken((token) => request(url, { method: 'GET', headers: { authToken: token } }));
    const status = r.json && r.json.data && r.json.data.verificationStatus;
    if (status === 'VERIFICATION_COMPLETED') return { ok: true };
    const reason = VERIFY_REASONS[mcCode(r)];
    if (reason) return { ok: false, reason };
    throw new ProviderError('Message Central validate failed', { status: r.status, providerCode: mcCode(r), providerMessage: mcMessage(r) });
  }
};
