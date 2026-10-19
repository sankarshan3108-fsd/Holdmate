/* ==========================================================================
   HoldMate — gps.js
   Live GPS section: lazy-loaded Leaflet map, 15 km service zone, "share my
   location" (watchPosition), GPS buttons with reverse geocoding (Nominatim),
   booking tracking along a real road route (OSRM) and route chips.
   ========================================================================== */
(function () {
  'use strict';

  const HM = (window.HM = window.HM || {});
  const { $, $$, clamp } = HM;
  const CFG = HM.CONFIG;
  const HUB = CFG.HUB;
  const { haversine, fromHub, inZone, nearestPlace } = HM.geo;

  const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1';

  const section = $('#gps');
  const mapEl = $('#map');
  const placeholder = $('#map-placeholder');
  const hint = $('#map-hint');
  const isTouch = window.matchMedia('(pointer: coarse)').matches;

  let L = null;          // Leaflet namespace once loaded
  let map = null;
  let zoneCircle = null;
  let mapPromise = null;
  let mapFailed = false;

  const icon = (id) => `<svg class="ic"><use href="#${id}"/></svg>`;

  /* ==========================================================================
     1. LAZY-LOAD LEAFLET (only when the GPS section is near the viewport)
     ========================================================================== */
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    return new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = LEAFLET_CSS; css.crossOrigin = '';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = LEAFLET_JS; s.async = true; s.crossOrigin = '';
      const timer = setTimeout(() => reject(new Error('timeout')), 12000);
      s.onload = () => { clearTimeout(timer); window.L ? resolve(window.L) : reject(new Error('no L')); };
      s.onerror = () => { clearTimeout(timer); reject(new Error('load error')); };
      document.head.appendChild(s);
    });
  }

  function ensureMap() {
    if (mapPromise) return mapPromise;
    // wait for Leaflet and for the places/hub/zone from GET /api/places
    mapPromise = Promise.all([loadLeaflet(), HM.placesReady]).then(([Lf]) => { L = Lf; initMap(); return map; }).catch(() => {
      mapFailed = true;
      placeholder.classList.add('is-error');
      placeholder.innerHTML = `<p><b>The live map couldn't load.</b><br>You may be offline or the map service is blocked. Location checks and booking tracking still work in the panel.</p>`;
      hint.classList.add('is-hidden');
      return null;
    });
    return mapPromise;
  }

  const lazyIO = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { lazyIO.disconnect(); ensureMap(); }
  }, { rootMargin: '700px 0px' });
  lazyIO.observe(section);

  /* ==========================================================================
     2. MAP SETUP
     ========================================================================== */
  function initMap() {
    map = L.map(mapEl, {
      center: [HUB.lat, HUB.lng],
      zoom: 12,
      zoomControl: true,
      scrollWheelZoom: false,   // enabled only after the user clicks the map
      dragging: !isTouch,       // on phones: tap to activate, so page scroll keeps working
      tap: false,
      attributionControl: true
    });
    map.zoomControl.setPosition('topright');

    // Tiles: OpenStreetMap (tinted blue in CSS), falling back to CARTO, then to a message.
    // (CARTO's free basemaps now watermark tiles without an API key, so OSM is primary.)
    let tileErrors = 0, tileLoaded = false, usingFallback = false;
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });
    const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, subdomains: 'abcd',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    });
    const onLoad = () => { tileLoaded = true; hidePlaceholder(); };
    const onError = () => {
      tileErrors++;
      if (tileLoaded || tileErrors < 6) return;
      if (!usingFallback) {
        usingFallback = true; tileErrors = 0;
        map.removeLayer(osm); carto.addTo(map);
      } else {
        showTileMessage();
      }
    };
    [osm, carto].forEach((l) => { l.on('tileload', onLoad); l.on('tileerror', onError); });
    osm.addTo(map);
    setTimeout(() => { if (!tileLoaded) showTileMessage(); }, 9000);

    // Service zone + hub
    zoneCircle = L.circle([HUB.lat, HUB.lng], {
      radius: CFG.ZONE_KM * 1000, color: '#0B49C6', weight: 2, dashArray: '8 8',
      fillColor: '#5EC8FF', fillOpacity: 0.07, interactive: false
    }).addTo(map);
    L.marker([HUB.lat, HUB.lng], {
      icon: L.divIcon({ className: '', html: `<div class="mk-hub">${icon('i-lock')}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] }),
      zIndexOffset: 500, keyboard: false
    }).addTo(map).bindTooltip('HoldMate hub · Coimbatore Junction', { className: 'hm-tip', direction: 'top', offset: [0, -20] });

    // Landmarks as small stops
    CFG.PLACES.filter((p) => p.name !== HUB.name).forEach((p) => {
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', html: '<div class="mk-stop"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }),
        keyboard: false
      }).addTo(map).bindTooltip(p.name, { className: 'hm-tip', direction: 'top', offset: [0, -6] });
    });
    map.fitBounds(zoneCircle.getBounds(), { padding: [10, 10] });

    // Scroll-zoom / drag only after the map is clicked (so Lenis & page scroll aren't hijacked)
    const activate = () => {
      map.scrollWheelZoom.enable();
      if (isTouch) map.dragging.enable();
      mapEl.dataset.scrollzoom = 'on';
      hint.classList.add('is-hidden');
    };
    const deactivate = () => {
      map.scrollWheelZoom.disable();
      if (isTouch) map.dragging.disable();
      mapEl.dataset.scrollzoom = 'off';
      hint.classList.remove('is-hidden');
    };
    if (isTouch) hint.textContent = 'Tap the map to move and zoom';
    map.on('click', activate);
    map.on('mouseout', deactivate);
    document.addEventListener('touchstart', (e) => { if (mapEl.dataset.scrollzoom === 'on' && !mapEl.contains(e.target)) deactivate(); }, { passive: true });
    HM.whenVisible(mapEl, (v) => { if (!v) deactivate(); }, '0px');

    // Keep the map sized correctly (reveal animation, resizes)
    if ('ResizeObserver' in window) new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(mapEl);
    setTimeout(() => map.invalidateSize(), 1000);
  }
  function hidePlaceholder() { placeholder.classList.add('is-hidden'); }
  function showTileMessage() {
    if (placeholder.classList.contains('is-error')) return;
    placeholder.classList.remove('is-hidden');
    placeholder.classList.add('is-error');
    placeholder.style.background = 'rgba(243,247,255,.92)';
    placeholder.innerHTML = '<p><b>Map tiles couldn\'t load.</b><br>You may be offline. Markers, routes and tracking still work.</p>';
    setTimeout(() => placeholder.classList.add('is-hidden'), 5000);
  }

  /* ==========================================================================
     3. "SHARE MY LOCATION" — live position, accuracy, distance & zone
     ========================================================================== */
  const statusEl = $('#gps-status');
  const shareBtn = $('#gps-share');
  const stopBtn = $('#gps-stop');
  let watchId = null;
  let me = null;            // { lat, lng, acc }
  let meMarker = null, meCircle = null, meLine = null, firstFix = true;

  function status(type, title, text) {
    statusEl.innerHTML = `<div class="st st--${type}"><div><b>${title}</b>${text ? `<span>${text}</span>` : ''}</div></div>`;
  }
  function geoErrorText(err) {
    if (!window.isSecureContext) return ['GPS needs a secure page', 'Browsers only share location on https:// or http://localhost. Open the site with VS Code Live Server instead of double-clicking index.html.'];
    switch (err && err.code) {
      case 1: return ['Location permission denied', 'Allow location for this site in your browser settings (the icon next to the address bar), then try again.'];
      case 2: return ['Position unavailable', 'We couldn\'t get a fix. Check that location services / GPS are turned on.'];
      case 3: return ['Location timed out', 'It took too long to find you. Move to an open area or near a window and try again.'];
      default: return ['Location error', 'Something went wrong while getting your location. Please try again.'];
    }
  }
  function geoSupported() {
    if (!('geolocation' in navigator)) { status('err', 'GPS not supported', 'This browser does not support location.'); return false; }
    if (!window.isSecureContext) { const [t, d] = geoErrorText(); status('err', t, d); return false; }
    return true;
  }

  function startSharing() {
    if (!geoSupported() || watchId !== null) return;
    status('info', 'Finding you…', 'Your browser may ask for permission.');
    shareBtn.disabled = true;
    firstFix = true;
    watchId = navigator.geolocation.watchPosition(onPosition, (err) => {
      const [t, d] = geoErrorText(err);
      status('err', t, d);
      stopSharing(true);
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  function stopSharing(keepStatus) {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    shareBtn.disabled = false;
    stopBtn.hidden = true;
    $('span', shareBtn).textContent = 'Share my location';
    if (map) [meMarker, meCircle, meLine].forEach((l) => l && map.removeLayer(l));
    meMarker = meCircle = meLine = null;
    me = null;
    if (!keepStatus) statusEl.innerHTML = '';
  }
  async function onPosition(pos) {
    me = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
    stopBtn.hidden = false;
    shareBtn.disabled = false;
    $('span', shareBtn).textContent = 'Sharing live';
    const km = fromHub(me);
    const inside = km <= CFG.ZONE_KM;
    status(inside ? 'ok' : 'err',
      inside ? `You're inside the zone · ${km.toFixed(1)} km from the hub` : `Outside the zone · ${km.toFixed(1)} km from the hub`,
      `${inside ? 'We can pick up and deliver here.' : `We currently serve ${CFG.ZONE_KM} km around Coimbatore Junction.`} Accuracy ±${Math.round(me.acc)} m.`);
    await ensureMap();
    if (!map) return;
    const ll = [me.lat, me.lng];
    if (!meMarker) {
      meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="mk-me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 800, keyboard: false })
        .addTo(map).bindTooltip('You are here', { className: 'hm-tip', direction: 'top', offset: [0, -10] });
      meCircle = L.circle(ll, { radius: me.acc, color: '#5EC8FF', weight: 1, fillColor: '#5EC8FF', fillOpacity: 0.15, interactive: false }).addTo(map);
      meLine = L.polyline([[HUB.lat, HUB.lng], ll], { color: '#061440', weight: 2, dashArray: '4 8', opacity: 0.6, interactive: false }).addTo(map);
    } else {
      meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(me.acc); meLine.setLatLngs([[HUB.lat, HUB.lng], ll]);
    }
    if (firstFix) {
      firstFix = false;
      map.flyToBounds(L.latLngBounds([[HUB.lat, HUB.lng], ll]).pad(0.35), { duration: 1.1, maxZoom: 15 });
    }
  }
  shareBtn.addEventListener('click', startSharing);
  stopBtn.addEventListener('click', () => stopSharing());

  /* ==========================================================================
     4. GPS BUTTONS IN FORMS — fill the address via reverse geocoding
     ========================================================================== */
  async function reverseGeocode(lat, lng) {
    try {
      const d = await HM.fetchJSON(`${NOMINATIM_REVERSE}&lat=${lat}&lon=${lng}`, 6000);
      const a = (d && d.address) || {};
      const local = a.road || a.neighbourhood || a.suburb || a.quarter || a.village || '';
      const area = a.suburb || a.city_district || a.town || a.city || '';
      const label = [local, area !== local ? area : ''].filter(Boolean).join(', ');
      return label || (d && d.display_name ? d.display_name.split(',').slice(0, 2).join(',') : null);
    } catch (e) {
      return null;
    }
  }
  function getPosition() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
  }
  async function fillLocation(input, btn) {
    if (!('geolocation' in navigator)) { HM.toast('This browser does not support location.', 'err'); return; }
    if (!window.isSecureContext) { HM.toast(geoErrorText()[1], 'err', 6000); return; }
    btn && btn.classList.add('is-busy');
    const prev = input.placeholder;
    input.placeholder = 'Locating…';
    try {
      const pos = await getPosition();
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      let label = await reverseGeocode(lat, lng);
      if (!label) { const n = nearestPlace({ lat, lng }); label = n.place ? `My location (near ${n.place.name})` : 'My location'; }
      input.value = label;
      input.dataset.lat = lat; input.dataset.lng = lng; input.dataset.label = label;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const km = fromHub({ lat, lng });
      HM.toast(km <= CFG.ZONE_KM ? `Location set · ${km.toFixed(1)} km from the hub, inside our zone.` : `Location set, but it's ${km.toFixed(1)} km away — outside our ${CFG.ZONE_KM} km zone.`, km <= CFG.ZONE_KM ? 'ok' : 'err', 4500);
    } catch (err) {
      const [t, d] = geoErrorText(err);
      HM.toast(`${t}. ${d}`, 'err', 6500);
    } finally {
      btn && btn.classList.remove('is-busy');
      input.placeholder = prev;
    }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gps-for]');
    if (!b) return;
    const input = document.getElementById(b.dataset.gpsFor);
    if (input) fillLocation(input, b);
  });

  /* ==========================================================================
     5. ROAD ROUTES (OSRM public API, straight-line fallback)
     ========================================================================== */
  const routeCache = new Map();
  async function roadRoute(points) {
    const key = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
    if (routeCache.has(key)) return routeCache.get(key);
    let coords = null, road = false;
    try {
      const d = await HM.fetchJSON(`${OSRM}${key}?overview=full&geometries=geojson`, 7000);
      if (d && d.code === 'Ok' && d.routes && d.routes[0]) {
        coords = d.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
        road = true;
      }
    } catch (e) { /* offline or rate-limited → fallback */ }
    if (!coords) {
      // Straight segments, densified so the van moves smoothly
      coords = [];
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const n = Math.max(2, Math.ceil(haversine(a, b) * 10));
        for (let k = 0; k < n; k++) coords.push({ lat: a.lat + (b.lat - a.lat) * (k / n), lng: a.lng + (b.lng - a.lng) * (k / n) });
      }
      coords.push(points[points.length - 1]);
    }
    const res = { coords, road };
    routeCache.set(key, res);
    return res;
  }

  /* ==========================================================================
     6. ROUTE CHIPS (Junction loop / Airport line / Campus line)
     ========================================================================== */
  const ROUTES = {
    loop: { name: 'Junction loop', live: true, stops: ['Coimbatore Junction', 'Town Hall', 'Ukkadam', 'RS Puram', 'Gandhipuram', 'Race Course', 'Coimbatore Junction'] },
    airport: { name: 'Airport & Avinashi Road', live: false, stops: ['Coimbatore Junction', 'Avinashi Road (Lakshmi Mills)', 'PSG Tech', 'Peelamedu', 'Coimbatore Airport'] },
    campus: { name: 'Colleges & hostels', live: false, stops: ['Coimbatore Junction', 'RS Puram', 'Saibaba Colony', 'Vadavalli', 'Ganapathy', 'PSG Tech'] }
  };
  let routeLayer = null;
  let routeReq = 0;
  async function showRoute(key) {
    const r = ROUTES[key];
    if (!r) return;
    $$('[data-route]').forEach((c) => c.classList.toggle('is-active', c.dataset.route === key));
    const req = ++routeReq;
    await ensureMap();
    if (!map) { HM.toast(`${r.name}: ${r.stops.join(' → ')}`, 'info', 6000); return; }
    const P = Object.fromEntries(CFG.PLACES.map((p) => [p.name, p]));
    const stops = r.stops.map((n) => P[n]).filter(Boolean);
    if (stops.length < 2) { HM.toast('Route data is unavailable right now.', 'err'); return; }
    const { coords } = await roadRoute(stops);
    if (req !== routeReq) return; // a newer request won
    if (routeLayer) map.removeLayer(routeLayer);
    const ll = coords.map((c) => [c.lat, c.lng]);
    routeLayer = L.layerGroup([
      L.polyline(ll, { color: '#FFFFFF', weight: 9, opacity: 0.9, interactive: false }),
      L.polyline(ll, { color: r.live ? '#0B49C6' : '#2563EB', weight: 5, opacity: 0.95, dashArray: r.live ? null : '10 10', interactive: false }),
      ...stops.slice(0, key === 'loop' ? -1 : undefined).map((s) => L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: '', html: '<div class="mk-stop"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }), keyboard: false
      }).bindTooltip(s.name, { className: 'hm-tip', direction: 'top', offset: [0, -6] }))
    ]).addTo(map);
    map.flyToBounds(L.latLngBounds(ll).pad(0.15), { duration: 1.1 });
    HM.toast(`${r.name}${r.live ? ' — running now (pilot)' : ' — coming soon'}`);
  }
  $$('[data-route]').forEach((c) => c.addEventListener('click', () => showRoute(c.dataset.route)));
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-show-route]');
    if (!c) return;
    HM.scrollTo('#gps');
    setTimeout(() => showRoute(c.dataset.showRoute), 700);
  });

  /* ==========================================================================
     7. BOOKING TRACKING
     GET /api/track/:bookingId, then join the booking's Socket.IO room.
     Live positions move the van marker. If the vehicle has no live GPS yet,
     a simulated van is shown instead (labelled "Demo feed").
     ========================================================================== */
  const trackForm = $('#track-form');
  const trackInput = $('#track-id');
  const trackErr = $('#track-error');
  const ui = {
    box: $('#tracker'), id: $('#tr-id'), status: $('#tr-status'), route: $('#tr-route'),
    eta: $('#tr-eta'), dist: $('#tr-dist'), speed: $('#tr-speed'), bar: $('#tr-bar'),
    steps: $$('#tr-timeline li'), otp: $('#tr-otp'), otpCode: $('#tr-otp-code'), otpLabel: $('#tr-otp-label'), note: $('#tr-note')
  };
  const STATUS_TEXT = {
    booked: 'Booked · awaiting pickup', picked_up: 'Picked up & sealed', in_locker: 'In locker', on_the_way: 'On the way',
    arrived: 'Arrived · share OTP', delivered: 'Delivered', cancelled: 'Cancelled'
  };
  // [completed steps, current step] for the 5-step timeline
  const TIMELINE = { booked: [1, 1], picked_up: [2, 2], in_locker: [3, 3], on_the_way: [4, 4], arrived: [4, 4], delivered: [5, -1], cancelled: [1, -1] };

  let current = null;   // { id, data, coords, cum, total, pickupAt, mode: 'live' | 'sim' }
  let trip = null;      // simulation state (demo feed)
  let trackLayer = null;
  let vanMarker = null;
  let follow = false;
  let socket = null;
  let pollTimer = null;
  let lastPan = 0;

  function normaliseId(v) {
    let s = String(v || '').trim().toUpperCase().replace(/\s+/g, '');
    if (/^\d{4}$/.test(s)) s = `HM-${s}`;
    if (/^HM\d{4}$/.test(s)) s = `HM-${s.slice(2)}`;
    return s;
  }

  function setTimeline(done, cur) {
    ui.steps.forEach((li, i) => {
      li.classList.toggle('is-done', i < done);
      li.classList.toggle('is-current', i === cur);
    });
  }

  function renderStatus(status) {
    ui.status.textContent = STATUS_TEXT[status] || status;
    ui.status.classList.toggle('is-done', status === 'delivered');
    const [done, cur] = TIMELINE[status] || [1, 1];
    setTimeline(done, cur);
    if (status === 'arrived') {
      const otp = current && HM.sessionOtps[current.id];
      ui.otpLabel.textContent = otp ? 'Van has arrived. Share this handover OTP with the captain:' : 'Van has arrived. Share the 4-digit handover OTP from your booking confirmation with the captain.';
      ui.otpCode.textContent = otp || '';
      ui.otp.hidden = false;
      ui.eta.textContent = 'Now';
      ui.dist.textContent = '0.0 km';
    } else {
      ui.otp.hidden = true;
    }
    if (status === 'delivered') {
      ui.eta.textContent = 'Done'; ui.dist.textContent = '0.0 km'; ui.speed.textContent = '0 km/h';
      ui.bar.style.transform = 'scaleX(1)';
    }
    if (status === 'cancelled') {
      ui.eta.textContent = '—'; ui.dist.textContent = '—'; ui.speed.textContent = '—';
    }
  }

  async function track(rawId) {
    const id = normaliseId(rawId);
    trackInput.value = id;
    trackErr.textContent = '';
    if (!/^HM-\d{4}$/.test(id)) { trackErr.textContent = 'Booking IDs look like HM-1234. Try the demo ID HM-4821.'; trackInput.focus(); return; }

    let data;
    try {
      data = (await HM.api(`/track/${id}`, { silent: true })).tracking;
    } catch (e) {
      trackErr.textContent = e.status === 404 ? `No booking found with ID ${id}. Try the demo ID HM-4821.` : e.message;
      return;
    }

    stopTracking();
    current = { id, data, mode: null };
    ui.box.hidden = false;
    ui.id.textContent = id;
    const veh = data.vehicle ? `${HM.VEHICLE_NAMES[data.vehicle.type] || ''} ${data.vehicle.code}${data.locker ? ' · locker ' + data.locker : ''}` : 'Vehicle not assigned yet';
    ui.route.textContent = `${data.pickup.name} → ${data.drop.name} · ${veh}`;
    ui.bar.style.transform = 'scaleX(0)';
    ['eta', 'dist', 'speed'].forEach((k) => { ui[k].textContent = '--'; });
    renderStatus(data.status);
    ui.note.textContent = 'Loading route…';

    await ensureMap();
    const { coords, road } = await roadRoute([HUB, data.pickup, data.drop]);
    if (!current || current.id !== id) return; // another booking was tracked meanwhile

    // Cumulative distance along the route (km) and where the pickup is on it
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
    const total = cum[cum.length - 1] || 0.001;
    let pi = 0, pd = Infinity;
    coords.forEach((c, i) => { const d = haversine(c, data.pickup); if (d < pd && cum[i] < total * 0.98) { pd = d; pi = i; } });
    Object.assign(current, { coords, cum, total, pickupAt: cum[pi], road });

    if (map) {
      if (trackLayer) map.removeLayer(trackLayer);
      const ll = coords.map((c) => [c.lat, c.lng]);
      const pin = (cls, letter) => L.divIcon({ className: '', html: `<div class="mk-pt ${cls}"><b>${letter}</b></div>`, iconSize: [30, 30], iconAnchor: [15, 30] });
      vanMarker = L.marker(ll[0], {
        icon: L.divIcon({ className: '', html: `<div class="mk-van">${icon('i-van')}</div>`, iconSize: [38, 38], iconAnchor: [19, 19] }),
        zIndexOffset: 1000, keyboard: false
      });
      trackLayer = L.layerGroup([
        L.polyline(ll, { color: '#FFFFFF', weight: 9, opacity: 0.95, interactive: false }),
        L.polyline(ll, { color: '#0B49C6', weight: 5, interactive: false }),
        L.marker([data.pickup.lat, data.pickup.lng], { icon: pin('', 'P'), keyboard: false }).bindTooltip(`Pickup · ${data.pickup.name}`, { className: 'hm-tip', direction: 'top', offset: [0, -30] }),
        L.marker([data.drop.lat, data.drop.lng], { icon: pin('mk-pt--drop', 'D'), keyboard: false }).bindTooltip(`Drop-off · ${data.drop.name}`, { className: 'hm-tip', direction: 'top', offset: [0, -30] }),
        vanMarker
      ]).addTo(map);
      map.flyToBounds(L.latLngBounds(ll).pad(0.2), { duration: 1.1 });
    }

    const loc = data.vehicle && data.vehicle.location;
    if (loc && loc.live) goLive(loc, data.eta);
    else startSim(loc);
    connectRealtime(id);
    HM.toast(`Tracking ${id}`);
  }

  function stopTracking() {
    stopSim();
    HM.ticker.remove(liveTick);
    clearInterval(pollTimer);
    if (socket && current) socket.emit('track:leave', current.id);
    current = null;
  }

  /* ---------- Live mode (real GPS from the vehicle) ---------- */
  let anim = null; // marker tween between two GPS fixes
  function liveTick(t, dt) {
    if (!anim || !vanMarker) return;
    anim.t = Math.min(1, anim.t + dt / 900);
    const k = HM.easeOutExpo ? 1 - Math.pow(1 - anim.t, 3) : anim.t;
    vanMarker.setLatLng([anim.from.lat + (anim.to.lat - anim.from.lat) * k, anim.from.lng + (anim.to.lng - anim.from.lng) * k]);
    if (anim.t >= 1) { anim = null; HM.ticker.remove(liveTick); }
  }
  function goLive(p, eta) {
    if (!current) return;
    if (current.mode !== 'live') {
      current.mode = 'live';
      stopSim();
      ui.note.textContent = 'Live GPS feed from the vehicle.';
    }
    if (vanMarker) {
      const from = vanMarker.getLatLng();
      anim = { from: { lat: from.lat, lng: from.lng }, to: { lat: p.lat, lng: p.lng }, t: 0 };
      HM.ticker.add(liveTick);
    }
    const now = performance.now();
    if (map && follow && now - lastPan > 900) { map.panTo([p.lat, p.lng], { animate: true, duration: 0.8 }); lastPan = now; }
    const status = current.data.status;
    if (status === 'arrived' || status === 'delivered' || status === 'cancelled') return renderStatus(status);
    ui.speed.textContent = `${Math.round(p.speed || 0)} km/h`;
    if (eta) {
      ui.eta.textContent = `${eta.minutes} min`;
      ui.dist.textContent = `${eta.distanceKm.toFixed(1)} km`;
      const full = HM.geo.roadKm(HUB, current.data.pickup) + HM.geo.roadKm(current.data.pickup, current.data.drop);
      ui.bar.style.transform = `scaleX(${clamp(1 - eta.distanceKm / full, 0, 1).toFixed(3)})`;
    }
  }

  /* ---------- Demo feed (simulation) when there is no live GPS ---------- */
  function projectOnRoute(loc) {
    if (!loc || !current.coords) return null;
    let best = -1, bd = Infinity;
    current.coords.forEach((c, i) => { const d = haversine(c, loc); if (d < bd) { bd = d; best = i; } });
    return best >= 0 ? current.cum[best] : null;
  }
  function startSim(lastLoc) {
    if (!current || !current.coords) return;
    stopSim();
    current.mode = 'sim';
    ui.note.textContent = `Demo feed: simulated van until the vehicle shares live GPS${current.road ? '' : ' · straight-line route (road routing unavailable)'}.`;
    const { total, pickupAt } = current;
    const status = current.data.status;
    let s = 0, target = 0;
    if (status === 'booked' || status === 'cancelled') { s = target = 0; }
    else if (status === 'picked_up' || status === 'in_locker') { s = target = pickupAt; }
    else if (status === 'on_the_way') {
      const proj = projectOnRoute(lastLoc);
      s = proj !== null && proj > pickupAt && proj < total * 0.95 ? proj : pickupAt;
      target = total * 0.995; // waits just before the door until the captain marks "arrived"
    } else { s = target = total; }
    if (trip && trip.status === status) s = trip.s; // keep position when re-planning
    trip = { s, target, status, kmPerMs: Math.max(0, target - s) / 40000, speed: 24, lastUi: 0 };
    HM.ticker.add(simulate);
  }
  function stopSim() {
    HM.ticker.remove(simulate);
  }
  function simulate(t, dt) {
    const tr = trip;
    if (!tr || !current || current.mode !== 'sim') return;
    const moving = tr.s < tr.target;
    if (moving) {
      tr.s = Math.min(tr.target, tr.s + tr.kmPerMs * dt);
      tr.speed = clamp(tr.speed + (Math.random() - 0.5) * 0.8, 16, 34);
    }
    const pos = pointAt(current, tr.s);
    if (vanMarker) vanMarker.setLatLng([pos.lat, pos.lng]);
    if (map && follow && t - lastPan > 900) { map.panTo([pos.lat, pos.lng], { animate: true, duration: 0.8 }); lastPan = t; }
    if (t - tr.lastUi < 250) return;
    tr.lastUi = t;
    const status = current.data.status;
    if (status === 'arrived' || status === 'delivered' || status === 'cancelled') return;
    const left = Math.max(0, current.total - tr.s);
    ui.bar.style.transform = `scaleX(${(tr.s / current.total).toFixed(4)})`;
    ui.dist.textContent = `${left.toFixed(1)} km`;
    ui.speed.textContent = moving ? `${Math.round(tr.speed)} km/h` : '0 km/h';
    if (status === 'booked') {
      ui.eta.textContent = new Date(current.data.pickupTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    } else {
      ui.eta.textContent = `${Math.max(1, Math.round((left / Math.max(tr.speed, 12)) * 60))} min`;
    }
    if (!moving) stopSim(); // stationary: nothing more to animate
  }
  function pointAt(tr, s) {
    const { cum, coords } = tr;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const seg = cum[hi] - cum[lo] || 1;
    const k = clamp((s - cum[lo]) / seg, 0, 1);
    return { lat: coords[lo].lat + (coords[hi].lat - coords[lo].lat) * k, lng: coords[lo].lng + (coords[hi].lng - coords[lo].lng) * k };
  }

  /* ---------- Realtime: Socket.IO room per booking (+ polling fallback) ---------- */
  function loadSocketClient() {
    if (window.io) return Promise.resolve(window.io);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${HM.API_BASE}/socket.io/socket.io.js`; // served by the HoldMate backend
      s.async = true;
      s.onload = () => (window.io ? resolve(window.io) : reject(new Error('no io')));
      s.onerror = () => reject(new Error('socket client failed to load'));
      document.head.appendChild(s);
    });
  }

  /* Real GPS positions arrive here: the captain app calls POST /api/vehicles/:id/location
     and the server broadcasts "vehicle:location" to this booking's room. */
  function onVehicleLocation(p) {
    if (!current || p.bookingId !== current.id) return;
    goLive({ lat: p.lat, lng: p.lng, speed: p.speed, live: true }, p.eta);
  }
  function onBookingStatus(p) {
    if (!current || p.bookingId !== current.id) return;
    const changed = current.data.status !== p.status;
    current.data.status = p.status;
    current.data.statusHistory = p.statusHistory || current.data.statusHistory;
    renderStatus(p.status);
    if (current.mode === 'sim' && changed) startSim(null);
    if (changed && p.status === 'delivered') HM.toast(`${current.id} delivered. Thank you for using HoldMate!`, 'ok');
    if (changed && p.status === 'arrived') HM.toast(`Your bags have arrived at ${current.data.drop.name}.`, 'ok', 5000);
  }

  async function connectRealtime(id) {
    try {
      const ioFn = await loadSocketClient();
      if (!socket) {
        socket = ioFn(HM.API_BASE || undefined, { withCredentials: true, transports: ['websocket', 'polling'] });
        socket.on('vehicle:location', onVehicleLocation);
        socket.on('booking:status', onBookingStatus);
        socket.on('booking:assigned', (p) => { if (current && p.bookingId === current.id) track(current.id); });
        socket.on('connect', () => { if (current) socket.emit('track:join', current.id, () => {}); });
      } else if (socket.connected && current && current.id === id) {
        socket.emit('track:join', id, () => {});
      }
    } catch (e) { /* Socket.IO unavailable: polling below keeps the tracker updated */ }

    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (!current || current.id !== id || (socket && socket.connected) || document.hidden) return;
      try {
        const d = (await HM.api(`/track/${id}`, { silent: true })).tracking;
        if (!current || current.id !== id) return;
        onBookingStatus({ bookingId: id, status: d.status, statusHistory: d.statusHistory });
        const loc = d.vehicle && d.vehicle.location;
        if (loc && loc.live) goLive(loc, d.eta);
      } catch (e) { /* try again next tick */ }
    }, 15000);
  }

  trackForm.addEventListener('submit', (e) => { e.preventDefault(); track(trackInput.value); });
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-demo-track]')) track('HM-4821');
  });

  /* ==========================================================================
     8. MAP TOOLS
     ========================================================================== */
  const followBtn = $('#mt-follow'), zoneBtn = $('#mt-zone'), meBtn = $('#mt-me');
  followBtn.addEventListener('click', () => {
    follow = !follow;
    followBtn.classList.toggle('is-on', follow);
    followBtn.setAttribute('aria-pressed', String(follow));
    if (follow && !current) HM.toast('Track a booking to follow its van. Try HM-4821.');
    if (follow && map && vanMarker) map.flyTo(vanMarker.getLatLng(), 15, { duration: 0.9 });
  });
  zoneBtn.addEventListener('click', async () => {
    await ensureMap();
    if (!map) return;
    const on = map.hasLayer(zoneCircle);
    on ? map.removeLayer(zoneCircle) : zoneCircle.addTo(map);
    zoneBtn.classList.toggle('is-on', !on);
    zoneBtn.setAttribute('aria-pressed', String(!on));
  });
  meBtn.addEventListener('click', async () => {
    if (me && map) { map.flyTo([me.lat, me.lng], 15, { duration: 0.9 }); return; }
    startSharing();
  });

  HM.gps = { track, showRoute, fillLocation, ensureMap };
})();
