const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: String,
  price: Number,
  description: String,
  keyPool: [String], // массив ключей (можно пополнять)
  isEnabled: { type: Boolean, default: true }
});

module.exports = mongoose.model('Product', productSchema);