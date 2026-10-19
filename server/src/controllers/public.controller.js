/**
 * Public endpoints: places, quotes and booking tracking.
 */
const env = require('../config/env');
const PLACES = require('../config/places');
const { Booking } = require('../models');
const AppError = require('../utils/AppError');
const { calculateQuote } = require('../services/pricing.service');
const { publicView } = require('../services/booking.service');

// GET /api/places
exports.places = (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ hub: env.HUB, radiusKm: env.SERVICE_RADIUS_KM, places: PLACES });
};

// POST /api/quote
exports.quote = (req, res) => {
  res.json({ quote: calculateQuote(req.body) });
};

// GET /api/track/:bookingId
exports.track = async (req, res) => {
  const booking = await Booking.findOne({ bookingId: req.params.bookingId })
    .populate('vehicle', 'code type currentLocation speed heading lastSeenAt')
    .populate('locker', 'label');
  if (!booking) throw new AppError(404, `No booking found with ID ${req.params.bookingId}.`, 'BOOKING_NOT_FOUND');
  res.json({ tracking: publicView(booking) });
};
