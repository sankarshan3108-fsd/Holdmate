/**
 * Tiny HTTP helper for SMS providers (Node 18+ fetch with a timeout).
 * Never log the URL: provider URLs can contain keys or OTP codes.
 */
class ProviderError extends Error {
  /**
   * @param {string} message      internal description (safe to log — no secrets)
   * @param {object} info         { status, providerCode, providerMessage, userStatus, userMessage, userCode }
   *   userStatus/userMessage/userCode: optional, when the user should see a specific message
   *   instead of the generic "We couldn't send the code" one.
   */
  constructor(message, info = {}) {
    super(message);
    Object.assign(this, info);
  }
}

async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { accept: '*/*', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (err) {
    throw new ProviderError(err.name === 'AbortError' ? 'Provider request timed out' : `Provider unreachable (${err.code || err.message})`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  return { status: res.status, ok: res.ok, json, text };
}

module.exports = { request, ProviderError };
