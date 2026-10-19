const { Schema, model } = require('mongoose');

const otpSchema = new Schema(
  {
    phone: { type: String, required: true, index: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0, max: 5 }
  },
  { timestamps: true }
);

// MongoDB deletes the document automatically once expiresAt has passed.
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model('Otp', otpSchema);
