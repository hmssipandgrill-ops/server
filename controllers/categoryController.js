const Category = require('../models/Category')
const MenuItem  = require('../models/MenuItem')

// GET /api/categories
exports.getAll = async (req, res) => {
  try {
    const { includeInactive } = req.query
    const filter = includeInactive === 'true' ? {} : { isActive: true }
    const categories = await Category.find(filter).sort({ sortOrder: 1, name: 1 })
    res.json({ categories })
  } catch (err) { res.status(500).json({ message: err.message }) }
}

// POST /api/categories
exports.create = async (req, res) => {
  try {
    const { name, description, icon, sortOrder } = req.body
    if (!name) return res.status(400).json({ message: 'Name is required' })
    const existing = await Category.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } })
    if (existing) return res.status(400).json({ message: 'Category already exists' })
    const cat = await Category.create({ name: name.trim(), description, icon, sortOrder })
    res.status(201).json({ category: cat })
  } catch (err) { res.status(400).json({ message: err.message }) }
}

// PUT /api/categories/:id
exports.update = async (req, res) => {
  try {
    const { name, description, icon, sortOrder, isActive } = req.body
    const cat = await Category.findById(req.params.id)
    if (!cat) return res.status(404).json({ message: 'Category not found' })
    if (name !== undefined) cat.name = name.trim()
    if (description !== undefined) cat.description = description
    if (icon !== undefined) cat.icon = icon
    if (sortOrder !== undefined) cat.sortOrder = Number(sortOrder)
    if (isActive !== undefined) cat.isActive = Boolean(isActive)
    await cat.save()
    res.json({ category: cat })
  } catch (err) { res.status(400).json({ message: err.message }) }
}

// DELETE /api/categories/:id
exports.remove = async (req, res) => {
  try {
    const cat = await Category.findById(req.params.id)
    if (!cat) return res.status(404).json({ message: 'Category not found' })
    const count = await MenuItem.countDocuments({ category: cat.name })
    if (count > 0)
      return res.status(400).json({ message: `Cannot delete: ${count} menu items use this category. Reassign them first.` })
    await cat.deleteOne()
    res.json({ success: true })
  } catch (err) { res.status(500).json({ message: err.message }) }
}
