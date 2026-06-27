const Contact = require('../models/Contact')

// POST /api/contact
exports.submit = async (req, res) => {
  try {
    const { name, email, phone, date, guests, message } = req.body

    if (!name || !email || !phone) {
      return res.status(400).json({ message: 'Name, email and phone are required' })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email address' })
    }

    const contact = await Contact.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      date: date || '',
      guests: guests || '',
      message: message?.trim() || '',
    })

    res.status(201).json({ success: true, contact })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// GET /api/contact  — admin/staff view all reservations
exports.getAll = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query
    const total = await Contact.countDocuments()
    const contacts = await Contact.find()
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
    res.json({ contacts, total, page: Number(page) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// DELETE /api/contact/:id  — admin only
exports.remove = async (req, res) => {
  try {
    const contact = await Contact.findByIdAndDelete(req.params.id)
    if (!contact) return res.status(404).json({ message: 'Reservation not found' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}
