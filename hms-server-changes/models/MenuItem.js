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
  // AYOPOS link (all optional; unused when the site is not connected)
  ayoposId:    { type: String, default: null, index: { unique: true, sparse: true } },
  syncedAt:    { type: Date, default: null },   // when this record last matched AYOPOS
}, { timestamps: true })

menuItemSchema.index({ name: 'text', description: 'text' })

// Keep AYOPOS in step with edits made here. The sync service ignores changes it wrote itself (no echo loops).
menuItemSchema.post('save', function (doc) { try { require('../integrations/ayopos').onItemSaved(doc) } catch (e) { console.error('[ayopos] hook:', e.message) } })
menuItemSchema.post('findOneAndDelete', function (doc) { if (doc) try { require('../integrations/ayopos').onItemDeleted(doc) } catch (e) { console.error('[ayopos] hook:', e.message) } })

module.exports = mongoose.model('MenuItem', menuItemSchema)
