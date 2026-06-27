const User = require('../models/User')

// GET /api/users  — list all users (admin only)
exports.getAll = async (req, res) => {
  try {
    const { page = 1, limit = 50, role, search } = req.query
    const filter = {}
    if (role) filter.role = role
    if (search) filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ]

    const total = await User.countDocuments(filter)
    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))

    res.json({ users, total, page: Number(page) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// GET /api/users/:id  — single user (admin only)
exports.getOne = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password')
    if (!user) return res.status(404).json({ message: 'User not found' })
    res.json({ user })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// PUT /api/users/:id  — update user role or name (admin only)
exports.update = async (req, res) => {
  try {
    const { role, name } = req.body
    const allowedRoles = ['customer', 'staff', 'kitchen', 'admin']
    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be one of: ' + allowedRoles.join(', ') })
    }

    const update = {}
    if (role) update.role = role
    if (name) update.name = name.trim()

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).select('-password')
    if (!user) return res.status(404).json({ message: 'User not found' })

    res.json({ user })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// DELETE /api/users/:id  — delete user (admin only)
exports.remove = async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot delete your own account' })
    }
    const user = await User.findByIdAndDelete(req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found' })
    res.json({ success: true, message: 'User deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// PUT /api/users/me/profile  — update own profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body
    const update = {}
    if (name) update.name = name.trim()
    if (email) {
      const taken = await User.findOne({ email: email.toLowerCase(), _id: { $ne: req.user._id } })
      if (taken) return res.status(400).json({ message: 'Email is already in use' })
      update.email = email.toLowerCase()
    }

    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true, runValidators: true }).select('-password')
    res.json({ user })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// PUT /api/users/me/password  — change own password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: 'Both currentPassword and newPassword are required' })
    if (newPassword.length < 6)
      return res.status(400).json({ message: 'New password must be at least 6 characters' })

    const user = await User.findById(req.user._id)
    const valid = await user.comparePassword(currentPassword)
    if (!valid) return res.status(400).json({ message: 'Current password is incorrect' })

    user.password = newPassword
    await user.save()
    res.json({ success: true, message: 'Password updated successfully' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}
