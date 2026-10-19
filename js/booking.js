/* ==========================================================================
   HoldMate — booking.js
   Places (from the server), quotes (POST /api/quote — prices are calculated
   on the server only), the hero quote widget, the pricing calculator, the
   3-step booking modal with phone-OTP login, and the "My bookings" panel.
   ========================================================================== */
(function () {
  'use strict';

  const HM = (window.HM = window.HM || {});
  const { $, $$, clamp } = HM;

  /* ==========================================================================
     CONFIG — hub, zone and places are loaded from GET /api/places
     (edit them in server/src/config/places.js and server/.env).
     Prices live only on the server: server/src/config/pricing.js
     ========================================================================== */
  const CONFIG = {
    HUB: { name: 'Coimbatore Junction', lat: 10.9965, lng: 76.9667 },
    ZONE_KM: 15,
    ROAD_FACTOR: 1.3, // display-only distance estimates
    PLACES: []
  };
  HM.CONFIG = CONFIG;

  const VEHICLE_NAMES = { bike: 'HoldMate Bike', auto: 'HoldMate Auto', van: 'HoldMate Van', truck: 'HoldMate Truck' };
  const SERVICE_NAMES = { standard: 'Pickup & delivery', scheduled: 'Scheduled run', express: 'Express', store: 'Store & hold', events: 'Events & groups' };
  const STATUS_LABEL = {
    booked: 'Booked', picked_up: 'Picked up & sealed', in_locker: 'In locker', on_the_way: 'On the way',
    arrived: 'Arrived', delivered: 'Delivered', cancelled: 'Cancelled'
  };
  Object.assign(HM, { VEHICLE_NAMES, STATUS_LABEL });

  /* Places from the server → datalist + CONFIG (gps.js waits on HM.placesReady) */
  const dl = $('#places');
  HM.placesReady = (HM.placesReady || Promise.resolve(null)).then((d) => {
    if (d && Array.isArray(d.places)) {
      Object.assign(CONFIG.HUB, d.hub || {});
      CONFIG.ZONE_KM = d.radiusKm || CONFIG.ZONE_KM;
      CONFIG.PLACES.splice(0, CONFIG.PLACES.length, ...d.places);
      CONFIG.PLACES.forEach((p) => { const o = document.createElement('option'); o.value = p.name; dl.appendChild(o); });
    }
    return d;
  });

  /* ==========================================================================
     GEO HELPERS (display & map only — the server re-checks zones and prices)
     ========================================================================== */
  const toRad = (d) => (d * Math.PI) / 180;
  function haversine(a, b) {
    const R = 6371;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  const fromHub = (p) => haversine(CONFIG.HUB, p);
  const inZone = (p) => fromHub(p) <= CONFIG.ZONE_KM;
  function nearestPlace(p) {
    let best = null, bd = Infinity;
    CONFIG.PLACES.forEach((pl) => { const d = haversine(p, pl); if (d < bd) { bd = d; best = pl; } });
    return { place: best, km: bd };
  }
  const roadKm = (a, b) => haversine(a, b) * CONFIG.ROAD_FACTOR;
  HM.geo = { haversine, fromHub, inZone, nearestPlace, roadKm };

  /* fetch with timeout for third-party APIs (Nominatim / OSRM) */
  HM.fetchJSON = async function (url, ms = 7000) {
    const ctrl = 'AbortController' in window ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally { clearTimeout(timer); }
  };

  /* Turn an input into {name, lat, lng}: GPS coordinates → known landmark → Nominatim search */
  const geoCache = new Map();
  async function resolvePlace(input) {
    const val = input.value.trim();
    if (!val) return null;
    if (input.dataset.lat && input.dataset.label === val) return { name: val, lat: +input.dataset.lat, lng: +input.dataset.lng };
    await HM.placesReady;
    const v = val.toLowerCase();
    const exact = CONFIG.PLACES.find((p) => p.name.toLowerCase() === v);
    if (exact) return { ...exact };
    const partial = v.length >= 3 && CONFIG.PLACES.find((p) => p.name.toLowerCase().includes(v) || v.includes(p.name.toLowerCase().split(' (')[0]));
    if (partial) return { ...partial };
    if (geoCache.has(v)) return geoCache.get(v);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&viewbox=76.80,11.20,77.20,10.80&bounded=1&q=${encodeURIComponent(val + ', Coimbatore')}`;
      const data = await HM.fetchJSON(url, 6000);
      const hit = data && data[0] ? { name: val, lat: +data[0].lat, lng: +data[0].lon } : null;
      geoCache.set(v, hit);
      return hit;
    } catch (e) {
      return null;
    }
  }
  HM.resolvePlace = resolvePlace;

  /* Typing in a field invalidates GPS coordinates attached earlier */
  document.addEventListener('input', (e) => {
    const i = e.target;
    if (i.matches && i.matches('input[list="places"]') && i.dataset.label !== i.value) {
      delete i.dataset.lat; delete i.dataset.lng; delete i.dataset.label;
    }
  });

  /* ==========================================================================
     SERVER QUOTES
     ========================================================================== */
  const pt = (p) => ({ lat: p.lat, lng: p.lng });
  const placeBody = (p) => ({ name: String(p.name).slice(0, 160), lat: p.lat, lng: p.lng });
  HM.quote = (body) => HM.api('/quote', { method: 'POST', body, silent: true }).then((d) => d.quote);

  const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  HM.inr = inr;
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  HM.esc = esc;
  const fmtTime = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtPhone = (p) => (p && p.length === 10 ? `+91 ${p.slice(0, 5)} ${p.slice(5)}` : p || '');
  const isLocalApi = /localhost|127\.0\.0\.1/.test(HM.API_BASE || location.hostname);

  /** Price breakdown rows from a server quote */
  function breakdownRows(q) {
    const p = q.price;
    if (q.serviceType === 'events') return [['Event cloakroom setup', p.base], [`${q.bags} bags`, p.bagCharge]];
    const rows = [
      ['Base fare', p.base],
      [q.serviceType === 'store' ? 'Distance · store only, no charge' : `Distance · ${q.distanceKm.toFixed(1)} km`, p.distance],
      [`Time · ${q.hours} h${q.hours > 24 ? ' (lower rate after 24 h)' : ''}`, p.time],
      [`Weight · ${q.weightKg} kg`, p.weight]
    ];
    if (p.multiplier !== 1) rows.push([p.multiplier < 1 ? 'Scheduled run −15%' : 'Express +50%', p.total - p.subtotal, true]);
    return rows;
  }

  /* ==========================================================================
     HERO QUOTE WIDGET
     ========================================================================== */
  (function quoteWidget() {
    const form = $('#quote');
    if (!form) return;
    const tabs = $$('.tab', form);
    const ink = $('.tabs__ink', form);
    const fromI = $('#q-from'), toI = $('#q-to'), hoursI = $('#q-hours'), bagsI = $('#q-bags'), kgI = $('#q-kg');
    const toWrap = $('#q-to-wrap');
    const result = $('#q-result');
    const bookBtn = $('#q-book');
    let tab = 'pickup';
    let last = null;
    let reqId = 0;

    const LABELS = {
      pickup: { from: 'Pick up from', hours: 'Deliver in / hold for', bags: 'Bags' },
      store: { from: 'Pick up from (we return here)', hours: 'Hold for', bags: 'Bags' },
      events: { from: 'Event venue', hours: 'Event duration', bags: 'Guest bags (approx.)' }
    };
    function setTab(t) {
      tab = t;
      tabs.forEach((b, i) => {
        const on = b.dataset.tab === t;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
        if (on) ink.style.transform = `translateX(${i * 100}%)`;
      });
      toWrap.hidden = t !== 'pickup';
      $('#q-from-label').textContent = LABELS[t].from;
      $('#q-hours-label').textContent = LABELS[t].hours;
      $('#q-bags-label').textContent = LABELS[t].bags;
      if (t === 'events' && +bagsI.value < 20) { bagsI.value = 40; kgI.value = 300; }
      if (t !== 'events' && +bagsI.value > 20) { bagsI.value = 2; kgI.value = 15; }
      invalidate();
    }
    tabs.forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    form.querySelector('.tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = tabs.findIndex((b) => b.dataset.tab === tab);
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      setTab(n.dataset.tab); n.focus();
    });

    const PRESETS = {
      students: { from: 'Coimbatore Junction', to: 'PSG Tech', hours: 6, bags: 2, kg: 18 },
      families: { from: 'Coimbatore Junction', to: 'RS Puram', hours: 4, bags: 4, kg: 40 },
      tourists: { from: 'Gandhipuram', to: 'Race Course', hours: 12, bags: 2, kg: 22 },
      business: { from: 'Coimbatore Airport', to: 'Avinashi Road (Lakshmi Mills)', hours: 4, bags: 1, kg: 8 }
    };
    $$('[data-preset]', form).forEach((chip) => chip.addEventListener('click', () => {
      const p = PRESETS[chip.dataset.preset];
      $$('[data-preset]', form).forEach((c) => c.classList.toggle('is-active', c === chip));
      if (tab !== 'pickup') setTab('pickup');
      fromI.value = p.from; toI.value = p.to; hoursI.value = String(p.hours); bagsI.value = p.bags; kgI.value = p.kg;
      [fromI, toI].forEach((i) => { delete i.dataset.lat; delete i.dataset.label; });
      estimate();
    }));

    function invalidate() { bookBtn.disabled = true; last = null; }
    form.addEventListener('input', invalidate);
    form.addEventListener('change', invalidate);
    form.addEventListener('submit', (e) => { e.preventDefault(); estimate(); });

    async function estimate() {
      const id = ++reqId;
      const bags = clamp(parseInt(bagsI.value, 10) || 1, 1, 100);
      const kg = clamp(parseFloat(kgI.value) || 1, 1, 1000);
      const hours = parseInt(hoursI.value, 10) || 1;
      bagsI.value = bags; kgI.value = kg;
      result.hidden = false;
      if (!fromI.value.trim()) return show('<p class="qr-warn">Please enter a pickup location, or tap “Use my location”.</p>', fromI);
      if (tab === 'pickup' && !toI.value.trim()) return show('<p class="qr-warn">Please enter where we should deliver.</p>', toI);
      result.innerHTML = '<p class="qr-msg">Getting your price…</p>';
      const a = await resolvePlace(fromI);
      const b = tab === 'pickup' ? await resolvePlace(toI) : null;
      if (id !== reqId) return;
      if (!a) return show(`<p class="qr-warn">We couldn't find “${esc(fromI.value)}”. Pick a place from the suggestions or use GPS.</p>`, fromI);
      if (tab === 'pickup' && !b) return show(`<p class="qr-warn">We couldn't find “${esc(toI.value)}”. Pick a place from the suggestions or use GPS.</p>`, toI);

      const serviceType = tab === 'events' ? 'events' : tab === 'store' ? 'store' : 'standard';
      let q;
      try {
        q = await HM.quote({ serviceType, pickup: pt(a), ...(b ? { drop: pt(b) } : {}), hours, bags, weightKg: kg });
      } catch (err) {
        if (id === reqId) show(`<p class="qr-warn">${esc(err.message)}</p>`);
        return;
      }
      if (id !== reqId) return;
      const warn = [[a, q.zone.pickup], [b, q.zone.drop]]
        .filter(([p, z]) => p && z && !z.inside)
        .map(([p, z]) => `“${esc(p.name)}” is about ${z.kmFromHub} km from Coimbatore Junction — outside our ${q.zone.radiusKm} km zone.`)
        .join('<br>');
      const meta = serviceType === 'pickup' || serviceType === 'standard'
        ? `<span>Distance <b>≈ ${q.distanceKm.toFixed(1)} km</b></span>`
        : `<span><b>${serviceType === 'events' ? 'Event package' : 'No distance charge'}</b></span>`;
      result.innerHTML = `
        <div class="qr-row">
          <p class="qr-price">${inr(q.price.total)}<small>${serviceType === 'events' ? 'event package' : 'estimated'}</small></p>
          <div class="qr-meta"><span>Vehicle <b>${esc(q.vehicle.name)}</b></span>${meta}</div>
        </div>
        ${warn ? `<p class="qr-warn">${warn}</p>` : ''}`;
      last = q.zone.allInside ? { from: a, to: b || a, hours, bags, kg, service: serviceType } : null;
      bookBtn.disabled = !last;
    }
    function show(html, focusEl) {
      result.innerHTML = html;
      bookBtn.disabled = true;
      if (focusEl) focusEl.focus();
    }
    bookBtn.addEventListener('click', () => { if (last) HM.booking.open(last); });
    setTab('pickup');
  })();

  /* ==========================================================================
     PRICING CALCULATOR (server quote with distanceKm from the slider)
     ========================================================================== */
  const calc = (function calculator() {
    const kmI = $('#c-km'), hI = $('#c-h'), kgI = $('#c-kg');
    if (!kmI) return null;
    const totalEl = $('#c-total');
    const seg = $('#calc-mode');
    const segBtns = $$('button', seg);
    const segInk = $('.seg__ink', seg);
    let mode = 'standard';
    let shown = 0, stopTween = null, timer = null, reqId = 0;

    function setMode(m) {
      mode = m;
      segBtns.forEach((b, i) => {
        const on = b.dataset.mode === m;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', String(on));
        if (on) segInk.style.transform = `translateX(${i * 100}%)`;
      });
      update();
    }
    segBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    seg.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const i = segBtns.findIndex((b) => b.dataset.mode === mode);
      const n = segBtns[(i + (e.key === 'ArrowRight' ? 1 : -1) + 3) % 3];
      setMode(n.dataset.mode); n.focus();
    });

    function fillTrack(i) { i.style.setProperty('--p', `${((i.value - i.min) / (i.max - i.min)) * 100}%`); }
    function values() {
      const km = +kmI.value, hours = +hI.value, kg = +kgI.value;
      return { km, hours, kg, bags: Math.max(1, Math.ceil(kg / 12)), mode };
    }
    function update() {
      [kmI, hI, kgI].forEach(fillTrack);
      const v = values();
      $('#c-km-out').textContent = `${v.km} km`;
      $('#c-h-out').textContent = `${v.hours} h`;
      $('#c-kg-out').textContent = `${v.kg} kg`;
      clearTimeout(timer);
      timer = setTimeout(() => fetchQuote(v), 120); // debounce while dragging
    }
    async function fetchQuote(v) {
      const id = ++reqId;
      let q;
      try {
        q = await HM.quote({ serviceType: v.mode, distanceKm: v.km, hours: v.hours, bags: v.bags, weightKg: v.kg });
      } catch (err) {
        if (id !== reqId) return;
        $('#c-breakdown').innerHTML = `<li><span>${esc(err.status === 0 ? 'Prices are unavailable — the HoldMate server is offline.' : err.message)}</span></li>`;
        $('#c-vehicle').textContent = '—';
        return;
      }
      if (id !== reqId) return;
      $('#c-breakdown').innerHTML = breakdownRows(q).map(([l, val, mod]) => `<li${mod ? ' class="is-mod"' : ''}><span>${esc(l)}</span><b>${val < 0 ? '−' : ''}${inr(Math.abs(val))}</b></li>`).join('');
      $('#c-vehicle').textContent = q.vehicle.name;
      if (stopTween) stopTween();
      stopTween = HM.tween(shown, q.price.total, 600, (n) => { shown = n; totalEl.textContent = Math.round(n).toLocaleString('en-IN'); });
    }
    [kmI, hI, kgI].forEach((i) => i.addEventListener('input', update));
    setMode('standard');
    return { values };
  })();

  /* ==========================================================================
     BOOKING MODAL: 1 Route → 2 Bags & details (→ phone OTP if logged out) → 3 Confirmed
     ========================================================================== */
  const modal = $('#booking');
  const form = $('#bk-form');
  const steps = $$('.bk-step', modal);
  const prog = $$('.bk-progress li', modal);
  const f = {
    from: $('#b-from'), to: $('#b-to'), time: $('#b-time'), service: $('#b-service'),
    bags: $('#b-bags'), kg: $('#b-kg'), hours: $('#b-hours'), name: $('#b-name'), phone: $('#b-phone'), otp: $('#b-otp')
  };
  const state = { step: 1, from: null, to: null, booking: null, phone: null, resendAt: 0 };
  const PHONE_RE = /^(?:\+?91|0)?[6-9]\d{9}$/;
  const cleanPhone = (v) => v.replace(/[\s\-()]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');

  const pad = (n) => String(n).padStart(2, '0');
  const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  function goStep(n, back) {
    state.step = n;
    steps.forEach((s) => {
      const on = s.dataset.step === String(n);
      s.classList.toggle('is-active', on);
      s.classList.toggle('is-back', on && !!back);
    });
    const idx = n === 'otp' ? 2 : n;
    prog.forEach((li, i) => {
      li.classList.toggle('is-active', i + 1 === idx);
      li.classList.toggle('is-done', i + 1 < idx);
    });
    $('#bk-title').textContent = n === 3 ? "You're all set" : n === 'otp' ? 'Verify your number' : 'Book a pickup';
    $('.modal__panel', modal).scrollTop = 0;
    setTimeout(() => {
      const target = n === 3 ? $('#bd-track') : n === 'otp' ? f.otp : $(`.bk-step[data-step="${n}"] input:not([readonly]), .bk-step[data-step="${n}"] button`, modal);
      if (target) target.focus({ preventScroll: true });
    }, 60);
  }

  function setPlace(input, p) {
    if (!p) { input.value = ''; return; }
    input.value = p.name;
    input.dataset.lat = p.lat; input.dataset.lng = p.lng; input.dataset.label = p.name;
  }

  /** Show who is booking (when logged in) and lock the phone to the account */
  function renderAccountLine() {
    const u = HM.auth.user;
    const line = $('#bk-account');
    if (u) {
      line.hidden = false;
      line.innerHTML = `<span>Booking as <b>${esc(u.name)}</b> · ${esc(fmtPhone(u.phone))}</span><button type="button" class="link-btn small" id="bk-switch">Not you?</button>`;
      if (!f.name.value && u.name !== 'HoldMate customer') f.name.value = u.name;
      f.phone.value = u.phone;
      f.phone.readOnly = true;
    } else {
      line.hidden = true;
      line.innerHTML = '';
      f.phone.readOnly = false;
    }
  }
  modal.addEventListener('click', async (e) => {
    if (e.target.closest('#bk-switch')) {
      await HM.auth.logout();
      f.phone.value = '';
      renderAccountLine();
      f.phone.focus();
      HM.toast('Logged out. Enter your mobile number to book.');
    }
  });

  HM.booking = {
    async open(pre = {}) {
      form.reset();
      ['b-err-1', 'b-err-2', 'b-err-otp'].forEach((id) => { $('#' + id).textContent = ''; });
      $$('.field__row.is-invalid, .stepper.is-invalid', modal).forEach((r) => r.classList.remove('is-invalid'));
      const now = new Date();
      f.time.value = localISO(new Date(now.getTime() + 60 * 60 * 1000));
      f.time.min = localISO(now);
      if (pre.from) setPlace(f.from, pre.from);
      if (pre.to) setPlace(f.to, pre.to);
      if (pre.service) f.service.value = pre.service;
      f.bags.value = pre.bags || (pre.service === 'events' ? 40 : 2);
      f.kg.value = pre.kg || (pre.service === 'events' ? 300 : 15);
      f.hours.value = pre.hours || 4;
      $('#bk-quote').innerHTML = '';
      $('#b-otp-dev').hidden = !isLocalApi;
      goStep(1);
      HM.layer.open(modal);
      await HM.auth.ready;
      renderAccountLine();
    },
    close() { HM.layer.close(modal); }
  };

  /* Every [data-book] button anywhere opens the modal */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-book]');
    if (!b) return;
    e.preventDefault();
    const v = b.dataset.book;
    if (v === 'calc' && calc) {
      const c = calc.values();
      HM.booking.open({ hours: c.hours, kg: c.kg, bags: c.bags, service: c.mode });
    } else {
      HM.booking.open(v ? { service: v } : {});
    }
  });
  modal.addEventListener('click', (e) => { if (e.target.closest('[data-close-modal]')) HM.booking.close(); });

  function invalid(input, on) { const r = input.closest('.field__row, .stepper'); if (r) r.classList.toggle('is-invalid', on); }
  function busy(btn, on, label) {
    btn.disabled = on;
    const span = $('span', btn);
    if (!btn.dataset.label) btn.dataset.label = span.textContent;
    span.textContent = on ? label : btn.dataset.label;
  }

  /* Step 1 → 2: resolve places, then let the server check the zone */
  $('#bk-next1').addEventListener('click', async () => {
    const err = $('#b-err-1');
    const btn = $('#bk-next1');
    err.textContent = '';
    [f.from, f.to, f.time].forEach((i) => invalid(i, false));
    if (!f.from.value.trim()) { invalid(f.from, true); err.textContent = 'Please enter a pickup location.'; f.from.focus(); return; }
    if (!f.to.value.trim()) { invalid(f.to, true); err.textContent = 'Please enter a drop-off location.'; f.to.focus(); return; }
    const t = new Date(f.time.value);
    if (!f.time.value || isNaN(t) || t.getTime() < Date.now() - 60000) { invalid(f.time, true); err.textContent = 'Please choose a pickup time in the future.'; f.time.focus(); return; }

    busy(btn, true, 'Checking…');
    try {
      const [a, b] = await Promise.all([resolvePlace(f.from), resolvePlace(f.to)]);
      if (!a) { invalid(f.from, true); err.textContent = `We couldn't find “${f.from.value}”. Choose a suggestion or use GPS.`; return; }
      if (!b) { invalid(f.to, true); err.textContent = `We couldn't find “${f.to.value}”. Choose a suggestion or use GPS.`; return; }
      const q = await HM.quote({ serviceType: f.service.value, pickup: pt(a), drop: pt(b), hours: 1, bags: 1, weightKg: 1 });
      if (!q.zone.pickup.inside) { invalid(f.from, true); err.textContent = `Pickup is ${q.zone.pickup.kmFromHub} km from Coimbatore Junction — outside our ${q.zone.radiusKm} km zone.`; return; }
      if (!q.zone.drop.inside) { invalid(f.to, true); err.textContent = `Drop-off is ${q.zone.drop.kmFromHub} km from Coimbatore Junction — outside our ${q.zone.radiusKm} km zone.`; return; }
      const svc = f.service.value;
      if (haversine(a, b) < 0.05 && svc !== 'store' && svc !== 'events') { invalid(f.to, true); err.textContent = 'Pickup and drop-off are the same. Choose “Store & hold” to get your bags back at the same place.'; return; }
      state.from = a; state.to = b;
      goStep(2);
      liveQuote();
    } catch (e2) {
      err.textContent = e2.message;
    } finally {
      busy(btn, false);
    }
  });

  function details() {
    return {
      bags: clamp(parseInt(f.bags.value, 10) || 1, 1, 100),
      weightKg: clamp(parseFloat(f.kg.value) || 1, 1, 1000),
      holdHours: clamp(parseInt(f.hours.value, 10) || 1, 1, 48),
      serviceType: f.service.value
    };
  }

  /* Live server quote on step 2 (debounced) */
  let quoteTimer = null, quoteReq = 0;
  function liveQuote() {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(async () => {
      if (!state.from || !state.to) return;
      const id = ++quoteReq;
      const d = details();
      try {
        const q = await HM.quote({ serviceType: d.serviceType, pickup: pt(state.from), drop: pt(state.to), hours: d.holdHours, bags: d.bags, weightKg: d.weightKg });
        if (id !== quoteReq) return;
        $('#bk-quote').innerHTML = `
          <div><span>Vehicle</span><b>${esc(q.vehicle.name.replace('HoldMate ', ''))}</b></div>
          <div><span>Distance</span><b>≈ ${q.distanceKm.toFixed(1)} km</b></div>
          <div class="bk-quote__total"><span>Estimated total</span><b>${inr(q.price.total)}</b></div>`;
      } catch (err) {
        if (id === quoteReq) $('#bk-quote').innerHTML = `<div class="bk-quote__total"><span>Price</span><b style="font-size:1rem">${esc(err.message)}</b></div>`;
      }
    }, 150);
  }
  ['bags', 'kg', 'hours'].forEach((k) => f[k].addEventListener('input', liveQuote));
  f.service.addEventListener('change', () => { if (state.step === 2) liveQuote(); });

  $('#bk-back2').addEventListener('click', () => goStep(1, true));

  /* Step 2 submit: validate → (login with OTP if needed) → create booking */
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.step === 1) { $('#bk-next1').click(); return; }
    if (state.step === 'otp') { $('#bk-otp-verify').click(); return; }
    if (state.step !== 2) return;
    const err = $('#b-err-2');
    err.textContent = '';
    [f.name, f.phone, f.kg, f.hours, f.bags].forEach((i) => invalid(i, false));
    const kgRaw = parseFloat(f.kg.value), hRaw = parseInt(f.hours.value, 10), bRaw = parseInt(f.bags.value, 10);
    if (!(bRaw >= 1 && bRaw <= 100)) { invalid(f.bags, true); err.textContent = 'Bags should be between 1 and 100.'; return; }
    if (!(kgRaw >= 1 && kgRaw <= 1000)) { invalid(f.kg, true); err.textContent = 'Weight should be between 1 and 1000 kg.'; f.kg.focus(); return; }
    if (!(hRaw >= 1 && hRaw <= 48)) { invalid(f.hours, true); err.textContent = 'Hold time should be between 1 and 48 hours.'; f.hours.focus(); return; }
    const name = f.name.value.trim();
    if (name.length < 2) { invalid(f.name, true); err.textContent = 'Please enter your name.'; f.name.focus(); return; }
    if (!PHONE_RE.test(f.phone.value.replace(/[\s\-()]/g, ''))) { invalid(f.phone, true); err.textContent = 'Please enter a valid 10-digit Indian mobile number.'; f.phone.focus(); return; }

    if (HM.auth.user) createBooking(err, $('#bk-confirm'));
    else startOtp(err);
  });

  async function startOtp(errEl) {
    const btn = $('#bk-confirm');
    const phone = cleanPhone(f.phone.value);
    busy(btn, true, 'Sending code…');
    try {
      await HM.auth.requestOtp(phone);
      state.resendAt = Date.now() + 30000;
    } catch (e) {
      if (e.code !== 'OTP_TOO_SOON' || state.phone !== phone) { errEl.textContent = e.message; return; }
    } finally {
      busy(btn, false);
    }
    state.phone = phone;
    f.otp.value = '';
    $('#b-err-otp').textContent = '';
    $('#b-otp-msg').textContent = `We sent a 6-digit code to ${fmtPhone(phone)}. It is valid for 5 minutes.`;
    goStep('otp');
    resendCountdown();
  }

  let countdown = null;
  function resendCountdown() {
    const b = $('#bk-otp-resend');
    clearInterval(countdown);
    const tick = () => {
      const s = Math.ceil((state.resendAt - Date.now()) / 1000);
      b.disabled = s > 0;
      b.textContent = s > 0 ? `Resend code in ${s}s` : 'Resend code';
      if (s <= 0) clearInterval(countdown);
    };
    tick();
    countdown = setInterval(tick, 1000);
  }
  $('#bk-otp-resend').addEventListener('click', async () => {
    try {
      await HM.auth.requestOtp(state.phone);
      state.resendAt = Date.now() + 30000;
      resendCountdown();
      HM.toast('A new code is on its way.');
    } catch (e) { $('#b-err-otp').textContent = e.message; }
  });
  $('#bk-otp-back').addEventListener('click', () => goStep(2, true));
  f.otp.addEventListener('input', () => { f.otp.value = f.otp.value.replace(/\D/g, '').slice(0, 6); });

  $('#bk-otp-verify').addEventListener('click', async () => {
    const err = $('#b-err-otp');
    const btn = $('#bk-otp-verify');
    err.textContent = '';
    invalid(f.otp, false);
    if (!/^\d{6}$/.test(f.otp.value)) { invalid(f.otp, true); err.textContent = 'Enter the 6-digit code.'; f.otp.focus(); return; }
    busy(btn, true, 'Verifying…');
    try {
      await HM.auth.verifyOtp(state.phone, f.otp.value, f.name.value.trim());
    } catch (e) {
      invalid(f.otp, true);
      err.textContent = e.message;
      busy(btn, false);
      return;
    }
    busy(btn, false);
    HM.toast(`Logged in as ${fmtPhone(state.phone)}`, 'ok');
    createBooking(err, btn);
  });

  async function createBooking(errEl, btn) {
    const d = details();
    busy(btn, true, 'Booking…');
    let res;
    try {
      res = await HM.api('/bookings', {
        method: 'POST',
        silent: true,
        body: {
          serviceType: d.serviceType,
          pickup: placeBody(state.from),
          drop: placeBody(state.to),
          pickupTime: new Date(f.time.value).toISOString(),
          holdHours: d.holdHours,
          bags: d.bags,
          weightKg: d.weightKg
        }
      });
    } catch (e) {
      busy(btn, false);
      if (e.status === 401) { HM.auth.set(null); renderAccountLine(); goStep(2, true); $('#b-err-2').textContent = 'Please verify your number again to book.'; return; }
      errEl.textContent = e.message;
      return;
    }
    busy(btn, false);
    const b = res.booking;
    state.booking = b;
    HM.sessionOtps[b.bookingId] = res.handoverOtp; // kept in memory for this tab only
    $('#bd-id').textContent = b.bookingId;
    $('#bd-otp').textContent = res.handoverOtp;
    $('#bd-vehicle').textContent = b.vehicle ? `${VEHICLE_NAMES[b.vehicle.type] || b.vehicle.type} ${b.vehicle.code} · ${b.locker}` : '—';
    $('#bd-total').textContent = inr(b.price.total);
    $('#bd-qr').innerHTML = HM.qrSvg(`${b.bookingId}:${res.handoverOtp}`, 25);
    goStep(3);
    HM.confetti();
    HM.toast(`Booking ${b.bookingId} confirmed.`, 'ok');
  }

  /* Confirmation actions */
  $('#bd-copy').addEventListener('click', async () => {
    const id = state.booking && state.booking.bookingId;
    if (!id) return;
    let ok = false;
    try { await navigator.clipboard.writeText(id); ok = true; } catch (e) {
      const t = document.createElement('textarea');
      t.value = id; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      t.remove();
    }
    HM.toast(ok ? `Copied ${id}` : `Your booking ID is ${id}`, ok ? 'ok' : 'info');
  });
  $('#bd-track').addEventListener('click', () => {
    const id = state.booking && state.booking.bookingId;
    HM.booking.close();
    HM.scrollTo('#gps');
    if (id && HM.gps) setTimeout(() => HM.gps.track(id), 500);
  });

  /* ==========================================================================
     MY BOOKINGS PANEL (drawer) + login
     ========================================================================== */
  const hero = (title, text) => `<div class="drawer__hero drawer__hero--sm"><h2 id="drawer-title">${title}</h2><p>${text}</p></div>`;

  async function openAccount() {
    HM.openDrawer(hero('My bookings', 'Loading…') + '<div class="spinner spinner--sm"></div>');
    await HM.auth.ready;
    if (HM.auth.user) renderBookings();
    else renderLogin();
  }
  HM.openAccount = openAccount;

  function renderLogin() {
    const body = HM.openDrawer(`
      ${hero('My bookings', 'Log in with your mobile number to see, track and cancel your bookings.')}
      <form id="acct-form" novalidate>
        <div class="field"><label for="a-phone">Mobile number</label><div class="field__row"><svg class="ic field__ic"><use href="#i-phone"/></svg><input id="a-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="98765 43210" data-autofocus /></div></div>
        <div id="a-otp-wrap" hidden>
          <div class="field"><label for="a-otp">6-digit code</label><div class="field__row"><svg class="ic field__ic"><use href="#i-key"/></svg><input id="a-otp" class="mono otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="------" /></div></div>
          <div class="field"><label for="a-name">Your name (new customers)</label><div class="field__row"><svg class="ic field__ic"><use href="#i-user"/></svg><input id="a-name" autocomplete="name" placeholder="Optional" /></div></div>
          ${isLocalApi ? '<p class="muted small dev-note">Development mode: the code is printed in the server console.</p>' : ''}
        </div>
        <p class="field-error" id="a-err" aria-live="polite"></p>
        <button type="submit" class="btn btn--primary btn--block" id="a-submit"><span>Send code</span></button>
      </form>`);
    const formEl = $('#acct-form', body);
    let phone = null;
    $('#a-otp', body).addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#a-err', body);
      const btn = $('#a-submit', body);
      err.textContent = '';
      if (!phone) {
        const raw = $('#a-phone', body).value;
        if (!PHONE_RE.test(raw.replace(/[\s\-()]/g, ''))) { err.textContent = 'Please enter a valid 10-digit Indian mobile number.'; return; }
        busy(btn, true, 'Sending…');
        try {
          await HM.auth.requestOtp(cleanPhone(raw));
        } catch (ex) { err.textContent = ex.message; busy(btn, false); return; }
        phone = cleanPhone(raw);
        btn.dataset.label = 'Verify & log in';
        busy(btn, false);
        $('#a-phone', body).readOnly = true;
        $('#a-otp-wrap', body).hidden = false;
        $('#a-otp', body).focus();
        return;
      }
      const otp = $('#a-otp', body).value;
      if (!/^\d{6}$/.test(otp)) { err.textContent = 'Enter the 6-digit code.'; return; }
      busy(btn, true, 'Verifying…');
      try {
        const nm = $('#a-name', body).value.trim();
        await HM.auth.verifyOtp(phone, otp, nm.length >= 2 ? nm : undefined);
      } catch (ex) { err.textContent = ex.message; busy(btn, false); return; }
      HM.toast('Logged in.', 'ok');
      renderBookings();
    });
  }

  async function renderBookings() {
    const u = HM.auth.user;
    let data;
    try {
      data = await HM.api('/bookings', { silent: true });
    } catch (e) {
      if (e.status === 401) { HM.auth.set(null); return renderLogin(); }
      HM.openDrawer(hero('My bookings', esc(e.message)));
      return;
    }
    const list = data.bookings;
    const cards = list.map((b, i) => `
      <article class="acct-card" style="animation-delay:${Math.min(i, 6) * 50}ms">
        <div class="acct-card__top"><b>${b.bookingId}</b><span class="status-pill${b.status === 'delivered' ? ' is-done' : b.status === 'cancelled' ? ' is-cancelled' : ''}">${STATUS_LABEL[b.status] || b.status}</span></div>
        <p class="acct-card__route">${esc(b.pickup.name)} → ${esc(b.drop.name)}</p>
        <div class="acct-card__meta">
          <span>${fmtTime(b.pickupTime)}</span>
          <span>${SERVICE_NAMES[b.serviceType] || b.serviceType}</span>
          <span>${b.bags} bag${b.bags > 1 ? 's' : ''} · ${b.weightKg} kg</span>
          ${b.vehicle ? `<span>${b.vehicle.code}${b.locker ? ' · locker ' + b.locker : ''}</span>` : ''}
          <span><b>${inr(b.price.total)}</b> · ${b.payment.status}</span>
        </div>
        <div class="btn-row">
          ${b.status !== 'cancelled' ? `<button type="button" class="btn btn--primary btn--sm" data-acct-track="${b.bookingId}"><svg class="ic"><use href="#i-target"/></svg><span>Track</span></button>` : ''}
          ${b.canCancel ? `<button type="button" class="btn btn--ghost-dark btn--sm" data-acct-cancel="${b.bookingId}"><span>Cancel</span></button>` : ''}
        </div>
      </article>`).join('');
    HM.openDrawer(`
      ${hero('My bookings', 'Track a booking live, or cancel free of charge up to 1 hour before pickup.')}
      <div class="acct-head">
        <div><b>${esc(u.name)}</b><span>${esc(fmtPhone(u.phone))}${u.role !== 'customer' ? ' · ' + u.role : ''}</span></div>
        <button type="button" class="btn btn--ghost-dark btn--sm" data-acct-logout><span>Log out</span></button>
      </div>
      ${list.length ? `<div class="acct-list">${cards}</div>` : `<div class="acct-empty"><p>You have no bookings yet.</p><button type="button" class="btn btn--primary btn--sm" data-book><span>Book your first pickup</span></button></div>`}`);
  }

  /* Drawer actions (delegated) */
  document.addEventListener('click', async (e) => {
    const acct = e.target.closest('[data-account]');
    if (acct) { openAccount(); return; }

    const tr = e.target.closest('[data-acct-track]');
    if (tr) {
      HM.closeDrawer();
      HM.scrollTo('#gps');
      setTimeout(() => HM.gps && HM.gps.track(tr.dataset.acctTrack), 500);
      return;
    }
    const cancel = e.target.closest('[data-acct-cancel]');
    if (cancel) {
      if (!cancel.dataset.armed) { // two-tap confirm instead of a browser dialog
        cancel.dataset.armed = '1';
        $('span', cancel).textContent = 'Tap again to cancel';
        setTimeout(() => { if (cancel.isConnected) { delete cancel.dataset.armed; $('span', cancel).textContent = 'Cancel'; } }, 4000);
        return;
      }
      cancel.disabled = true;
      try {
        const d = await HM.api(`/bookings/${cancel.dataset.acctCancel}/cancel`, { method: 'PATCH', body: {} });
        HM.toast(d.message || 'Booking cancelled.', 'ok');
      } catch (ex) { /* toast already shown */ }
      renderBookings();
      return;
    }
    if (e.target.closest('[data-acct-logout]')) {
      await HM.auth.logout();
      HM.toast('Logged out.');
      renderLogin();
    }
  });

  /* Navbar account indicator */
  HM.auth.onChange((u) => {
    $$('.nav-account').forEach((b) => {
      b.classList.toggle('is-auth', !!u);
      b.setAttribute('aria-label', u ? `My bookings (logged in as ${u.name})` : 'My bookings');
      b.title = u ? `My bookings · ${u.name}` : 'My bookings';
    });
  });
})();
