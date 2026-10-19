const { Schema, model } = require('mongoose');
const pointSchema = require('./pointSchema');

const vehicleSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, match: /^HM-[A-Z0-9]{1,6}$/ },
    type: { type: String, enum: ['bike', 'auto', 'van', 'truck'], required: true },
    lockerCount: { type: Number, required: true, min: 1, max: 60 },
    captain: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['active', 'idle', 'offline'], default: 'idle' },
    currentLocation: { type: pointSchema, default: undefined },
    speed: { type: Number, default: 0 },     // km/h
    heading: { type: Number, default: 0 },   // degrees
    lastSeenAt: { type: Date, default: null }
  },
  { timestamps: true }
);

vehicleSchema.index({ currentLocation: '2dsphere' });

module.exports = model('Vehicle', vehicleSchema);
