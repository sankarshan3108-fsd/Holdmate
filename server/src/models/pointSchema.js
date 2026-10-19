const { Schema } = require('mongoose');

/** GeoJSON Point — coordinates are [lng, lat]. */
module.exports = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: {
      type: [Number],
      required: true,
      validate: { validator: (v) => v.length === 2 && v[0] >= -180 && v[0] <= 180 && v[1] >= -90 && v[1] <= 90, message: 'Invalid coordinates' }
    }
  },
  { _id: false }
);
