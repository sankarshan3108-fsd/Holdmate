/**
 * Admin: bookings, stats, vehicle assignment, vehicle + captain management.
 */
const { User, Vehicle, Locker, Booking } = require('../models');
const AppError = require('../utils/AppError');
const { istDayRange } = require('../utils/time');
const { lockerLabels } = require('../utils/ids');
const { DEFAULT_LOCKERS } = require('../config/pricing');
const svc = require('../services/booking.service');
const realtime = require('../services/realtime');
const { findVehicle } = require('./vehicles.controller');

const populate = (q) => q.populate('user', 'name phone').populate('vehicle', 'code type captain').populate('locker', 'label');

/* ---------------- Bookings ---------------- */

// GET /api/admin/bookings?status=&date=YYYY-MM-DD&page=&limit=
exports.listBookings = async (req, res) => {
  const { status, date, page, limit } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (date) {
    const { start, end } = istDayRange(date);
    filter.pickupTime = { $gte: start, $lt: end };
  }
  const [items, total] = await Promise.all([
    populate(Booking.find(filter).sort({ pickupTime: -1 }).skip((page - 1) * limit).limit(limit)),
    Booking.countDocuments(filter)
  ]);
  res.json({ total, page, limit, bookings: items.map(svc.staffView) });
};

// GET /api/admin/stats
exports.stats = async (req, res) => {
  const { start, end } = istDayRange();
  const [byStatus, today, revenue, lockers, vehicles, customers] = await Promise.all([
    Booking.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Booking.countDocuments({ pickupTime: { $gte: start, $lt: end } }),
    Booking.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $group: { _id: '$payment.status', total: { $sum: '$price.total' }, n: { $sum: 1 } } }
    ]),
    Locker.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Vehicle.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    User.countDocuments({ role: 'customer' })
  ]);
  const toMap = (arr, key = 'n') => Object.fromEntries(arr.map((x) => [x._id, x[key]]));
  res.json({
    bookings: { byStatus: toMap(byStatus), today, total: byStatus.reduce((s, x) => s + x.n, 0) },
    revenue: { bookedValue: revenue.reduce((s, x) => s + x.total, 0), byPaymentStatus: toMap(revenue, 'total') },
    lockers: toMap(lockers),
    vehicles: toMap(vehicles),
    customers
  });
};

// PATCH /api/admin/bookings/:id/assign { vehicleId }
exports.assign = async (req, res) => {
  const booking = await Booking.findOne({ bookingId: req.params.id });
  if (!booking) throw new AppError(404, `Booking ${req.params.id} not found.`, 'BOOKING_NOT_FOUND');
  if (!svc.ACTIVE.includes(booking.status)) throw new AppError(409, `A ${booking.status} booking cannot be reassigned.`, 'NOT_ACTIVE');
  const vehicle = await findVehicle(req.body.vehicleId);
  if (booking.vehicle && String(booking.vehicle) === String(vehicle._id)) throw new AppError(409, `Booking is already on ${vehicle.code}.`, 'SAME_VEHICLE');

  const claim = await svc.claimLocker({ vehicleId: vehicle._id, bookingObjectId: booking._id, lockerStatus: svc.lockerStatusFor(booking.status) });
  if (!claim) throw new AppError(409, `${vehicle.code} has no free lockers.`, 'NO_LOCKER');
  const oldLocker = booking.locker;
  booking.vehicle = vehicle._id;
  booking.locker = claim.locker._id;
  await booking.save();
  await svc.releaseLocker(oldLocker);

  const full = await populate(Booking.findById(booking._id));
  realtime.emitToBooking(booking.bookingId, 'booking:assigned', { bookingId: booking.bookingId, vehicle: vehicle.code, locker: claim.locker.label });
  res.json({ booking: svc.staffView(full) });
};

/* ---------------- Vehicles ---------------- */

async function assertCaptain(captainId) {
  if (!captainId) return null;
  const captain = await User.findById(captainId);
  if (!captain || captain.role !== 'captain') throw new AppError(400, 'captainId must be a user with the captain role.', 'NOT_A_CAPTAIN');
  return captain._id;
}

async function createLockers(vehicle) {
  await Locker.insertMany(lockerLabels(vehicle.lockerCount).map((label) => ({ vehicle: vehicle._id, label })));
}

const vehicleAdminView = (v, lockerStats) => ({
  id: v._id,
  code: v.code,
  type: v.type,
  lockerCount: v.lockerCount,
  status: v.status,
  captain: v.captain && v.captain._id ? { id: v.captain._id, name: v.captain.name, phone: v.captain.phone } : null,
  lastSeenAt: v.lastSeenAt,
  lockers: lockerStats
});

// GET /api/admin/vehicles
exports.listVehicles = async (req, res) => {
  const vehicles = await Vehicle.find().populate('captain', 'name phone').sort({ code: 1 });
  const counts = await Locker.aggregate([{ $group: { _id: { vehicle: '$vehicle', status: '$status' }, n: { $sum: 1 } } }]);
  const stats = {};
  counts.forEach((c) => { const k = String(c._id.vehicle); (stats[k] = stats[k] || {})[c._id.status] = c.n; });
  res.json({ vehicles: vehicles.map((v) => vehicleAdminView(v, stats[String(v._id)] || {})) });
};

// POST /api/admin/vehicles { code, type, lockerCount?, captainId?, status? }
exports.createVehicle = async (req, res) => {
  const { code, type, lockerCount, captainId, status } = req.body;
  const vehicle = await Vehicle.create({
    code, type, status,
    lockerCount: lockerCount || DEFAULT_LOCKERS[type],
    captain: await assertCaptain(captainId)
  });
  await createLockers(vehicle);
  res.status(201).json({ vehicle: vehicleAdminView(await vehicle.populate('captain', 'name phone'), { free: vehicle.lockerCount }) });
};

// PATCH /api/admin/vehicles/:id { type?, lockerCount?, captainId?, status? }
exports.updateVehicle = async (req, res) => {
  const vehicle = await findVehicle(req.params.id);
  const { type, lockerCount, captainId, status } = req.body;
  if (type) vehicle.type = type;
  if (status) vehicle.status = status;
  if (captainId !== undefined) vehicle.captain = await assertCaptain(captainId);
  if (lockerCount && lockerCount !== vehicle.lockerCount) {
    const busy = await Locker.countDocuments({ vehicle: vehicle._id, status: { $ne: 'free' } });
    if (busy) throw new AppError(409, 'Lockers can only be resized when all of them are free.', 'LOCKERS_BUSY');
    await Locker.deleteMany({ vehicle: vehicle._id });
    vehicle.lockerCount = lockerCount;
    await createLockers(vehicle);
  }
  await vehicle.save();
  res.json({ vehicle: vehicleAdminView(await vehicle.populate('captain', 'name phone')) });
};

// DELETE /api/admin/vehicles/:id
exports.deleteVehicle = async (req, res) => {
  const vehicle = await findVehicle(req.params.id);
  const active = await Booking.countDocuments({ vehicle: vehicle._id, status: { $in: svc.ACTIVE } });
  if (active) throw new AppError(409, `${vehicle.code} still has ${active} active booking(s). Reassign them first.`, 'VEHICLE_BUSY');
  await Locker.deleteMany({ vehicle: vehicle._id });
  await vehicle.deleteOne();
  res.json({ ok: true, deleted: vehicle.code });
};

/* ---------------- Captains ---------------- */

const captainView = (u, vehicles = []) => ({ id: u._id, name: u.name, phone: u.phone, role: u.role, vehicles, createdAt: u.createdAt });

// GET /api/admin/captains
exports.listCaptains = async (req, res) => {
  const captains = await User.find({ role: 'captain' }).sort({ name: 1 });
  const vehicles = await Vehicle.find({ captain: { $in: captains.map((c) => c._id) } }).select('code captain');
  res.json({
    captains: captains.map((c) => captainView(c, vehicles.filter((v) => String(v.captain) === String(c._id)).map((v) => v.code)))
  });
};

// POST /api/admin/captains { name, phone }  (promotes an existing customer with that phone)
exports.createCaptain = async (req, res) => {
  const { name, phone } = req.body;
  let user = await User.findOne({ phone });
  if (user && user.role !== 'customer') throw new AppError(409, `This phone already belongs to a ${user.role}.`, 'DUPLICATE');
  if (user) { user.role = 'captain'; user.name = name; await user.save(); }
  else user = await User.create({ name, phone, role: 'captain' });
  res.status(201).json({ captain: captainView(user) });
};

async function findCaptain(id) {
  const user = await User.findOne({ _id: id, role: 'captain' });
  if (!user) throw new AppError(404, 'Captain not found.', 'CAPTAIN_NOT_FOUND');
  return user;
}

// PATCH /api/admin/captains/:id { name?, phone? }
exports.updateCaptain = async (req, res) => {
  const user = await findCaptain(req.params.id);
  if (req.body.name) user.name = req.body.name;
  if (req.body.phone) user.phone = req.body.phone;
  await user.save();
  res.json({ captain: captainView(user) });
};

// DELETE /api/admin/captains/:id  (unassigns their vehicles, then deletes the account)
exports.deleteCaptain = async (req, res) => {
  const user = await findCaptain(req.params.id);
  await Vehicle.updateMany({ captain: user._id }, { $set: { captain: null } });
  await user.deleteOne();
  res.json({ ok: true, deleted: user.phone });
};
