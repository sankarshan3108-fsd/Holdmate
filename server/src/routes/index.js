/**
 * All API routes. Every route validates its input with zod.
 */
const express = require('express');
const a = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth, optionalAuth, requireRole } = require('../middleware/auth');
const { otpRequestPerIp, otpRequestPerPhone, otpVerifyPerIp, otpVerifyPerPhone, handoverLimiter } = require('../middleware/rateLimit');
const s = require('../utils/schemas');
const { z } = s;

const auth = require('../controllers/auth.controller');
const pub = require('../controllers/public.controller');
const bookings = require('../controllers/bookings.controller');
const vehicles = require('../controllers/vehicles.controller');
const captain = require('../controllers/captain.controller');
const admin = require('../controllers/admin.controller');

const router = express.Router();
const empty = z.object({}).strict();
const vehicleParam = z.object({ id: s.vehicleRef });
const objectIdParam = z.object({ id: s.objectId });

/* ---------- Health ---------- */
router.get('/health', validate({ query: z.object({}).passthrough() }), (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/* ---------- Auth ---------- */
router.post('/auth/request-otp', otpRequestPerIp, otpRequestPerPhone, validate({ body: z.object({ phone: s.phone }).strict() }), a(auth.requestOtp));
router.post(
  '/auth/verify-otp',
  otpVerifyPerIp,
  otpVerifyPerPhone,
  validate({
    body: z.object({
      phone: s.phone,
      otp: z.string().trim().regex(/^\d{6}$/, 'OTP must be 6 digits'),
      name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80).optional()
    }).strict()
  }),
  a(auth.verifyOtp)
);
router.get('/auth/me', optionalAuth, a(auth.me)); // { user: null } when logged out
router.post('/auth/logout', validate({ body: z.object({}).passthrough() }), a(auth.logout));

/* ---------- Places & pricing ---------- */
router.get('/places', validate({ query: z.object({}).passthrough() }), pub.places);
router.post(
  '/quote',
  validate({
    body: z.object({
      serviceType: s.serviceType.default('standard'),
      pickup: s.point.optional(),
      drop: s.point.optional(),
      distanceKm: z.coerce.number().min(0).max(100).optional(),
      hours: s.hours.default(4),
      bags: s.bags.default(1),
      weightKg: s.weightKg.default(5)
    }).strict()
  }),
  a(pub.quote)
);

/* ---------- Customer bookings ---------- */
const createBooking = z.object({
  serviceType: s.serviceType,
  pickup: s.place,
  drop: s.place.optional(),
  pickupTime: z.coerce.date({ errorMap: () => ({ message: 'Pickup time must be a valid date/time' }) }),
  holdHours: s.hours,
  bags: s.bags,
  weightKg: s.weightKg
}).strict();

router.post('/bookings', requireAuth, validate({ body: createBooking }), a(bookings.create));
router.get('/bookings', requireAuth, validate({ query: z.object({}).passthrough() }), a(bookings.listMine));
router.get('/bookings/:id', requireAuth, validate({ params: s.bookingIdParam }), a(bookings.getMine));
router.patch('/bookings/:id/cancel', requireAuth, validate({ params: s.bookingIdParam, body: z.object({}).passthrough() }), a(bookings.cancelMine));

/* ---------- Public tracking ---------- */
router.get('/track/:bookingId', validate({ params: s.bookingIdParamAlt }), a(pub.track));

/* ---------- Vehicles & live location ---------- */
router.get('/vehicles', validate({ query: z.object({}).passthrough() }), a(vehicles.list));
router.get('/vehicles/:id/lockers', validate({ params: vehicleParam }), a(vehicles.lockers));
router.post(
  '/vehicles/:id/location',
  requireAuth,
  requireRole('captain', 'admin'),
  validate({
    params: vehicleParam,
    body: z.object({
      lat: s.lat,
      lng: s.lng,
      speed: z.coerce.number().min(0).max(200).optional(),
      heading: z.coerce.number().min(0).max(360).optional()
    }).strict()
  }),
  a(vehicles.updateLocation)
);

/* ---------- Captain ---------- */
const captainOnly = [requireAuth, requireRole('captain', 'admin')];
router.get('/captain/jobs', ...captainOnly, validate({ query: z.object({}).passthrough() }), a(captain.jobs));
router.patch(
  '/captain/bookings/:id/status',
  ...captainOnly,
  validate({
    params: s.bookingIdParam,
    body: z.object({
      status: z.enum(['picked_up', 'in_locker', 'on_the_way', 'arrived']),
      photos: z.array(z.string().url().max(500)).max(10).optional()
    }).strict()
  }),
  a(captain.updateStatus)
);
router.post(
  '/captain/bookings/:id/handover',
  ...captainOnly,
  handoverLimiter,
  validate({ params: s.bookingIdParam, body: z.object({ otp: z.string().trim().regex(/^\d{4}$/, 'Handover OTP must be 4 digits') }).strict() }),
  a(captain.handover)
);

/* ---------- Admin ---------- */
const adminOnly = [requireAuth, requireRole('admin')];
router.get(
  '/admin/bookings',
  ...adminOnly,
  validate({
    query: z.object({
      status: z.enum(['booked', 'picked_up', 'in_locker', 'on_the_way', 'arrived', 'delivered', 'cancelled']).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20)
    }).strict()
  }),
  a(admin.listBookings)
);
router.get('/admin/stats', ...adminOnly, validate({ query: empty }), a(admin.stats));
router.patch('/admin/bookings/:id/assign', ...adminOnly, validate({ params: s.bookingIdParam, body: z.object({ vehicleId: s.vehicleRef }).strict() }), a(admin.assign));

const vehicleType = z.enum(['bike', 'auto', 'van', 'truck']);
const vehicleStatus = z.enum(['active', 'idle', 'offline']);
router.get('/admin/vehicles', ...adminOnly, validate({ query: empty }), a(admin.listVehicles));
router.post(
  '/admin/vehicles',
  ...adminOnly,
  validate({
    body: z.object({
      code: z.string().trim().toUpperCase().regex(/^HM-[A-Z0-9]{1,6}$/, 'Code must look like HM-01'),
      type: vehicleType,
      lockerCount: z.coerce.number().int().min(1).max(60).optional(),
      captainId: s.objectId.nullable().optional(),
      status: vehicleStatus.optional()
    }).strict()
  }),
  a(admin.createVehicle)
);
router.patch(
  '/admin/vehicles/:id',
  ...adminOnly,
  validate({
    params: vehicleParam,
    body: z.object({
      type: vehicleType.optional(),
      lockerCount: z.coerce.number().int().min(1).max(60).optional(),
      captainId: s.objectId.nullable().optional(),
      status: vehicleStatus.optional()
    }).strict().refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' })
  }),
  a(admin.updateVehicle)
);
router.delete('/admin/vehicles/:id', ...adminOnly, validate({ params: vehicleParam }), a(admin.deleteVehicle));

router.get('/admin/captains', ...adminOnly, validate({ query: empty }), a(admin.listCaptains));
router.post('/admin/captains', ...adminOnly, validate({ body: z.object({ name: z.string().trim().min(2).max(80), phone: s.phone }).strict() }), a(admin.createCaptain));
router.patch(
  '/admin/captains/:id',
  ...adminOnly,
  validate({
    params: objectIdParam,
    body: z.object({ name: z.string().trim().min(2).max(80).optional(), phone: s.phone.optional() }).strict()
      .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' })
  }),
  a(admin.updateCaptain)
);
router.delete('/admin/captains/:id', ...adminOnly, validate({ params: objectIdParam }), a(admin.deleteCaptain));

module.exports = router;
