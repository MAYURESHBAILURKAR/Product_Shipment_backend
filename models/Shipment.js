const mongoose = require('mongoose');

const shipmentSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [
    {
      product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      productName: { type: String }, 
      quantity: { type: Number, required: true },
      pricePerUnit: { type: Number, required: true } 
    }
  ],
  totalQuantity: { type: Number, required: true },
  totalAmount: { type: Number, required: true }, 
  
  status: { 
    type: String, 
    enum: ['pending', 'received', 'rejected'], 
    default: 'pending' 
  },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'paid'],
    default: 'unpaid'
  },
  
  shippedAt: { type: Date, default: Date.now },
  receivedAt: { type: Date },
  paidAt: { type: Date }
});

module.exports = mongoose.model('Shipment', shipmentSchema);