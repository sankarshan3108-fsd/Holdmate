/**
 * Server-side pricing. price = base + distance + time + weight, x speed multiplier.
 * Store-only: no distance charge. Events: Rs 1499 + Rs 20 per bag.
 */
const { RATES, VEHICLE_NAMES } = require('../config/pricing');
const { roadKm, kmFromHub, inZone, round1 } = require('../utils/geo');
const env = require('../config/env');

function suggestVehicle({ serviceType, bags, weightKg }) {
  if (serviceType === 'events' || bags > 20) return 'truck';
  if (bags <= 2 && weightKg <= 15) return 'bike';
  if (bags <= 8 && weightKg <= 80) return 'auto';
  if (weightKg <= 250) return 'van';
  return 'truck';
}

function timeCharge(hours) {
  return Math.min(hours, 24) * RATES.perHour + Math.max(0, hours - 24) * RATES.perHourAfter24;
}

function zoneInfo(p) {
  if (!p) return null;
  return { inside: inZone(p), kmFromHub: round1(kmFromHub(p)) };
}

/**
 * @param {object} q { serviceType, pickup?, drop?, distanceKm?, hours, bags, weightKg }
 *   pickup/drop: {lat,lng}. Without both coordinates, distanceKm (e.g. the calculator slider) is used.
 */
function calculateQuote(q) {
  const serviceType = q.serviceType || 'standard';
  const { hours, bags, weightKg } = q;

  let distanceKm = 0;
  if (q.pickup && q.drop) distanceKm = roadKm(q.pickup, q.drop);
  else if (typeof q.distanceKm === 'number') distanceKm = q.distanceKm;
  distanceKm = round1(distanceKm);

  let price;
  if (serviceType === 'events') {
    const bagCharge = RATES.eventPerBag * bags;
    const subtotal = RATES.eventBase + bagCharge;
    price = { base: RATES.eventBase, distance: 0, time: 0, weight: 0, bagCharge, multiplier: 1, subtotal, total: subtotal };
  } else {
    const base = RATES.base;
    const distance = serviceType === 'store' ? 0 : Math.round(distanceKm * RATES.perKm);
    const time = timeCharge(hours);
    const weight = Math.ceil(Math.max(0, weightKg - RATES.freeKg)) * RATES.perKgOver;
    const multiplier = RATES.multipliers[serviceType] ?? 1;
    const subtotal = base + distance + time + weight;
    price = { base, distance, time, weight, bagCharge: 0, multiplier, subtotal, total: Math.round(subtotal * multiplier) };
  }

  const vehicleType = suggestVehicle({ serviceType, bags, weightKg });
  const pickupZone = zoneInfo(q.pickup);
  const dropZone = zoneInfo(q.drop);
  const zones = [pickupZone, dropZone].filter(Boolean);

  return {
    serviceType,
    distanceKm,
    hours,
    bags,
    weightKg,
    price,
    vehicle: { type: vehicleType, name: VEHICLE_NAMES[vehicleType] },
    zone: {
      radiusKm: env.SERVICE_RADIUS_KM,
      pickup: pickupZone,
      drop: dropZone,
      allInside: zones.length ? zones.every((z) => z.inside) : null
    }
  };
}

module.exports = { calculateQuote, suggestVehicle };
