const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  userId: Number,       // Telegram ID
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  status: { type: String, enum: ['pending', 'paid', 'delivered'], default: 'pending' },
  paymentId: String,
  key: String
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);