/**
 * Customer bookings.
 */
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { Booking } = require('../models');
const AppError = require('../utils/AppError');
const env = require('../config/env');
const { LIMITS } = require('../config/pricing');
const { haversine, kmFromHub, inZone, round1 } = require('../utils/geo');
const { randomDigits, newBookingId, newSealNumber } = require('../utils/ids');
const { calculateQuote } = require('../services/pricing.service');
const svc = require('../services/booking.service');
const realtime = require('../services/realtime');

const RESERVED_IDS = new Set(['HM-4821']); // demo booking

const populate = (q) => q.populate('vehicle', 'code type').populate('locker', 'label');

// POST /api/bookings
exports.create = async (req, res) => {
  const b = req.body;
  const drop = b.drop || (b.serviceType === 'store' || b.serviceType === 'events' ? b.pickup : null);
  if (!drop) throw new AppError(400, 'drop: Drop-off location is required for this service.', 'VALIDATION_ERROR');

  // Zone checks (server-side, never trust the client)
  for (const [label, p] of [['Pickup', b.pickup], ['Drop-off', drop]]) {
    if (!inZone(p)) {
      throw new AppError(422, `${label} "${p.name}" is ${round1(kmFromHub(p))} km from Coimbatore Junction, outside our ${env.SERVICE_RADIUS_KM} km service zone.`, 'OUTSIDE_ZONE');
    }
  }
  if (['standard', 'scheduled', 'express'].includes(b.serviceType) && haversine(b.pickup, drop) < 0.05) {
    throw new AppError(422, 'Pickup and drop-off are the same place. Choose "Store & hold" to get your bags back where you left them.', 'SAME_PLACE');
  }
  const pickupTime = b.pickupTime;
  if (pickupTime.getTime() < Date.now() - 2 * 60 * 1000) throw new AppError(422, 'Pickup time must be in the future.', 'BAD_TIME');
  if (pickupTime.getTime() > Date.now() + 60 * 24 * 60 * 60 * 1000) throw new AppError(422, 'Bookings can be made up to 60 days ahead.', 'BAD_TIME');

  // Price is always recalculated here
  const quote = calculateQuote({ serviceType: b.serviceType, pickup: b.pickup, drop, hours: b.holdHours, bags: b.bags, weightKg: b.weightKg });

  // Reserve a locker on a suitable vehicle
  const bookingObjectId = new mongoose.Types.ObjectId();
  const claim = await svc.claimLocker({ minType: quote.vehicle.type, bookingObjectId });
  if (!claim) throw new AppError(409, 'All suitable lockers are taken right now. Please try a later time or contact support.', 'NO_LOCKER');

  const otp = randomDigits(4);
  const otpHash = await bcrypt.hash(otp, 10);
  let booking = null;
  try {
    for (let attempt = 0; attempt < 8 && !booking; attempt++) {
      const bookingId = newBookingId();
      if (RESERVED_IDS.has(bookingId)) continue;
      try {
        booking = await Booking.create({
          _id: bookingObjectId,
          bookingId,
          user: req.user._id,
          serviceType: b.serviceType,
          pickup: b.pickup,
          drop,
          pickupTime,
          holdHours: b.holdHours,
          bags: b.bags,
          weightKg: b.weightKg,
          distanceKm: quote.distanceKm,
          price: quote.price,
          vehicle: claim.vehicle._id,
          locker: claim.locker._id,
          sealNumber: newSealNumber(),
          otpHash,
          status: 'booked',
          statusHistory: [{ status: 'booked', at: new Date(), by: req.user._id }],
          payment: { status: 'pending' }
        });
      } catch (err) {
        if (err.code === 11000 && err.keyPattern && err.keyPattern.bookingId) continue; // ID clash: try another
        throw err;
      }
    }
    if (!booking) throw new AppError(503, 'Could not create a booking ID. Please try again.', 'ID_EXHAUSTED');
  } catch (err) {
    await svc.releaseLocker(claim.locker._id);
    throw err;
  }

  booking = await populate(Booking.findById(booking._id));
  res.status(201).json({
    booking: svc.customerView(booking),
    handoverOtp: otp, // shown once; only its hash is stored
    message: 'Booking confirmed. Share the handover OTP only with your captain at delivery.'
  });
};

// GET /api/bookings
exports.listMine = async (req, res) => {
  const bookings = await populate(Booking.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50));
  res.json({ bookings: bookings.map(svc.customerView) });
};

// GET /api/bookings/:id
exports.getMine = async (req, res) => {
  const booking = await populate(Booking.findOne({ bookingId: req.params.id, user: req.user._id }));
  if (!booking) throw new AppError(404, `No booking ${req.params.id} found on your account.`, 'BOOKING_NOT_FOUND');
  res.json({ booking: svc.customerView(booking) });
};

// PATCH /api/bookings/:id/cancel
exports.cancelMine = async (req, res) => {
  const booking = await populate(Booking.findOne({ bookingId: req.params.id, user: req.user._id }));
  if (!booking) throw new AppError(404, `No booking ${req.params.id} found on your account.`, 'BOOKING_NOT_FOUND');
  if (booking.status === 'cancelled') throw new AppError(409, 'This booking is already cancelled.', 'ALREADY_CANCELLED');
  if (booking.status !== 'booked') throw new AppError(409, 'Your bags have already been picked up, so this booking can no longer be cancelled.', 'NOT_CANCELLABLE');
  if (!svc.canCancel(booking)) {
    throw new AppError(409, `Free cancellation closes ${LIMITS.cancelBeforeMinutes} minutes before pickup. Please contact support.`, 'CANCEL_WINDOW_CLOSED');
  }
  svc.pushStatus(booking, 'cancelled', req.user._id);
  if (booking.payment.status === 'paid') booking.payment.status = 'refunded'; // PAYMENT HOOK: trigger the refund here
  await booking.save();
  await svc.releaseLocker(booking.locker);
  realtime.emitToBooking(booking.bookingId, 'booking:status', { bookingId: booking.bookingId, status: booking.status, statusHistory: svc.customerView(booking).statusHistory, eta: null });
  res.json({ booking: svc.customerView(booking), message: 'Booking cancelled. No charge applies.' });
};
