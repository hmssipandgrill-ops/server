const MenuItem = require('../models/MenuItem')

exports.getAll = async (req, res) => {
  try {
    const { category, search, featured, limit = 12, page = 1 } = req.query
    const filter = { isActive: true }
    if (category && category !== 'All') filter.category = category
    if (featured === 'true') filter.isFeatured = true
    if (search) filter.$text = { $search: search }
    const total = await MenuItem.countDocuments(filter)
    const items = await MenuItem.find(filter)
      .sort({ isFeatured: -1, isPopular: -1, createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
    res.json({ items, total, page: Number(page), pages: Math.ceil(total / Number(limit)) })
  } catch (err) { res.status(500).json({ message: err.message }) }
}

exports.getOne = async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id)
    if (!item) return res.status(404).json({ message: 'Menu item not found' })
    res.json({ item })
  } catch (err) { res.status(500).json({ message: err.message }) }
}

exports.create = async (req, res) => {
  try {
    const { name, category, description, basePrice, sizes, image, isPopular, isFeatured, isVegetarian, isActive, prepTime, allergens } = req.body
    if (!name || !category) return res.status(400).json({ message: 'Name and category are required' })
    if (!basePrice && (!sizes || !sizes.length)) return res.status(400).json({ message: 'Provide a base price or at least one size' })
    const item = await MenuItem.create({
      name: name.trim(), category, description: description?.trim() || '',
      basePrice: Number(basePrice) || 0, sizes: sizes || [], image: image || '',
      isPopular: Boolean(isPopular), isFeatured: Boolean(isFeatured),
      isVegetarian: Boolean(isVegetarian), isActive: isActive !== false,
      prepTime: Number(prepTime) || 15, allergens: allergens || [],
    })
    res.status(201).json({ item })
  } catch (err) { res.status(400).json({ message: err.message }) }
}

exports.update = async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id)
    if (!item) return res.status(404).json({ message: 'Menu item not found' })
    const fields = ['name','category','description','basePrice','sizes','image','isPopular','isFeatured','isVegetarian','isActive','prepTime','allergens']
    fields.forEach(f => { if (req.body[f] !== undefined) item[f] = req.body[f] })
    if (req.body.name) item.name = req.body.name.trim()
    if (req.body.basePrice !== undefined) item.basePrice = Number(req.body.basePrice)
    if (req.body.prepTime !== undefined) item.prepTime = Number(req.body.prepTime)
    await item.save()
    res.json({ item })
  } catch (err) { res.status(400).json({ message: err.message }) }
}

exports.remove = async (req, res) => {
  try {
    const item = await MenuItem.findByIdAndDelete(req.params.id)
    if (!item) return res.status(404).json({ message: 'Menu item not found' })
    res.json({ success: true })
  } catch (err) { res.status(500).json({ message: err.message }) }
}

exports.toggleActive = async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id)
    if (!item) return res.status(404).json({ message: 'Not found' })
    item.isActive = !item.isActive
    await item.save()
    res.json({ item })
  } catch (err) { res.status(500).json({ message: err.message }) }
}

exports.toggleFeatured = async (req, res) => {
  try {
    const item = await MenuItem.findById(req.params.id)
    if (!item) return res.status(404).json({ message: 'Not found' })
    item.isFeatured = !item.isFeatured
    await item.save()
    res.json({ item })
  } catch (err) { res.status(500).json({ message: err.message }) }
}
