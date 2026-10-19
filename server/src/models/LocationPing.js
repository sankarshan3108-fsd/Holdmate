const { Schema, model } = require('mongoose');
const pointSchema = require('./pointSchema');

const pingSchema = new Schema({
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
  location: { type: pointSchema, required: true },
  speed: { type: Number, default: 0 },
  heading: { type: Number, default: 0 },
  at: { type: Date, default: Date.now }
});

// Keep raw GPS history for 7 days only.
pingSchema.index({ at: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = model('LocationPing', pingSchema);
