const jwt = require('jsonwebtoken')
const User = require('../models/User')

const signToken = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' })

const safeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
})

// POST /api/auth/register
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body
    if (!name || !email || !password)
      return res.status(400).json({ message: 'Name, email and password are required' })
    if (password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters' })

    const exists = await User.findOne({ email: email.toLowerCase() })
    if (exists) return res.status(400).json({ message: 'Email already in use' })

    const user = await User.create({ name: name.trim(), email: email.toLowerCase(), password })
    const token = signToken(user)
    res.status(201).json({ token, user: safeUser(user) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required' })

    const user = await User.findOne({ email: email.toLowerCase() })
    if (!user) return res.status(400).json({ message: 'Invalid email or password' })

    const valid = await user.comparePassword(password)
    if (!valid) return res.status(400).json({ message: 'Invalid email or password' })

    const token = signToken(user)
    res.json({ token, user: safeUser(user) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// GET /api/auth/me
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password')
    if (!user) return res.status(404).json({ message: 'User not found' })
    res.json({ user: safeUser(user) })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}
