# HoldMate — Lock Smart, Travel Light.

Website + backend for **HoldMate**, India's first smart mobile cloakroom (Coimbatore, Tamil Nadu).
Frontend: plain HTML + CSS + vanilla JavaScript (no framework, no build step).
Backend: Node.js + Express + MongoDB Atlas + Socket.IO in `server/` (see **server/README.md**).

---

## How to run

1. `cd server` → `npm install`
2. Copy `server/.env.example` to `server/.env` and add your MongoDB Atlas connection string and a JWT secret.
3. `npm run seed` (test accounts, fleet, demo booking HM-4821 — clears existing HoldMate data)
4. `npm run dev`
5. Open **http://localhost:5000** — the backend serves the website and the API together.

Login OTPs are printed in the server console in development. Test accounts are listed in `server/README.md`.

> **GPS needs a secure origin.** Browsers only allow location access on `https://` or `http://localhost`.
> http://localhost:5000 works. Opening `index.html` by double-clicking (`file:///…`) does not — GPS shows a
> "GPS needs a secure page" message, and the page talks to the API at http://localhost:5000.
> (VS Code Live Server also works if you add its origin to `CORS_ORIGINS` in `server/.env`, but use port 5000 when you can.)

An internet connection is needed for the fonts, Lenis, the Leaflet map, map tiles, road routing (OSRM)
and address lookup (Nominatim). If any of these fail, the site still works and shows a message
instead of a blank box (for example, tracking falls back to straight-line routes).

---

## Folder structure

```
holdmate/
  index.html        All page sections, the booking modal, the service drawer and an inline SVG icon sprite
  css/style.css     Design tokens (colours, type, easing), layout, components, responsive rules, reduced-motion
  js/main.js        One rAF loop, Lenis smooth scroll, preloader, scroll effects, cursor, tilt, reveals,
                    counters, slider, FAQ, drawer, toasts, confetti, locker grid, mobile menu
  js/api.js         Fetch helper for the backend (API base URL config, cookies, error toasts) + login state
  js/booking.js     Places from the API, server quotes, hero quote widget, pricing calculator,
                    3-step booking modal with phone-OTP login, "My bookings" panel
  js/gps.js         Lazy-loaded Leaflet map, 15 km zone, live location, reverse geocoding,
                    OSRM road routes, booking tracking (API + Socket.IO), route chips, map tools
  server/           Express API, MongoDB models, Socket.IO, seed, requests.http (see server/README.md)
  README.md
```

No image files are used — all icons and illustrations are inline SVG.

---

## Features

- **Preloader** (~1.5 s, max 3 s): logo draws itself, letters rise, tagline fades in, progress bar.
- **Hero**: huge "Lock Smart, / Travel Light." headline animated letter by letter, particle-network canvas,
  moving blue light blobs, brand line, and a quote widget with tabs (Pickup & drop / Store only /
  Events & groups), presets, GPS "use my location", bag stepper, weight, and zone warnings.
- **Live van card** with a mini SVG map, moving van, locker & seal numbers, ETA bar and floating badges.
- **Smooth scrolling** with Lenis (turned off for reduced-motion users), smooth anchor links that
  account for the fixed navbar.
- **Navbar**: frosted glass on scroll, hides on scroll-down / shows on scroll-up, active section highlight,
  circular-reveal mobile menu.
- Scroll progress bar, custom cursor (dot + ring, desktop only), magnetic buttons, ripple, shine sweep,
  3D tilt cards with a light glow, word-by-word heading reveals, fade/slide reveals, parallax hooks
  (`data-parallax="0.1"`), animated counters, infinite marquee, testimonial slider, FAQ accordion.
- **How it works**: pinned section where an SVG route draws itself as you scroll, a van drives along it
  and the 4 steps light up; then a sticky phone mockup whose screen changes with each step.
- **Services** cards open a slide-in **details drawer** with a Book button.
- **Fleet** with animated vehicle icons and capacity bars.
- **Inside the van**: interactive 20-locker grid (A1–D5) with a live demo feed and locker details.
- **Live GPS tracking**:
  - Leaflet map (OpenStreetMap tiles, tinted blue), centred on Coimbatore Junction, dashed 15 km zone,
    hub marker and landmark stops. Loaded only when the section is near the viewport.
  - "Share my location" (`watchPosition`) with accuracy circle, haversine distance and in/out-of-zone
    message; clear errors for permission denied, timeout, unavailable and non-secure pages.
  - GPS buttons in forms fill the address via Nominatim reverse geocoding.
  - Track by booking ID (demo: **HM-4821**, or any booking you make): van moves along a real road route
    from OSRM (straight-line fallback), with ETA, distance left, speed, progress bar, 5-step timeline
    and handover OTP on arrival.
  - Route chips (Junction loop, Airport line, Campus line), map tools (follow van, toggle zone,
    centre on me). Scroll-zoom only after clicking the map.
- **Pricing calculator** with sliders, Scheduled / Standard / Express toggle, animated total, breakdown
  and suggested vehicle.
- **Booking modal** (3 steps): route with zone validation → bags & details with live quote and
  auto-selected vehicle → confirmation with animated check, booking ID, OTP, QR-style pattern,
  Copy ID and Track live. If you are not logged in, a phone + OTP step appears before confirming.
  Bookings are created on the server (the price is always recalculated there). Every "Book now" button opens it.
- **My bookings** (person icon in the navbar / "My bookings" in the mobile menu): list with status,
  Track and Cancel (free up to 1 hour before pickup), plus log in / log out.
- **Live tracking** reads `GET /api/track/:id` and joins the booking's Socket.IO room — the van marker moves
  when the captain's GPS positions arrive. Without a live position, a simulated van is shown ("Demo feed").
- Toasts, blue/white confetti, visible keyboard focus, Esc closes overlays, focus is trapped in overlays.
- Fully responsive (checked at 390 px, 768 px and 1440 px) and respects `prefers-reduced-motion`.

---

## Where to change things

| What | Where |
| --- | --- |
| **Prices / rates / vehicle rules** | `server/src/config/pricing.js` (the only place prices are calculated) |
| **Service zone & hub** | `server/.env` → `HUB_LAT`, `HUB_LNG`, `SERVICE_RADIUS_KM` |
| **Places / landmarks** | `server/src/config/places.js` (served by `GET /api/places`, fills the suggestions list) |
| **Map routes** | `js/gps.js` → `ROUTES` (stops use place names from `/api/places`) |
| **API address** | `js/api.js` → `API_BASE` (or set `window.HOLDMATE_API_BASE`) |
| **Colours** | `css/style.css` → `:root` tokens at the top (`--brand`, `--royal`, `--sky`, `--navy`, …) |
| **Fonts / easing / durations** | `css/style.css` → `--f-head`, `--f-body`, `--ease`, `--d-fast/mid/slow` |
| **Service drawer text** | `js/main.js` → `SERVICES` |
| **Demo booking & test accounts** | `server/src/seed.js` (HM-4821) |
| **Testimonials** | `index.html` → `.testi__slide` (currently clearly marked placeholders) |

---

## Backend

The backend is in `server/` — install, `.env`, seed, test accounts, the full API list and what is left
(SMS provider, Razorpay payments, captain app, admin dashboard, deployment) are in **server/README.md**.
`server/requests.http` has every endpoint ready for the VS Code REST Client extension.

The "Inside the van" locker grid on the homepage is still a demo animation, and the vehicle simulation in
tracking is used only when a vehicle has no live GPS yet; both are labelled "Demo feed" on the page.

---

## Performance notes

- One `requestAnimationFrame` loop (`HM.ticker` in `main.js`) drives Lenis, scroll effects, the hero
  canvas, the live van, the cursor, tweens, confetti and the tracking simulation.
- Layout is measured only on load/resize (`measure()`); the scroll loop reads cached numbers and only
  writes `transform` / `opacity`.
- Passive scroll listeners and IntersectionObserver for reveals, counters, active nav and lazy loading.
- The hero canvas, live van and locker feed pause when off-screen; rAF pauses when the tab is hidden.
- Leaflet is loaded only when the GPS section is near the viewport.
- Fonts use `font-display: swap` with metric-matched fallbacks to avoid layout shift.

To profile: Chrome DevTools → **Performance** → record while scrolling the whole page.

---

## Credits

Map data © OpenStreetMap contributors. Routing by OSRM. Geocoding by Nominatim.
Founder: T Asmar Nihash. © HoldMate, Coimbatore.
