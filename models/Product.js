const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Owner
  name: { type: String, required: true },
  brand: { type: String, required: true },
  photoUrl: { type: String }, // Cloudinary URL
  cloudinaryId: { type: String },
  
  // Inventory Snapshot for the User
  currentStock: { type: Number, default: 0 }, 
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', productSchema);