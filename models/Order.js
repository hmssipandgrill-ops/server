const mongoose = require('mongoose')

const orderItemSchema = new mongoose.Schema({
  menuItem: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
  name: String,
  selectedSize: { label: String, price: Number },
  qty: { type: Number, required: true },
  price: { type: Number, required: true }
}, { _id: false })

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  items: [orderItemSchema],
  tableNumber: { type: String, required: true },
  status: { type: String, enum: ['pending','received','preparing','ready','served','cancelled'], default: 'pending' },
  total: { type: Number, required: true },
  notes: { type: String, default: '' },
}, { timestamps: true })

module.exports = mongoose.model('Order', orderSchema)
