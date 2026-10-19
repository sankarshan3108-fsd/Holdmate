/**
 * Locker assignment, status rules, ETA and the different views of a booking.
 */
const { Vehicle, Locker, Booking } = require('../models');
const { VEHICLE_TYPES, AVG_SPEED_KMH, LIMITS } = require('../config/pricing');
const { roadKm, fromPoint, round1 } = require('../utils/geo');
const { byLabel } = require('../utils/ids');

const ACTIVE = Booking.ACTIVE_STATUSES;
const NEXT_STATUS = { booked: 'picked_up', picked_up: 'in_locker', in_locker: 'on_the_way', on_the_way: 'arrived' };
const LIVE_WINDOW_MS = 5 * 60 * 1000; // a position newer than this counts as "live"

/** Locker status that matches a booking status. */
function lockerStatusFor(bookingStatus) {
  if (bookingStatus === 'on_the_way' || bookingStatus === 'arrived') return 'out_for_delivery';
  if (ACTIVE.includes(bookingStatus)) return 'holding';
  return 'free';
}

/**
 * Atomically reserve a free locker on the smallest suitable vehicle (or on one specific vehicle).
 * Returns { vehicle, locker } or null when every suitable locker is taken.
 */
async function claimLocker({ minType, vehicleId, bookingObjectId, lockerStatus = 'holding' }) {
  let vehicles;
  if (vehicleId) {
    vehicles = await Vehicle.find({ _id: vehicleId });
  } else {
    const allowed = VEHICLE_TYPES.slice(Math.max(0, VEHICLE_TYPES.indexOf(minType)));
    vehicles = await Vehicle.find({ type: { $in: allowed }, status: { $ne: 'offline' } });
    // smallest suitable type first; prefer vehicles that have a captain assigned
    vehicles.sort((a, b) => VEHICLE_TYPES.indexOf(a.type) - VEHICLE_TYPES.indexOf(b.type) || (b.captain ? 1 : 0) - (a.captain ? 1 : 0));
  }
  for (const vehicle of vehicles) {
    const free = await Locker.find({ vehicle: vehicle._id, status: 'free' }).select('_id label').lean();
    free.sort(byLabel);
    for (const candidate of free) {
      // the status condition makes this safe if two bookings race for the same locker
      const locker = await Locker.findOneAndUpdate(
        { _id: candidate._id, status: 'free' },
        { $set: { status: lockerStatus, booking: bookingObjectId } },
        { new: true }
      );
      if (locker) return { vehicle, locker };
    }
  }
  return null;
}

async function releaseLocker(lockerId) {
  if (!lockerId) return;
  await Locker.updateOne({ _id: lockerId._id || lockerId }, { $set: { status: 'free', booking: null } });
}

/** Keep the locker status in step with the booking status. */
async function syncLocker(booking) {
  if (!booking.locker) return;
  const status = lockerStatusFor(booking.status);
  if (status === 'free') return releaseLocker(booking.locker);
  await Locker.updateOne({ _id: booking.locker._id || booking.locker }, { $set: { status } });
}

function canCancel(booking) {
  return booking.status === 'booked' && new Date(booking.pickupTime).getTime() - Date.now() >= LIMITS.cancelBeforeMinutes * 60 * 1000;
}

function isLive(vehicle) {
  return !!(vehicle && vehicle.lastSeenAt && Date.now() - new Date(vehicle.lastSeenAt).getTime() < LIVE_WINDOW_MS);
}

/** ETA to the drop-off (via the pickup if not yet picked up). Uses the vehicle position when known. */
function eta(booking, vehicle) {
  if (booking.status === 'delivered' || booking.status === 'cancelled') return null;
  if (booking.status === 'arrived') return { minutes: 0, distanceKm: 0, basis: 'arrived' };
  const loc = vehicle && vehicle.currentLocation ? fromPoint(vehicle.currentLocation) : null;
  let km;
  let basis = 'estimate';
  if (loc) {
    km = booking.status === 'booked' ? roadKm(loc, booking.pickup) + roadKm(booking.pickup, booking.drop) : roadKm(loc, booking.drop);
    basis = isLive(vehicle) ? 'live' : 'last_known';
  } else {
    km = roadKm(booking.pickup, booking.drop);
  }
  const speed = vehicle && vehicle.speed >= 8 && isLive(vehicle) ? vehicle.speed : AVG_SPEED_KMH;
  return { minutes: Math.max(1, Math.round((km / speed) * 60)), distanceKm: round1(km), basis };
}

function vehicleLocation(vehicle) {
  const loc = vehicle && vehicle.currentLocation ? fromPoint(vehicle.currentLocation) : null;
  if (!loc) return null;
  return { ...loc, speed: vehicle.speed || 0, heading: vehicle.heading || 0, at: vehicle.lastSeenAt, live: isLive(vehicle) };
}

const history = (b) => (b.statusHistory || []).map((h) => ({ status: h.status, at: h.at }));
const vehicleRef = (v) => (v && v._id ? { code: v.code, type: v.type } : null);
const lockerLabel = (l) => (l && l.label ? l.label : null);

/** Public tracking view: no names, phone numbers or OTPs. */
function publicView(b) {
  return {
    bookingId: b.bookingId,
    status: b.status,
    statusHistory: history(b),
    serviceType: b.serviceType,
    pickup: b.pickup,
    drop: b.drop,
    pickupTime: b.pickupTime,
    vehicle: b.vehicle && b.vehicle._id ? { ...vehicleRef(b.vehicle), location: vehicleLocation(b.vehicle) } : null,
    locker: lockerLabel(b.locker),
    eta: eta(b, b.vehicle && b.vehicle._id ? b.vehicle : null)
  };
}

/** The customer's own view of a booking. */
function customerView(b) {
  return {
    bookingId: b.bookingId,
    serviceType: b.serviceType,
    status: b.status,
    statusHistory: history(b),
    pickup: b.pickup,
    drop: b.drop,
    pickupTime: b.pickupTime,
    holdHours: b.holdHours,
    bags: b.bags,
    weightKg: b.weightKg,
    distanceKm: b.distanceKm,
    price: b.price,
    vehicle: vehicleRef(b.vehicle),
    locker: lockerLabel(b.locker),
    sealNumber: b.sealNumber,
    payment: { status: b.payment && b.payment.status, method: b.payment && b.payment.method },
    canCancel: canCancel(b),
    createdAt: b.createdAt
  };
}

/** Captain/admin view: adds the customer's name and phone so the captain can call. */
function staffView(b) {
  return {
    ...customerView(b),
    customer: b.user && b.user._id ? { name: b.user.name, phone: b.user.phone } : null,
    photos: b.photos || []
  };
}

function pushStatus(booking, status, byUserId) {
  booking.status = status;
  booking.statusHistory.push({ status, at: new Date(), by: byUserId });
}

module.exports = {
  ACTIVE, NEXT_STATUS, LIVE_WINDOW_MS,
  lockerStatusFor, claimLocker, releaseLocker, syncLocker, canCancel, isLive,
  eta, vehicleLocation, publicView, customerView, staffView, pushStatus
};
