const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'production'], default: 'production' },
  mobile: { type: String, required: true }, // For Twilio SMS
  locality: { type: String },
  
  // Specific to Production Users
  priceAllotted: { type: Number, default: 0 }, // The rate this user gets paid per pouch
  isActive: { type: Boolean, default: true },
  
  createdAt: { type: Date, default: Date.now }
});

// Password Hash Middleware
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Password Match Method
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);