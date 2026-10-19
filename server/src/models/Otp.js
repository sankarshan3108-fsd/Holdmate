const { Schema, model } = require('mongoose');

/**
 * One pending login code per phone.
 * - console / fast2sms: we generate the code → codeHash (bcrypt)
 * - messagecentral / msg91: the provider checks the code → providerRef (e.g. Message Central verificationId)
 */
const otpSchema = new Schema(
  {
    phone: { type: String, required: true, index: true },
    provider: { type: String, required: true, default: 'console' },
    codeHash: { type: String },
    providerRef: { type: String },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 }
  },
  { timestamps: true }
);

// MongoDB deletes the document automatically once expiresAt has passed (5 minutes).
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model('Otp', otpSchema);
