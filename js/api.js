/* ==========================================================================
   HoldMate — api.js
   Small fetch helper for the HoldMate backend + login state.
   Loaded before every other script.
   ========================================================================== */
(function () {
  'use strict';

  const HM = (window.HM = window.HM || {});

  /* ------------------------------------------------------------------
     CONFIG — where the API lives.
     '' = same origin: the normal case, because the backend serves the site
     (http://localhost:5000 in development, your domain in production).
     Only when the page is opened another way — file:// or VS Code Live Server
     (ports 5500/5501) — it talks to http://localhost:5000.
     Override with window.HOLDMATE_API_BASE.
     ------------------------------------------------------------------ */
  const STATIC_DEV_PORTS = ['5500', '5501'];
  const API_BASE =
    typeof window.HOLDMATE_API_BASE === 'string'
      ? window.HOLDMATE_API_BASE
      : location.protocol.startsWith('http') && !STATIC_DEV_PORTS.includes(location.port)
        ? ''
        : 'http://localhost:5000';
  HM.API_BASE = API_BASE;

  class ApiError extends Error {
    constructor(status, message, code, details) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }
  HM.ApiError = ApiError;

  const toast = (msg) => { if (HM.toast) HM.toast(msg, 'err', 5000); };

  /**
   * HM.api('/quote', { method: 'POST', body: {...} })
   * Sends cookies, parses JSON, throws ApiError and shows it as a toast (unless silent: true).
   */
  HM.api = async function api(path, { method = 'GET', body, silent = false, timeout = 15000 } = {}) {
    const ctrl = 'AbortController' in window ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(`${API_BASE}/api${path}`, {
        method,
        credentials: 'include',
        headers: body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      const err = new ApiError(0, "Can't reach the HoldMate server. Check your connection, or start the backend (npm run dev in server/).", 'NETWORK');
      if (!silent) toast(err.message);
      throw err;
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty or non-JSON body */ }
    if (!res.ok) {
      const e = (data && data.error) || {};
      const err = new ApiError(res.status, e.message || `Request failed (${res.status}).`, e.code, e.details);
      if (!silent) toast(err.message);
      throw err;
    }
    return data;
  };

  /* ------------------------------------------------------------------
     AUTH STATE (the session itself is an httpOnly cookie set by the server)
     ------------------------------------------------------------------ */
  const listeners = new Set();
  HM.auth = {
    user: null,
    onChange(fn) { listeners.add(fn); fn(this.user); return () => listeners.delete(fn); },
    set(user) { this.user = user || null; listeners.forEach((fn) => fn(this.user)); },
    async refresh() {
      try { const d = await HM.api('/auth/me', { silent: true }); this.set(d.user); }
      catch (e) { this.set(null); }
      return this.user;
    },
    requestOtp(phone) { return HM.api('/auth/request-otp', { method: 'POST', body: { phone }, silent: true }); },
    async verifyOtp(phone, otp, name) {
      const d = await HM.api('/auth/verify-otp', { method: 'POST', body: { phone, otp, ...(name ? { name } : {}) }, silent: true });
      this.set(d.user);
      return d.user;
    },
    async logout() {
      try { await HM.api('/auth/logout', { method: 'POST', body: {}, silent: true }); } catch (e) { /* ignore */ }
      this.set(null);
    }
  };
  HM.auth.ready = HM.auth.refresh();

  /* Places, hub and zone radius come from the server (GET /api/places) */
  HM.placesReady = HM.api('/places', { silent: true }).catch(() => null);

  /* Handover OTPs shown in this tab (memory only — never stored) */
  HM.sessionOtps = {};
})();
