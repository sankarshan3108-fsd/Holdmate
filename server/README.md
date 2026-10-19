# HoldMate backend

Node.js + Express + MongoDB (Atlas, via Mongoose) + Socket.IO.
It serves the API **and** the website, so everything runs at **http://localhost:5000**.

---

## 1. Install

Requires Node.js 18 or newer.

```bash
cd server
npm install
```

## 2. Create `server/.env`

Copy `.env.example` to `.env` and fill it in:

```env
PORT=5000
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/holdmate?retryWrites=true&w=majority
JWT_SECRET=<long random string, 32+ characters>
NODE_ENV=development
HUB_LAT=10.9965
HUB_LNG=76.9667
SERVICE_RADIUS_KM=15
```

- Generate a JWT secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- In MongoDB Atlas, open **Network Access** and allow your IP address.
- URL-encode special characters in the database password (`@` → `%40`, `#` → `%23`, …).
- Optional: `CORS_ORIGINS=http://127.0.0.1:5500,http://localhost:5500` if you open the frontend on another origin
  (for example VS Code Live Server). Recommended: just use http://localhost:5000.

`.env` is in `.gitignore` — never commit it.

## 3. Seed the database

```bash
npm run seed
```

**This clears all HoldMate collections** and then creates the test accounts, the fleet with lockers and the demo booking.

## 4. Run

```bash
npm run dev     # with auto-restart (nodemon)
npm start       # production style
```

Open **http://localhost:5000**.

---

## Test accounts

Log in with phone + OTP. In development the **OTP is printed in the server console** (no SMS is sent).

| Role | Name | Phone | Vehicles |
| --- | --- | --- | --- |
| admin | HoldMate Admin | 9000000001 | — |
| captain | Captain R. Kumar | 9000000002 | Van HM-01, Truck HM-T1 |
| captain | Captain S. Priya | 9000000003 | Bike HM-B4, Auto HM-A2 |
| customer | Demo Customer | 9000000009 | owns HM-4821 |

Any other valid Indian mobile number creates a new customer account on first login.

**Demo booking:** `HM-4821` — Coimbatore Junction → RS Puram, van HM-01, locker B3, status `on_the_way`, handover OTP `4821`.

### Try the full flow
1. On the website: **Book now** → route → bags & details → verify your phone with the OTP from the console → confirmed (note the booking ID and 4-digit handover OTP).
2. **My bookings** (person icon in the navbar) → **Track**.
3. As a captain (use `requests.http`, or any HTTP client): log in, then `PATCH /api/captain/bookings/:id/status` through
   `picked_up → in_locker → on_the_way`, `POST /api/vehicles/:code/location`, then `arrived`.
   The tracker on the website updates live over Socket.IO.
4. `POST /api/captain/bookings/:id/handover { "otp": "<handover OTP>" }` → **Delivered**.

`requests.http` contains every request, ready for the VS Code **REST Client** extension.

---

## API

All responses are JSON. Errors look like `{ "error": { "message": "...", "code": "...", "details": [...] } }`.
Every route validates its input with zod; unknown fields are rejected.
Auth is a JWT in the httpOnly cookie `hm_token` (7 days). `Authorization: Bearer <token>` also works for apps/tools.

### Auth (rate-limited)
| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/request-otp` | `{ phone }` | 6-digit OTP, hashed, expires in 5 min; resend after 30 s; 5 per phone / 15 min |
| POST | `/api/auth/verify-otp` | `{ phone, otp, name? }` | max 5 wrong attempts per OTP; creates the customer on first login; sets the cookie |
| GET | `/api/auth/me` | — | `{ user }` (or `{ user: null }` when logged out) |
| POST | `/api/auth/logout` | — | clears the cookie |

### Places & pricing (public)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/places` | hub, radius and Coimbatore landmarks |
| POST | `/api/quote` | `{ serviceType, pickup?, drop?, distanceKm?, hours, bags, weightKg }` → price breakdown, suggested vehicle, zone check |

Pricing (all in `src/config/pricing.js`): base ₹49 + ₹9/km + ₹6/hour (₹3/hour after 24 h) + ₹3/kg over 5 kg;
Scheduled ×0.85, Express ×1.5; Store-only has no distance charge; Events = ₹1499 + ₹20/bag.
Distance = haversine × 1.3. Vehicle: Bike ≤2 bags & ≤15 kg, Auto ≤8 bags & ≤80 kg, Van ≤250 kg, Truck for events or >20 bags.

### Bookings (customer, logged in)
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/bookings` | validates zone/time, recalculates the price, assigns vehicle + locker, returns the handover OTP **once** |
| GET | `/api/bookings` | my bookings |
| GET | `/api/bookings/:id` | my booking |
| PATCH | `/api/bookings/:id/cancel` | free until 1 hour before pickup; frees the locker |

### Tracking & vehicles
| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| GET | `/api/track/:bookingId` | public | status, timeline, vehicle, locker, places, latest location, ETA (no phones/OTPs) |
| GET | `/api/vehicles` | public | fleet summary with locker counts |
| GET | `/api/vehicles/:id/lockers` | public | `:id` = code (HM-01) or Mongo id |
| POST | `/api/vehicles/:id/location` | captain of that vehicle / admin | `{ lat, lng, speed?, heading? }` → saved + broadcast |

### Captain (role `captain`; admins can also use these)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/captain/jobs` | active jobs + today's pickups (IST) on my vehicles, with customer name/phone |
| PATCH | `/api/captain/bookings/:id/status` | `{ status }` in order: `picked_up → in_locker → on_the_way → arrived` (optional `photos` on pickup) |
| POST | `/api/captain/bookings/:id/handover` | `{ otp }` → `delivered`, frees the locker (locks after 5 wrong OTPs) |

### Admin (role `admin`)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/admin/bookings` | `?status=&date=YYYY-MM-DD&page=&limit=` |
| GET | `/api/admin/stats` | bookings by status, today, booked value, lockers, vehicles, customers |
| PATCH | `/api/admin/bookings/:id/assign` | `{ vehicleId }` (code or id) — moves the booking to a free locker on that vehicle |
| GET/POST | `/api/admin/vehicles` | list / create (lockers created automatically) |
| PATCH/DELETE | `/api/admin/vehicles/:id` | update (type, status, captainId, lockerCount when all free) / delete (no active bookings) |
| GET/POST | `/api/admin/captains` | list / create (promotes an existing customer with that phone) |
| PATCH/DELETE | `/api/admin/captains/:id` | update / delete (unassigns their vehicles) |

### Socket.IO
The browser loads `/socket.io/socket.io.js` from this server, then:
- emits `track:join` with a booking ID (acknowledged with `{ ok }`)
- receives `vehicle:location` `{ bookingId, vehicle, lat, lng, speed, heading, at, eta }`
- receives `booking:status` `{ bookingId, status, statusHistory, eta }` and `booking:assigned`

---

## Project layout

```
server/
  src/
    index.js              Express app, security middleware, static frontend, Socket.IO, start-up
    seed.js               test data
    config/               env.js (loads .env), db.js, pricing.js (ALL rates), places.js
    models/               User, Otp, Vehicle, Locker, Booking, LocationPing
    routes/index.js       every route + its zod schema + role guard
    controllers/          auth, public (places/quote/track), bookings, vehicles, captain, admin
    middleware/           auth (JWT cookie + roles), validate (zod), rateLimit, error
    services/             pricing, booking (lockers/ETA/views), realtime (Socket.IO), sms
    utils/                geo, ids, schemas, time, AppError, asyncHandler
  requests.http           all endpoints for the VS Code REST Client extension
```

Security: helmet (with a Content-Security-Policy that only allows the CDNs/APIs the site uses), CORS allow-list,
rate limiting on OTP and handover routes, zod validation everywhere, hashed OTPs (bcrypt), JWT in an httpOnly
`SameSite=Lax` cookie (`Secure` in production), central JSON error handler, only `index.html`, `css/`, `js/` and
`assets/` are served — never `server/` or `.env`.

Data retention: OTP documents expire automatically after 5 minutes; GPS pings (`LocationPing`) after 7 days.

---

## Still to do (later)

- **SMS provider** — send login OTPs with MSG91 or Twilio. See `SMS PROVIDER HOOK` in `src/services/sms.service.js`.
  In production (`NODE_ENV=production`) OTP requests fail with a clear message until this is done.
- **Payments (Razorpay)** — bookings are created with `payment.status = "pending"`; add an order + webhook to mark
  them `paid`, and trigger refunds where `PAYMENT HOOK` is noted in the cancel handler.
- **Captain mobile app UI** — today captains use the API (`requests.http`). The app should post GPS every few seconds
  to `POST /api/vehicles/:id/location`, update statuses, upload seal photos (photos currently take URLs) and do the OTP handover.
- **Admin dashboard UI** — the admin API is ready; there is no admin screen yet.
- **Deployment** — e.g. Render/Railway/a VPS behind HTTPS with `NODE_ENV=production`, Atlas IP access list for the server,
  a Redis store for rate limits and the Socket.IO adapter if you run more than one instance.
- Booking IDs are `HM-` + 4 digits (9,000 possible) — widen the format before volume grows.
- The "Inside the van" locker grid on the homepage is still a demo animation (the real data is at `GET /api/vehicles/HM-01/lockers`).
