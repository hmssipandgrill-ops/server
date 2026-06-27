const mongoose = require('mongoose')

const sizeSchema = new mongoose.Schema({ label: String, price: Number }, { _id: false })

const menuItemSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  category:    { type: String, required: true },
  description: { type: String, default: '' },
  basePrice:   { type: Number, default: 0 },
  sizes:       [sizeSchema],
  image:       { type: String, default: '' },
  isPopular:   { type: Boolean, default: false },
  isFeatured:  { type: Boolean, default: false },
  isVegetarian:{ type: Boolean, default: false },
  isActive:    { type: Boolean, default: true },
  prepTime:    { type: Number, default: 15 },
  allergens:   [String],
}, { timestamps: true })

menuItemSchema.index({ name: 'text', description: 'text' })

module.exports = mongoose.model('MenuItem', menuItemSchema)
