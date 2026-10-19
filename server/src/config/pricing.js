/**
 * ALL pricing rates and vehicle rules live here (indicative pilot rates, ₹).
 * The server is the only place prices are calculated.
 */
module.exports = {
  ROAD_FACTOR: 1.3,          // straight-line (haversine) km × 1.3 ≈ road km
  AVG_SPEED_KMH: 22,         // used for ETA when the vehicle isn't reporting speed

  RATES: {
    base: 49,
    perKm: 9,
    perHour: 6,              // first 24 hours
    perHourAfter24: 3,       // every hour after 24
    freeKg: 5,
    perKgOver: 3,            // per kg above freeKg
    multipliers: { standard: 1, scheduled: 0.85, express: 1.5, store: 1, events: 1 },
    eventBase: 1499,
    eventPerBag: 20
  },

  LIMITS: {
    minHours: 1,
    maxHours: 48,
    maxBags: 100,
    maxWeightKg: 1000,
    cancelBeforeMinutes: 60   // free cancellation up to 1 hour before pickup
  },

  // Order matters: smallest vehicle first. A booking can go on its type or any larger one.
  VEHICLE_TYPES: ['bike', 'auto', 'van', 'truck'],
  VEHICLE_NAMES: { bike: 'HoldMate Bike', auto: 'HoldMate Auto', van: 'HoldMate Van', truck: 'HoldMate Truck' },
  DEFAULT_LOCKERS: { bike: 2, auto: 8, van: 20, truck: 48 }
};
