/* ==========================================================================
   HoldMate — main.js
   Core UI: one requestAnimationFrame loop, Lenis smooth scroll, preloader,
   scroll effects, cursor, tilt, reveals, counters, sliders, accordion,
   drawer, toasts, confetti, locker grid, mobile menu.
   Exposes a small global namespace `window.HM` used by booking.js & gps.js.
   ========================================================================== */
(function () {
  'use strict';

  const HM = (window.HM = window.HM || {});
  const doc = document;
  const root = doc.documentElement;
  root.classList.add('js');

  /* ---------- Helpers ---------- */
  const $ = (s, c = doc) => c.querySelector(s);
  const $$ = (s, c = doc) => Array.from(c.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  Object.assign(HM, { $, $$, clamp, lerp, easeOutExpo, reduced, finePointer });

  /* ==========================================================================
     1. SINGLE ANIMATION LOOP
     Every per-frame task (Lenis, scroll effects, canvas, van, cursor, tweens)
     registers here so the page only ever runs one requestAnimationFrame.
     The browser pauses rAF automatically when the tab is hidden.
     ========================================================================== */
  const tasks = new Set();
  HM.ticker = {
    add(fn) { tasks.add(fn); return () => tasks.delete(fn); },
    remove(fn) { tasks.delete(fn); }
  };
  let lastT = 0;
  function frame(t) {
    const dt = Math.min(64, lastT ? t - lastT : 16); // clamp after tab switches
    lastT = t;
    if (lenis) lenis.raf(t);
    scrollFrame();
    tasks.forEach((fn) => fn(t, dt));
    requestAnimationFrame(frame);
  }

  /* Tween helper driven by the ticker (used for number counters etc.) */
  HM.tween = function (from, to, ms, onUpdate, onDone) {
    let elapsed = 0;
    if (reduced || ms <= 0) { onUpdate(to); if (onDone) onDone(); return () => {}; }
    const fn = (t, dt) => {
      elapsed += dt;
      const p = clamp(elapsed / ms, 0, 1);
      onUpdate(lerp(from, to, easeOutExpo(p)));
      if (p >= 1) { tasks.delete(fn); if (onDone) onDone(); }
    };
    tasks.add(fn);
    return () => tasks.delete(fn);
  };

  /* ==========================================================================
     2. LENIS SMOOTH SCROLL
     Disabled for prefers-reduced-motion. Never hijacks wheel events over the
     Leaflet map once the map has been clicked (scroll-zoom mode) or inside
     elements marked data-lenis-prevent (modal / drawer).
     ========================================================================== */
  let lenis = null;
  if (!reduced && typeof window.Lenis === 'function') {
    try {
      lenis = new window.Lenis({
        lerp: 0.1,
        smoothWheel: true,
        wheelMultiplier: 1,
        touchMultiplier: 1.4,
        prevent: (node) => node.classList && node.classList.contains('leaflet-container') && node.dataset.scrollzoom === 'on'
      });
    } catch (e) { lenis = null; }
  }
  if (!lenis && !reduced) root.classList.add('no-lenis');
  HM.lenis = lenis;

  HM.lockScroll = function (lock) {
    if (lenis) lock ? lenis.stop() : lenis.start();
    doc.body.style.overflow = lock ? 'hidden' : '';
  };

  /* Smooth anchor scrolling that accounts for the fixed navbar */
  let programmatic = false;
  HM.scrollTo = function (target, opts = {}) {
    const el = typeof target === 'string' ? $(target) : target;
    if (!el) return;
    const navH = $('#nav').offsetHeight || 72;
    const offset = -(navH + (opts.extra || 12));
    programmatic = true;
    navHidden(false);
    if (lenis) {
      lenis.scrollTo(el, {
        offset,
        duration: opts.duration || 1.3,
        easing: (t) => 1 - Math.pow(1 - t, 4),
        onComplete: () => { programmatic = false; }
      });
    } else {
      const top = el.getBoundingClientRect().top + window.scrollY + offset;
      window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
      setTimeout(() => { programmatic = false; }, 1200);
    }
  };

  /* ==========================================================================
     3. LAYOUT CACHE + SCROLL-DRIVEN EFFECTS
     measure() reads layout (only on load / resize / content resize);
     scrollFrame() only reads the cached numbers + scrollY and writes styles.
     ========================================================================== */
  const nav = $('#nav');
  const progressEl = $('#scroll-progress');
  const L = { vh: window.innerHeight, docH: 1, dark: [], parallax: [], how: null };
  let sy = window.scrollY;
  let lastSy = sy;
  let scrollDirty = true;

  function measure() {
    const y = window.scrollY;
    L.vh = window.innerHeight;
    L.docH = Math.max(1, doc.documentElement.scrollHeight - L.vh);
    L.dark = $$('.section--dark, .marquee').map((el) => {
      const r = el.getBoundingClientRect();
      return [r.top + y, r.bottom + y];
    });
    L.parallax = $$('[data-parallax]').map((el) => {
      const r = el.getBoundingClientRect();
      return { el, mid: r.top + y + r.height / 2, speed: parseFloat(el.dataset.parallax) || 0.1 };
    });
    const pin = $('#how-pin');
    if (pin) {
      const r = pin.getBoundingClientRect();
      L.how = { top: r.top + y, len: Math.max(1, r.height - L.vh) };
    }
    scrollDirty = true;
  }
  HM.measure = measure;

  let measureQueued = false;
  function queueMeasure() {
    if (measureQueued) return;
    measureQueued = true;
    requestAnimationFrame(() => { measureQueued = false; measure(); });
  }
  window.addEventListener('resize', queueMeasure, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(queueMeasure).observe($('#main'));

  window.addEventListener('scroll', () => { sy = window.scrollY; scrollDirty = true; }, { passive: true });

  let navIsHidden = false;
  let menuOpen = false;
  function navHidden(h) {
    if (h === navIsHidden) return;
    navIsHidden = h;
    nav.classList.toggle('is-hidden', h);
  }

  let lastHowP = -1;
  function scrollFrame() {
    if (!scrollDirty) return;
    scrollDirty = false;

    // Progress bar
    progressEl.style.transform = `scaleX(${clamp(sy / L.docH, 0, 1)})`;

    // Navbar: frosted after 40px, hide on scroll-down, show on scroll-up
    nav.classList.toggle('is-scrolled', sy > 40);
    if (!menuOpen && !programmatic) {
      if (sy > lastSy + 6 && sy > 420) navHidden(true);
      else if (sy < lastSy - 6 || sy < 120) navHidden(false);
    }
    lastSy = sy;

    // Subtle parallax
    for (let i = 0; i < L.parallax.length; i++) {
      const p = L.parallax[i];
      const d = sy + L.vh / 2 - p.mid;
      if (Math.abs(d) < L.vh * 1.5) p.el.style.transform = `translate3d(0, ${(d * p.speed).toFixed(1)}px, 0)`;
    }

    // How-it-works route progress
    if (L.how && route) {
      const p = reduced ? 1 : clamp((sy - L.how.top) / L.how.len, 0, 1);
      if (Math.abs(p - lastHowP) > 0.0005) { lastHowP = p; route.update(p); }
    }

    updateCursorTone();
  }

  /* ==========================================================================
     4. PRELOADER (≈1.5s, hard cap 3s)
     ========================================================================== */
  const preloader = $('#preloader');
  const plBar = $('#preloader-bar');
  const t0 = performance.now();
  let pageLoaded = doc.readyState === 'complete';
  window.addEventListener('load', () => { pageLoaded = true; queueMeasure(); }, { once: true });
  const MIN_MS = reduced ? 200 : 1500;
  const MAX_MS = 2800;
  let preloaderDone = false;

  function preloaderTick() {
    if (preloaderDone) return;
    const el = performance.now() - t0;
    const p = Math.min(el / MIN_MS, pageLoaded ? 1 : 0.9);
    plBar.style.transform = `scaleX(${p})`;
    if ((el >= MIN_MS && pageLoaded) || el >= MAX_MS) finishPreloader();
  }
  function finishPreloader() {
    if (preloaderDone) return;
    preloaderDone = true;
    plBar.style.transform = 'scaleX(1)';
    tasks.delete(preloaderTick);
    setTimeout(() => {
      preloader.classList.add('is-done');
      doc.body.classList.remove('is-loading');
      $('#home').classList.add('is-in');
      measure();
      if (lenis) lenis.resize();
      doc.dispatchEvent(new CustomEvent('hm:ready'));
    }, reduced ? 0 : 250);
  }
  tasks.add(preloaderTick);
  setTimeout(finishPreloader, 3000); // safety net even if rAF is throttled

  /* ==========================================================================
     5. TEXT SPLITTING (hero letters, headings word-by-word)
     ========================================================================== */
  function splitLetters(el) {
    const text = el.textContent;
    el.textContent = '';
    el.setAttribute('aria-hidden', 'true');
    let i = 0;
    for (const ch of text) {
      const s = doc.createElement('span');
      s.className = 'ch';
      s.textContent = ch === ' ' ? ' ' : ch;
      s.style.setProperty('--i', i++);
      el.appendChild(s);
    }
  }
  let letterOffset = 0;
  $$('[data-letters]').forEach((el) => {
    splitLetters(el);
    $$('.ch', el).forEach((c) => c.style.setProperty('--i', letterOffset++));
  });

  function splitWords(el) {
    const words = el.textContent.trim().split(/\s+/);
    el.setAttribute('aria-label', el.textContent.trim());
    el.textContent = '';
    words.forEach((w, i) => {
      const outer = doc.createElement('span');
      outer.className = 'w';
      outer.setAttribute('aria-hidden', 'true');
      const inner = doc.createElement('span');
      inner.textContent = w;
      inner.style.setProperty('--i', i);
      outer.appendChild(inner);
      el.appendChild(outer);
      if (i < words.length - 1) el.appendChild(doc.createTextNode(' '));
    });
    el.classList.add('split');
  }
  $$('[data-split]').forEach(splitWords);

  /* ==========================================================================
     6. REVEAL ON SCROLL + COUNTERS (IntersectionObserver)
     ========================================================================== */
  // Stagger siblings that reveal together
  const groups = new Map();
  $$('[data-reveal]').forEach((el) => {
    const g = groups.get(el.parentElement) || [];
    g.push(el);
    groups.set(el.parentElement, g);
  });
  groups.forEach((list) => list.forEach((el, i) => el.style.setProperty('--rd', `${Math.min(i, 6) * 0.08}s`)));

  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target;
      el.classList.add('is-in');
      revealIO.unobserve(el);
      // clear stagger delay afterwards so hover/tilt transitions are instant
      setTimeout(() => el.style.setProperty('--rd', '0s'), 1400);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  $$('[data-reveal], [data-split]').forEach((el) => revealIO.observe(el));

  const countIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const to = parseFloat(el.dataset.count) || 0;
      HM.tween(0, to, 1800, (v) => { el.textContent = Math.round(v); });
      countIO.unobserve(el);
    });
  }, { threshold: 0.4 });
  $$('[data-count]').forEach((el) => countIO.observe(el));

  /* Active nav link */
  const navLinks = $$('[data-nav]');
  const sectionIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const id = e.target.id;
      navLinks.forEach((a) => a.classList.toggle('is-active', a.dataset.nav === id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  ['how', 'services', 'gps', 'pricing', 'about', 'faq', 'home'].forEach((id) => { const s = doc.getElementById(id); if (s) sectionIO.observe(s); });

  /* Visibility helper for animation loops (pause when off-screen) */
  HM.whenVisible = function (el, cb, margin = '100px') {
    const io = new IntersectionObserver((en) => en.forEach((e) => cb(e.isIntersecting)), { rootMargin: margin });
    io.observe(el);
    return io;
  };

  /* ==========================================================================
     7. ANCHOR LINKS, TRACK LINKS, TOAST LINKS
     ========================================================================== */
  doc.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (a.hasAttribute('data-toast')) {
      e.preventDefault();
      HM.toast(a.dataset.toast);
      return;
    }
    if (href.length < 2) return;
    const target = doc.getElementById(href.slice(1));
    if (!target) return;
    e.preventDefault();
    if (menuOpen) toggleMenu(false);
    HM.scrollTo(target);
    if (a.hasAttribute('data-track-link')) {
      setTimeout(() => { const i = $('#track-id'); if (i) i.focus({ preventScroll: true }); }, 1100);
    }
  });

  /* ==========================================================================
     8. MOBILE MENU (circular reveal — a scaled circle, transform only)
     ========================================================================== */
  const burger = $('#burger');
  const mmenu = $('#mobile-menu');
  $$('.mmenu__links > a', mmenu).forEach((a, i) => a.style.setProperty('--i', i));
  function toggleMenu(open) {
    menuOpen = open;
    mmenu.classList.toggle('is-open', open);
    nav.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    mmenu.setAttribute('aria-hidden', String(!open));
    if (open) { mmenu.removeAttribute('inert'); navHidden(false); } else { mmenu.setAttribute('inert', ''); }
    HM.lockScroll(open);
    if (open) setTimeout(() => { const f = $('a', mmenu); if (f) f.focus({ preventScroll: true }); }, 300);
  }
  burger.addEventListener('click', () => toggleMenu(!menuOpen));
  mmenu.addEventListener('click', (e) => { if (e.target.closest('[data-book], [data-account]')) toggleMenu(false); });
  window.addEventListener('resize', () => { if (menuOpen && window.innerWidth > 1100) toggleMenu(false); }, { passive: true });

  /* ==========================================================================
     9. CUSTOM CURSOR, MAGNETIC BUTTONS, RIPPLE, TILT
     ========================================================================== */
  const cursor = $('.cursor');
  const dot = $('#cursor-dot');
  const ring = $('#cursor-ring');
  const mouse = { x: -100, y: -100, rx: -100, ry: -100, active: false };
  let cursorOnDark = false;

  function updateCursorTone() {
    if (!mouse.active) return;
    const y = sy + mouse.y;
    let dark = false;
    for (let i = 0; i < L.dark.length; i++) { if (y >= L.dark[i][0] && y < L.dark[i][1]) { dark = true; break; } }
    if (dark !== cursorOnDark) { cursorOnDark = dark; cursor.classList.toggle('on-dark', dark); }
  }

  if (finePointer && !reduced) {
    root.classList.add('has-cursor');
    ring.appendChild(doc.createElement('i'));
    window.addEventListener('pointermove', (e) => {
      mouse.x = e.clientX; mouse.y = e.clientY;
      if (!mouse.active) { mouse.active = true; mouse.rx = mouse.x; mouse.ry = mouse.y; cursor.classList.remove('is-hidden'); }
      scrollDirty = true; // re-check light/dark tone
    }, { passive: true });
    doc.addEventListener('pointerleave', () => cursor.classList.add('is-hidden'));
    doc.addEventListener('pointerover', (e) => {
      const t = e.target;
      cursor.classList.toggle('is-hover', !!t.closest('a, button, [data-tilt], label, .chip'));
      cursor.classList.toggle('is-hidden', !!t.closest('.map, input, select, textarea'));
    });
    HM.ticker.add(() => {
      if (!mouse.active) return;
      mouse.rx = lerp(mouse.rx, mouse.x, 0.2);
      mouse.ry = lerp(mouse.ry, mouse.y, 0.2);
      dot.style.transform = `translate3d(${mouse.x}px, ${mouse.y}px, 0)`;
      ring.style.transform = `translate3d(${mouse.rx.toFixed(1)}px, ${mouse.ry.toFixed(1)}px, 0)`;
    });

    // Cached rects go stale when the page scrolls; re-read lazily on the next pointer move
    let rectEpoch = 0;
    window.addEventListener('scroll', () => { rectEpoch++; }, { passive: true });

    // Magnetic buttons
    $$('[data-magnetic]').forEach((el) => {
      let r = null, ep = -1;
      el.addEventListener('pointerenter', () => { r = el.getBoundingClientRect(); ep = rectEpoch; });
      el.addEventListener('pointermove', (e) => {
        if (!r) return;
        if (ep !== rectEpoch) { el.style.transform = ''; r = el.getBoundingClientRect(); ep = rectEpoch; }
        const x = (e.clientX - (r.left + r.width / 2)) * 0.22;
        const y = (e.clientY - (r.top + r.height / 2)) * 0.32;
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      });
      el.addEventListener('pointerleave', () => { r = null; el.style.transform = ''; });
    });

    // 3D tilt with light glow following the pointer
    $$('[data-tilt]').forEach((el) => {
      const glow = $('.tilt-glow', el);
      let r = null; let pending = null; let ep = -1;
      const max = el.classList.contains('van-card') ? 6 : 8;
      const apply = () => {
        if (!pending) return;
        const { px, py } = pending; pending = null;
        el.style.transform = `perspective(900px) rotateX(${((0.5 - py) * max).toFixed(2)}deg) rotateY(${((px - 0.5) * max).toFixed(2)}deg) translateZ(0)`;
        if (glow) glow.style.transform = `translate3d(${(px * r.width).toFixed(0)}px, ${(py * r.height).toFixed(0)}px, 0)`;
      };
      el.addEventListener('pointerenter', () => { r = el.getBoundingClientRect(); ep = rectEpoch; el.classList.add('is-tilting'); });
      el.addEventListener('pointermove', (e) => {
        if (!r) return;
        if (ep !== rectEpoch) { r = el.getBoundingClientRect(); ep = rectEpoch; }
        const first = !pending;
        pending = { px: clamp((e.clientX - r.left) / r.width, 0, 1), py: clamp((e.clientY - r.top) / r.height, 0, 1) };
        if (first) requestAnimationFrame(apply);
      });
      el.addEventListener('pointerleave', () => { r = null; pending = null; el.classList.remove('is-tilting'); el.style.transform = ''; });
    });
  }

  // Ripple on buttons and chips
  doc.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.btn, .chip');
    if (!b || b.disabled || reduced) return;
    const r = b.getBoundingClientRect();
    const s = doc.createElement('span');
    s.className = 'ripple';
    s.style.left = `${e.clientX - r.left}px`;
    s.style.top = `${e.clientY - r.top}px`;
    b.appendChild(s);
    s.addEventListener('animationend', () => s.remove(), { once: true });
  });

  /* ==========================================================================
     10. HERO CANVAS — blue particle network (paused when off-screen)
     ========================================================================== */
  (function heroCanvas() {
    const canvas = $('#hero-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, dpr = 1, pts = [], visible = true;
    const pointer = { x: -999, y: -999 };

    function size() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = w < 640 ? 32 : w < 1100 ? 52 : 72;
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22, vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.6 + 0.6
      }));
      if (reduced) draw(0);
    }
    function draw(dt) {
      ctx.clearRect(0, 0, w, h);
      const max = 140, max2 = max * max;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (dt) {
          p.x += p.vx * dt * 0.06; p.y += p.vy * dt * 0.06;
          if (p.x < -20) p.x = w + 20; else if (p.x > w + 20) p.x = -20;
          if (p.y < -20) p.y = h + 20; else if (p.y > h + 20) p.y = -20;
        }
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < max2) {
            ctx.strokeStyle = `rgba(94,200,255,${(0.16 * (1 - d2 / max2)).toFixed(3)})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
        const pdx = a.x - pointer.x, pdy = a.y - pointer.y;
        const pd2 = pdx * pdx + pdy * pdy;
        if (pd2 < 32000) {
          ctx.strokeStyle = `rgba(94,200,255,${(0.35 * (1 - pd2 / 32000)).toFixed(3)})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(pointer.x, pointer.y); ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(227,237,255,.75)';
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    size();
    let rs;
    window.addEventListener('resize', () => { clearTimeout(rs); rs = setTimeout(size, 150); }, { passive: true });
    HM.whenVisible($('#home'), (v) => { visible = v; }, '0px');
    if (finePointer) {
      $('#home').addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; }, { passive: true });
      $('#home').addEventListener('pointerleave', () => { pointer.x = pointer.y = -999; });
    }
    if (!reduced) HM.ticker.add((t, dt) => { if (visible) draw(dt); });
  })();

  /* ==========================================================================
     11. HERO LIVE VAN CARD — van follows the SVG route (paused off-screen)
     ========================================================================== */
  (function liveVan() {
    const path = $('#mm-route');
    const van = $('#mm-van');
    const bar = $('#mm-bar');
    const eta = $('#mm-eta');
    if (!path || !van) return;
    const len = path.getTotalLength();
    const LOOP = 16000; // ms per run
    let t = 3000, visible = true, lastMin = -1;
    function place(p) {
      const pt = path.getPointAtLength(p * len);
      const pt2 = path.getPointAtLength(Math.min(len, p * len + 1));
      const ang = Math.atan2(pt2.y - pt.y, pt2.x - pt.x) * 180 / Math.PI;
      van.setAttribute('transform', `translate(${pt.x.toFixed(2)} ${pt.y.toFixed(2)}) rotate(${ang.toFixed(1)})`);
      bar.style.transform = `scaleX(${p.toFixed(4)})`;
      const min = Math.max(1, Math.round((1 - p) * 14));
      if (min !== lastMin) { lastMin = min; eta.textContent = p > 0.985 ? 'Arrived' : `${min} min`; }
    }
    place(0.35);
    HM.whenVisible(van.closest('.van-card'), (v) => { visible = v; });
    if (!reduced) HM.ticker.add((now, dt) => {
      if (!visible) return;
      t = (t + dt) % (LOOP + 1500);
      place(clamp(t / LOOP, 0, 1)); // 1.5s pause at destination
    });
  })();

  /* ==========================================================================
     12. HOW IT WORKS — scroll-drawn route with van + steps lighting up
     ========================================================================== */
  const route = (function howRoute() {
    const line = $('#route-line');
    const van = $('#route-van');
    const nodesG = $('#route-nodes');
    const steps = $$('#route-steps .route-step');
    if (!line || !van) return null;
    const len = line.getTotalLength();
    line.style.strokeDasharray = `${len}`;
    line.style.strokeDashoffset = `${len}`;

    // Put 4 nodes on the path, horizontally centred over each step column
    const targetsX = [125, 375, 625, 875];
    const SAMPLES = 400;
    const samples = [];
    for (let i = 0; i <= SAMPLES; i++) { const l = (len * i) / SAMPLES; samples.push({ l, p: line.getPointAtLength(l) }); }
    const fracs = targetsX.map((x) => {
      let best = samples[0];
      samples.forEach((s) => { if (Math.abs(s.p.x - x) < Math.abs(best.p.x - x)) best = s; });
      const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'route-node');
      g.setAttribute('transform', `translate(${best.p.x.toFixed(1)} ${best.p.y.toFixed(1)})`);
      g.innerHTML = '<circle r="14"/><circle r="7"/>';
      nodesG.appendChild(g);
      return { f: best.l / len, g };
    });
    let lastOn = -1;
    function update(p) {
      // ease the raw progress slightly so the draw finishes before the pin ends
      const q = clamp(p / 0.9, 0, 1);
      line.style.strokeDashoffset = `${(len * (1 - q)).toFixed(1)}`;
      const l = Math.max(0.5, q * len);
      const a = line.getPointAtLength(l);
      const b = line.getPointAtLength(Math.min(len, l + 2));
      const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      van.setAttribute('transform', `translate(${a.x.toFixed(1)} ${(a.y - 18).toFixed(1)}) rotate(${(ang * 0.5).toFixed(1)})`);
      let on = -1;
      fracs.forEach((n, i) => { if (q >= n.f - 0.015) on = i; });
      if (on !== lastOn) {
        lastOn = on;
        fracs.forEach((n, i) => n.g.classList.toggle('is-on', i <= on));
        steps.forEach((s, i) => s.classList.toggle('is-on', i <= on));
      }
    }
    update(reduced ? 1 : 0);
    return { update };
  })();

  /* Sticky phone walkthrough: active step swaps the phone screen */
  (function walkthrough() {
    const steps = $$('.walk-step');
    const screens = $$('.pscreen');
    if (!steps.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const i = +e.target.dataset.walk;
        steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
        screens.forEach((s, k) => s.classList.toggle('is-active', k === i));
      });
    }, {
      // Desktop: the step crossing the middle of the screen is active.
      // Phones: cards scroll up under the sticky phone, so activate them in the clear area below it.
      rootMargin: window.matchMedia('(max-width: 960px)').matches ? '-58% 0px -32% 0px' : '-45% 0px -45% 0px'
    });
    steps.forEach((s) => io.observe(s));
  })();

  /* ==========================================================================
     13. QR-STYLE PATTERN (deterministic from a seed string)
     ========================================================================== */
  HM.qrSvg = function (seed, n = 25) {
    let h = 2166136261;
    for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
    const finder = (x, y) => {
      const inF = (fx, fy) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7;
      for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
        if (inF(fx, fy)) {
          const dx = x - fx, dy = y - fy;
          return (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4)) ? 1 : 0;
        }
      }
      return -1;
    };
    let rects = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let v = finder(x, y);
        if (v === -1) {
          const nearF = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
          v = nearF ? 0 : rnd() > 0.52 ? 1 : 0;
        }
        if (v) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>`;
      }
    }
    return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" fill="#061440" aria-hidden="true">${rects}</svg>`;
  };
  const psQr = $('#ps-qr'); if (psQr) psQr.innerHTML = HM.qrSvg('HM-4821-demo', 21);
  const appQr = $('#app-qr'); if (appQr) appQr.innerHTML = HM.qrSvg('holdmate-app', 21);

  /* ==========================================================================
     14. TOASTS & CONFETTI
     ========================================================================== */
  const toastsEl = $('#toasts');
  HM.toast = function (msg, type = 'info', ms = 3400) {
    const t = doc.createElement('div');
    t.className = `toast${type === 'ok' ? ' toast--ok' : type === 'err' ? ' toast--err' : ''}`;
    t.setAttribute('role', type === 'err' ? 'alert' : 'status');
    t.textContent = msg;
    toastsEl.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('is-in')));
    setTimeout(() => {
      t.classList.remove('is-in');
      setTimeout(() => t.remove(), 700);
    }, ms);
  };

  HM.confetti = function () {
    if (reduced) return;
    const c = $('#confetti');
    const ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const W = window.innerWidth, H = window.innerHeight;
    c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.style.display = 'block';
    const colors = ['#FFFFFF', '#E3EDFF', '#5EC8FF', '#2563EB', '#0B49C6'];
    const parts = Array.from({ length: 150 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * 140, y: H * 0.42,
      vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 13 - 4,
      w: Math.random() * 8 + 5, h: Math.random() * 5 + 3,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      c: colors[(Math.random() * colors.length) | 0]
    }));
    let life = 0;
    const fn = (t, dt) => {
      life += dt;
      const k = dt / 16;
      ctx.clearRect(0, 0, W, H);
      parts.forEach((p) => {
        p.vy += 0.32 * k; p.vx *= 0.99; p.x += p.vx * k; p.y += p.vy * k; p.r += p.vr * k;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.globalAlpha = clamp(1 - (life - 2200) / 900, 0, 1);
        ctx.fillStyle = p.c; ctx.strokeStyle = 'rgba(6,20,64,.15)';
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (life > 3200) { tasks.delete(fn); ctx.clearRect(0, 0, W, H); c.style.display = 'none'; }
    };
    tasks.add(fn);
  };

  /* ==========================================================================
     15. OVERLAYS (drawer + modal): focus handling, Esc, scroll lock
     ========================================================================== */
  const openLayers = [];
  HM.layer = {
    open(el) {
      if (openLayers.includes(el)) return;
      el._opener = doc.activeElement;
      el.classList.add('is-open');
      el.removeAttribute('inert');
      el.setAttribute('aria-hidden', 'false');
      openLayers.push(el);
      HM.lockScroll(true);
      setTimeout(() => {
        const f = el.querySelector('[data-autofocus]') || el.querySelector('input, select, button:not([data-close-drawer]):not([data-close-modal])');
        if (f) f.focus({ preventScroll: true });
      }, 80);
    },
    close(el) {
      const i = openLayers.indexOf(el);
      if (i === -1) return;
      openLayers.splice(i, 1);
      el.classList.remove('is-open');
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('inert', '');
      if (!openLayers.length && !menuOpen) HM.lockScroll(false);
      if (el._opener && el._opener.focus) el._opener.focus({ preventScroll: true });
      el.dispatchEvent(new CustomEvent('hm:close'));
    },
    top() { return openLayers[openLayers.length - 1]; }
  };
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const top = HM.layer.top();
      if (top) HM.layer.close(top);
      else if (menuOpen) { toggleMenu(false); burger.focus(); }
    }
    // simple focus trap for the top layer
    if (e.key === 'Tab') {
      const top = HM.layer.top() || (menuOpen ? mmenu : null);
      if (!top) return;
      const f = $$('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])', top).filter((x) => x.offsetParent !== null);
      if (top === mmenu) f.unshift(burger);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------- Service details drawer ---------- */
  const SERVICES = {
    pickup: { icon: 'i-route', title: 'Pickup & delivery', book: 'standard', text: 'We collect your bags from where you are and deliver them to where you will be next.', points: ['Doorstep pickup from home, hotel, hostel or station', 'Bags weighed, sealed and photo-tagged at pickup', 'Own smart locker for each booking', 'Delivered at the time you choose, within 15 km'], price: 'From ₹49 + ₹9/km' },
    store: { icon: 'i-lock', title: 'Store & hold', book: 'store', text: 'Keep your luggage with us for a few hours or up to two days, then get it back wherever you need it.', points: ['Hold from 1 to 48 hours', '₹6/hour, dropping to ₹3/hour after 24 hours', 'Locked, sealed and GPS-tracked the whole time', 'Return to the same place or a new one'], price: '₹6/hour (₹3/hour after 24 h)' },
    scheduled: { icon: 'i-repeat', title: 'Scheduled runs', book: 'scheduled', text: 'Book a slot on one of our planned routes and pay 15% less.', points: ['Runs along fixed routes at set times', '15% cheaper than standard', 'Ideal for daily commuters, students and hotel guests', 'Live tracking and OTP handover included'], price: '15% off standard' },
    express: { icon: 'i-bolt', title: 'Express', book: 'express', text: 'A vehicle comes straight to you and goes straight to your drop point — no shared stops.', points: ['Priority dispatch from the nearest vehicle', 'Direct route, no shared stops', 'Best for flights, trains and tight schedules', 'Live tracking and OTP handover included'], price: '+50% on standard' },
    events: { icon: 'i-users', title: 'Events & weddings', book: 'events', text: 'A mobile cloakroom parked at your venue, run by our captains, for every guest.', points: ['Truck with up to 48 lockers on site', 'Numbered seal tags and QR tokens for each guest', 'Staffed by verified captains', 'Set up before guests arrive, cleared after'], price: '₹1,499 + ₹20 per bag' },
    partners: { icon: 'i-building', title: 'Hotels & colleges', book: 'standard', text: 'Luggage desks for hotel guests and move-in or move-out days for colleges and hostels.', points: ['Early check-in and late check-out luggage', 'Campus move-in and semester-break storage', 'Group and monthly billing', 'A dedicated partner contact'], price: 'Custom partner pricing', partner: true }
  };
  const drawer = $('#drawer');
  const drawerBody = $('#drawer-body');
  /* Generic drawer API (used by the "My bookings" panel in booking.js) */
  HM.openDrawer = function (html) {
    drawerBody.innerHTML = html;
    if (!drawer.classList.contains('is-open')) HM.layer.open(drawer);
    return drawerBody;
  };
  HM.closeDrawer = () => HM.layer.close(drawer);
  HM.openService = function (key) {
    const s = SERVICES[key];
    if (!s) return;
    drawerBody.innerHTML = `
      <div class="drawer__hero">
        <span class="svc__ic"><svg class="ic"><use href="#${s.icon}"/></svg></span>
        <h2 id="drawer-title">${s.title}</h2>
        <p>${s.text}</p>
      </div>
      <h4>What's included</h4>
      <ul class="drawer__list">${s.points.map((p) => `<li><svg class="ic"><use href="#i-check"/></svg><span>${p}</span></li>`).join('')}</ul>
      <div class="drawer__price"><span>Indicative pilot rate</span><b>${s.price}</b></div>
      <div class="btn-row">
        <button type="button" class="btn btn--primary" data-book="${s.book}" data-autofocus><span>Book ${s.title.toLowerCase()}</span><svg class="ic"><use href="#i-arrow"/></svg></button>
        ${s.partner ? '<button type="button" class="btn btn--ghost-dark" data-partner><span>Partner with us</span></button>' : ''}
      </div>`;
    HM.layer.open(drawer);
  };
  HM.openPartner = function () {
    drawerBody.innerHTML = `
      <div class="drawer__hero">
        <span class="svc__ic"><svg class="ic"><use href="#i-building"/></svg></span>
        <h2 id="drawer-title">Partner with HoldMate</h2>
        <p>Hotels, colleges, hostels, venues and travel businesses in Coimbatore — tell us a little and we'll get in touch.</p>
      </div>
      <form id="partner-form" novalidate>
        <div class="field"><label for="p-name">Your name</label><div class="field__row"><input id="p-name" autocomplete="name" required data-autofocus /></div></div>
        <div class="field"><label for="p-org">Organisation</label><div class="field__row"><input id="p-org" autocomplete="organization" required /></div></div>
        <div class="field"><label for="p-email">Work email</label><div class="field__row"><input id="p-email" type="email" autocomplete="email" required /></div></div>
        <p class="field-error" id="p-err" aria-live="polite"></p>
        <button type="submit" class="btn btn--primary btn--block"><span>Send request</span></button>
      </form>`;
    HM.layer.open(drawer);
    $('#partner-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#p-name').value.trim(), org = $('#p-org').value.trim(), email = $('#p-email').value.trim();
      const err = $('#p-err');
      if (name.length < 2 || org.length < 2) { err.textContent = 'Please add your name and organisation.'; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = 'Please enter a valid email address.'; return; }
      // BACKEND HOOK: POST partner enquiries to your API here.
      HM.layer.close(drawer);
      HM.toast(`Thanks, ${name.split(' ')[0]} — our partnerships team will contact you soon.`, 'ok');
    });
  };
  doc.addEventListener('click', (e) => {
    const svc = e.target.closest('[data-service]');
    if (svc) { HM.openService(svc.dataset.service); return; }
    if (e.target.closest('[data-partner], #partner-btn')) { HM.openPartner(); return; }
    if (e.target.closest('[data-close-drawer]')) HM.layer.close(drawer);
    if (e.target.closest('#drawer [data-book]')) HM.layer.close(drawer);
  });

  /* ==========================================================================
     16. STEPPERS (generic)
     ========================================================================== */
  doc.addEventListener('click', (e) => {
    const b = e.target.closest('.stepper__btn');
    if (!b) return;
    const wrap = b.closest('[data-stepper]');
    const input = $('input', wrap);
    const min = +wrap.dataset.min || 1, max = +wrap.dataset.max || 99;
    input.value = clamp((parseInt(input.value, 10) || min) + +b.dataset.step, min, max);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  /* ==========================================================================
     17. TESTIMONIAL SLIDER
     ========================================================================== */
  (function slider() {
    const track = $('#t-track');
    if (!track) return;
    const slides = $$('.testi__slide', track);
    const dotsEl = $('#t-dots');
    let i = 0, hover = false, visible = false;
    const dots = slides.map((_, k) => {
      const d = doc.createElement('button');
      d.type = 'button'; d.setAttribute('role', 'tab');
      d.setAttribute('aria-label', `Testimonial ${k + 1}`);
      d.addEventListener('click', () => go(k));
      dotsEl.appendChild(d);
      return d;
    });
    function go(k) {
      i = (k + slides.length) % slides.length;
      track.style.transform = `translate3d(${-i * 100}%, 0, 0)`;
      dots.forEach((d, n) => d.setAttribute('aria-selected', String(n === i)));
      slides.forEach((s, n) => s.setAttribute('aria-hidden', String(n !== i)));
    }
    $('#t-prev').addEventListener('click', () => go(i - 1));
    $('#t-next').addEventListener('click', () => go(i + 1));
    const vp = $('.testi__viewport');
    vp.addEventListener('pointerenter', () => { hover = true; });
    vp.addEventListener('pointerleave', () => { hover = false; });
    let sx = null;
    vp.addEventListener('pointerdown', (e) => { sx = e.clientX; });
    vp.addEventListener('pointerup', (e) => { if (sx === null) return; const d = e.clientX - sx; if (Math.abs(d) > 50) go(i + (d < 0 ? 1 : -1)); sx = null; });
    HM.whenVisible(vp, (v) => { visible = v; });
    setInterval(() => { if (visible && !hover && !doc.hidden && !reduced) go(i + 1); }, 6500);
    go(0);
  })();

  /* ==========================================================================
     18. FAQ ACCORDION — one open at a time, FLIP animation (transform only)
     ========================================================================== */
  (function faq() {
    const list = $('#faq-list');
    if (!list) return;
    const items = $$('.faq__item', list);
    list.addEventListener('click', (e) => {
      const q = e.target.closest('.faq__q');
      if (!q) return;
      const item = q.closest('.faq__item');
      const willOpen = q.getAttribute('aria-expanded') !== 'true';
      // FIRST: record positions
      const before = items.map((it) => it.getBoundingClientRect().top);
      // change layout
      items.forEach((it) => {
        const open = it === item && willOpen;
        $('.faq__q', it).setAttribute('aria-expanded', String(open));
        const a = $('.faq__a', it);
        a.hidden = !open;
        a.classList.toggle('is-anim', open);
      });
      if (reduced) return;
      // LAST + INVERT
      const after = items.map((it) => it.getBoundingClientRect().top);
      items.forEach((it, k) => {
        const d = before[k] - after[k];
        if (!d) return;
        it.style.transition = 'none';
        it.style.transform = `translate3d(0, ${d}px, 0)`;
      });
      // PLAY
      requestAnimationFrame(() => requestAnimationFrame(() => {
        items.forEach((it) => {
          if (!it.style.transform) return;
          it.style.transition = 'transform .6s cubic-bezier(0.22, 1, 0.36, 1)';
          it.style.transform = '';
        });
      }));
    });
  })();

  /* ==========================================================================
     19. SMART LOCKER GRID (A1–D5) — demo feed, paused off-screen
     ========================================================================== */
  (function lockers() {
    const grid = $('#locker-grid');
    if (!grid) return;
    grid.setAttribute('role', 'group');
    const STATES = { hold: 'Holding', out: 'Out for delivery', free: 'Free' };
    const places = ['Gandhipuram', 'RS Puram', 'Race Course', 'Peelamedu', 'Airport', 'Saibaba Colony', 'Town Hall', 'Brookefields', 'Singanallur', 'Ukkadam'];
    const rnd = (n) => (Math.random() * n) | 0;
    const lockers = [];
    const now = () => new Date();
    const fmt = (d) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    function fill(l, state) {
      l.state = state;
      if (state === 'free') { l.booking = null; return; }
      if (!l.booking) {
        l.booking = { id: `HM-${1000 + rnd(9000)}`, seal: `#HM-${20000 + rnd(9999)}`, kg: (4 + Math.random() * 18).toFixed(1), bags: 1 + rnd(3), to: places[rnd(places.length)], since: new Date(Date.now() - rnd(180) * 60000) };
      }
    }
    'ABCD'.split('').forEach((row) => {
      for (let c = 1; c <= 5; c++) {
        const el = doc.createElement('button');
        el.type = 'button';
        el.className = 'locker';
        el.innerHTML = `<span class="locker__id">${row}${c}</span><svg class="ic locker__lock"><use href="#i-lock"/></svg><span class="locker__st"></span>`;
        const l = { id: `${row}${c}`, el, state: 'free', booking: null };
        const r = Math.random();
        fill(l, r < 0.5 ? 'hold' : r < 0.72 ? 'out' : 'free');
        if (l.id === 'B3') fill(l, 'hold');
        el.addEventListener('click', () => select(l));
        lockers.push(l);
        grid.appendChild(el);
      }
    });
    let selected = null;
    function paint(l) {
      l.el.classList.toggle('is-hold', l.state === 'hold');
      l.el.classList.toggle('is-out', l.state === 'out');
      $('.locker__st', l.el).textContent = STATES[l.state];
      l.el.setAttribute('aria-label', `Locker ${l.id}: ${STATES[l.state]}`);
    }
    function counts() {
      const c = { hold: 0, out: 0, free: 0 };
      lockers.forEach((l) => c[l.state]++);
      $('#lk-hold').textContent = c.hold; $('#lk-out').textContent = c.out; $('#lk-free').textContent = c.free;
    }
    const detail = $('#lk-detail');
    function select(l) {
      if (selected) selected.el.classList.remove('is-selected');
      selected = l;
      l.el.classList.add('is-selected');
      const b = l.booking;
      detail.innerHTML = `<div class="anim">
        <p class="lk-detail__title"><span>Locker ${l.id}</span><span class="status-pill">${STATES[l.state]}</span></p>
        ${b ? `<div class="lk-detail__grid">
          <div><span>Booking</span><b class="mono">${b.id}</b></div>
          <div><span>Seal no.</span><b class="mono">${b.seal}</b></div>
          <div><span>Bags · weight</span><b>${b.bags} · ${b.kg} kg</b></div>
          <div><span>${l.state === 'out' ? 'Delivering to' : 'Locked since'}</span><b>${l.state === 'out' ? b.to : fmt(b.since)}</b></div>
        </div>` : '<p class="lk-detail__empty" style="margin-top:10px">This locker is empty and ready for the next booking.</p>'}
      </div>`;
    }
    lockers.forEach(paint);
    counts();
    // Live updates every few seconds while visible
    let visible = false;
    HM.whenVisible(grid, (v) => { visible = v; });
    const next = { free: 'hold', hold: 'out', out: 'free' };
    setInterval(() => {
      if (!visible || doc.hidden) return;
      const n = 1 + rnd(2);
      for (let k = 0; k < n; k++) {
        const l = lockers[rnd(lockers.length)];
        fill(l, next[l.state]);
        paint(l);
        if (!reduced) { l.el.classList.remove('flip'); void l.el.offsetWidth; l.el.classList.add('flip'); }
        if (l === selected) select(l);
      }
      counts();
    }, 2800);
    const clock = $('#lk-clock');
    const tick = () => { clock.textContent = fmt(now()); };
    tick(); setInterval(tick, 30000);
  })();

  /* ---------- misc ---------- */
  const yr = $('#year'); if (yr) yr.textContent = new Date().getFullYear();

  /* Start the loop */
  measure();
  requestAnimationFrame(frame);
})();
