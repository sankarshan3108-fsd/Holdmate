const { Schema, model } = require('mongoose');

const userSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 80, default: 'HoldMate customer' },
    phone: { type: String, required: true, unique: true, match: /^[6-9]\d{9}$/ }, // 10-digit Indian mobile
    role: { type: String, enum: ['customer', 'captain', 'admin'], default: 'customer', index: true }
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function toPublic() {
  return { id: this._id, name: this.name, phone: this.phone, role: this.role };
};

module.exports = model('User', userSchema);
