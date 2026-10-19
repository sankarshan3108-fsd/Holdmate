const { Schema, model } = require('mongoose');

const lockerSchema = new Schema(
  {
    vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    label: { type: String, required: true, match: /^[A-Z]\d{1,2}$/ },
    status: { type: String, enum: ['free', 'holding', 'out_for_delivery'], default: 'free' },
    booking: { type: Schema.Types.ObjectId, ref: 'Booking', default: null }
  },
  { timestamps: true }
);

lockerSchema.index({ vehicle: 1, label: 1 }, { unique: true });
lockerSchema.index({ vehicle: 1, status: 1 });

module.exports = model('Locker', lockerSchema);
