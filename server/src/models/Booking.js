const { Schema, model } = require('mongoose');

const STATUSES = ['booked', 'picked_up', 'in_locker', 'on_the_way', 'arrived', 'delivered', 'cancelled'];
const ACTIVE_STATUSES = ['booked', 'picked_up', 'in_locker', 'on_the_way', 'arrived'];

const placeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 }
  },
  { _id: false }
);

const bookingSchema = new Schema(
  {
    bookingId: { type: String, required: true, unique: true, match: /^HM-\d{4}$/ },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    serviceType: { type: String, enum: ['standard', 'scheduled', 'express', 'store', 'events'], required: true },
    pickup: { type: placeSchema, required: true },
    drop: { type: placeSchema, required: true },
    pickupTime: { type: Date, required: true, index: true },
    holdHours: { type: Number, required: true, min: 1, max: 48 },
    bags: { type: Number, required: true, min: 1 },
    weightKg: { type: Number, required: true, min: 1 },
    distanceKm: { type: Number, required: true, min: 0 },
    price: {
      base: Number,
      distance: Number,
      time: Number,
      weight: Number,
      bagCharge: Number,   // events only (₹20 per bag)
      multiplier: Number,
      subtotal: Number,
      total: { type: Number, required: true }
    },
    vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', index: true },
    locker: { type: Schema.Types.ObjectId, ref: 'Locker' },
    sealNumber: { type: String },
    photos: [{ type: String, maxlength: 500 }],
    otpHash: { type: String, required: true, select: false },
    handoverAttempts: { type: Number, default: 0, select: false },
    status: { type: String, enum: STATUSES, default: 'booked', index: true },
    statusHistory: [
      {
        _id: false,
        status: { type: String, enum: STATUSES, required: true },
        at: { type: Date, default: Date.now },
        by: { type: Schema.Types.ObjectId, ref: 'User' }
      }
    ],
    payment: {
      status: { type: String, enum: ['pending', 'paid', 'refunded'], default: 'pending' },
      method: { type: String, default: null },   // upi | card | wallet (set by the payment provider later)
      ref: { type: String, default: null }
    }
  },
  { timestamps: true }
);

bookingSchema.statics.STATUSES = STATUSES;
bookingSchema.statics.ACTIVE_STATUSES = ACTIVE_STATUSES;

module.exports = model('Booking', bookingSchema);
module.exports.STATUSES = STATUSES;
module.exports.ACTIVE_STATUSES = ACTIVE_STATUSES;
