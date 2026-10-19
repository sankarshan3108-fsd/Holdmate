/**
 * Vehicles, lockers and live location.
 */
const mongoose = require('mongoose');
const { Vehicle, Locker, Booking, LocationPing } = require('../models');
const AppError = require('../utils/AppError');
const { toPoint } = require('../utils/geo');
const { byLabel } = require('../utils/ids');
const svc = require('../services/booking.service');
const realtime = require('../services/realtime');

/** Find a vehicle by Mongo id or by code (HM-01). */
async function findVehicle(ref) {
  const query = mongoose.isValidObjectId(ref) && /^[a-f\d]{24}$/i.test(ref) ? { _id: ref } : { code: String(ref).toUpperCase() };
  const vehicle = await Vehicle.findOne(query);
  if (!vehicle) throw new AppError(404, `Vehicle ${ref} not found.`, 'VEHICLE_NOT_FOUND');
  return vehicle;
}
exports.findVehicle = findVehicle;

// GET /api/vehicles  (public summary: no captain details)
exports.list = async (req, res) => {
  const vehicles = await Vehicle.find().sort({ code: 1 }).lean();
  const counts = await Locker.aggregate([{ $group: { _id: { vehicle: '$vehicle', status: '$status' }, n: { $sum: 1 } } }]);
  const lockerStats = {};
  counts.forEach((c) => {
    const k = String(c._id.vehicle);
    lockerStats[k] = lockerStats[k] || { free: 0, holding: 0, out_for_delivery: 0 };
    lockerStats[k][c._id.status] = c.n;
  });
  res.json({
    vehicles: vehicles.map((v) => ({
      id: v._id,
      code: v.code,
      type: v.type,
      lockerCount: v.lockerCount,
      status: v.status,
      lockers: lockerStats[String(v._id)] || { free: 0, holding: 0, out_for_delivery: 0 },
      lastSeenAt: v.lastSeenAt
    }))
  });
};

// GET /api/vehicles/:id/lockers  (public: labels and statuses only)
exports.lockers = async (req, res) => {
  const vehicle = await findVehicle(req.params.id);
  const lockers = await Locker.find({ vehicle: vehicle._id }).select('label status').lean();
  lockers.sort(byLabel);
  res.json({ vehicle: { code: vehicle.code, type: vehicle.type }, lockers: lockers.map((l) => ({ label: l.label, status: l.status })) });
};

// POST /api/vehicles/:id/location  (captain of this vehicle, or admin)
exports.updateLocation = async (req, res) => {
  const vehicle = await findVehicle(req.params.id);
  if (req.user.role === 'captain' && String(vehicle.captain) !== String(req.user._id)) {
    throw new AppError(403, `You are not the captain of ${vehicle.code}.`, 'NOT_YOUR_VEHICLE');
  }
  const { lat, lng, speed = 0, heading = 0 } = req.body;
  const at = new Date();
  vehicle.currentLocation = toPoint(lat, lng);
  vehicle.speed = speed;
  vehicle.heading = heading;
  vehicle.lastSeenAt = at;
  if (vehicle.status !== 'active') vehicle.status = 'active';
  await vehicle.save();
  await LocationPing.create({ vehicle: vehicle._id, location: toPoint(lat, lng), speed, heading, at });

  // Broadcast to everyone tracking a booking on this vehicle
  const active = await Booking.find({ vehicle: vehicle._id, status: { $in: svc.ACTIVE } }).select('bookingId status pickup drop');
  active.forEach((b) => {
    realtime.emitToBooking(b.bookingId, 'vehicle:location', {
      bookingId: b.bookingId,
      vehicle: vehicle.code,
      lat, lng, speed, heading, at,
      eta: svc.eta(b, vehicle)
    });
  });
  res.json({ ok: true, vehicle: vehicle.code, notifiedBookings: active.length });
};
