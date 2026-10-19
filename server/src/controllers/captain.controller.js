/**
 * Captain actions: jobs, status updates and OTP handover.
 */
const bcrypt = require('bcryptjs');
const { Vehicle, Booking } = require('../models');
const AppError = require('../utils/AppError');
const { istDayRange } = require('../utils/time');
const svc = require('../services/booking.service');
const realtime = require('../services/realtime');

const MAX_HANDOVER_ATTEMPTS = 5;

const populate = (q) => q.populate('user', 'name phone').populate('vehicle', 'code type captain currentLocation speed lastSeenAt').populate('locker', 'label');

/** Load a booking the current captain is allowed to act on (admins can act on any). */
async function loadOwnBooking(req, extraSelect) {
  let q = Booking.findOne({ bookingId: req.params.id });
  if (extraSelect) q = q.select(extraSelect);
  const booking = await populate(q);
  if (!booking) throw new AppError(404, `Booking ${req.params.id} not found.`, 'BOOKING_NOT_FOUND');
  if (req.user.role === 'captain' && (!booking.vehicle || String(booking.vehicle.captain) !== String(req.user._id))) {
    throw new AppError(403, 'This booking is not assigned to your vehicle.', 'NOT_YOUR_BOOKING');
  }
  return booking;
}

function broadcastStatus(booking) {
  realtime.emitToBooking(booking.bookingId, 'booking:status', {
    bookingId: booking.bookingId,
    status: booking.status,
    statusHistory: booking.statusHistory.map((h) => ({ status: h.status, at: h.at })),
    eta: svc.eta(booking, booking.vehicle)
  });
}

// GET /api/captain/jobs  — active jobs plus anything scheduled for today (IST)
exports.jobs = async (req, res) => {
  const vehicles = await Vehicle.find(req.user.role === 'admin' ? {} : { captain: req.user._id }).select('_id code type');
  const { start, end } = istDayRange();
  const bookings = await populate(
    Booking.find({
      vehicle: { $in: vehicles.map((v) => v._id) },
      $or: [{ status: { $in: svc.ACTIVE } }, { pickupTime: { $gte: start, $lt: end } }]
    }).sort({ pickupTime: 1 })
  );
  res.json({
    vehicles: vehicles.map((v) => ({ code: v.code, type: v.type })),
    jobs: bookings.map((b) => ({ ...svc.staffView(b), nextStatus: svc.NEXT_STATUS[b.status] || null }))
  });
};

// PATCH /api/captain/bookings/:id/status { status, photos? }
exports.updateStatus = async (req, res) => {
  const booking = await loadOwnBooking(req);
  const next = svc.NEXT_STATUS[booking.status];
  const { status, photos } = req.body;
  if (!next) throw new AppError(409, `Booking is "${booking.status}" and cannot move further here.`, 'BAD_TRANSITION');
  if (status !== next) throw new AppError(409, `Booking is "${booking.status}"; the next status must be "${next}".`, 'BAD_TRANSITION');
  if (status === 'picked_up' && photos && photos.length) booking.photos.push(...photos);
  svc.pushStatus(booking, status, req.user._id);
  await booking.save();
  await svc.syncLocker(booking);
  broadcastStatus(booking);
  res.json({ booking: { ...svc.staffView(booking), nextStatus: svc.NEXT_STATUS[booking.status] || null } });
};

// POST /api/captain/bookings/:id/handover { otp }
exports.handover = async (req, res) => {
  const booking = await loadOwnBooking(req, '+otpHash +handoverAttempts');
  if (booking.status === 'delivered') throw new AppError(409, 'This booking is already delivered.', 'ALREADY_DELIVERED');
  if (booking.status !== 'arrived') throw new AppError(409, `Mark the booking as "arrived" before handover (current: "${booking.status}").`, 'NOT_ARRIVED');
  if (booking.handoverAttempts >= MAX_HANDOVER_ATTEMPTS) {
    throw new AppError(423, 'Too many wrong OTPs for this booking. Contact the HoldMate admin to unlock it.', 'HANDOVER_LOCKED');
  }
  const ok = await bcrypt.compare(req.body.otp, booking.otpHash);
  if (!ok) {
    booking.handoverAttempts += 1;
    await booking.save();
    const left = MAX_HANDOVER_ATTEMPTS - booking.handoverAttempts;
    throw new AppError(400, `Incorrect OTP. Do not hand over the bags. ${left} attempt${left === 1 ? '' : 's'} left.`, 'OTP_INVALID');
  }
  svc.pushStatus(booking, 'delivered', req.user._id);
  await booking.save();
  await svc.releaseLocker(booking.locker);
  broadcastStatus(booking);
  res.json({ ok: true, message: 'OTP verified. Hand over the bags.', booking: svc.staffView(booking) });
};
