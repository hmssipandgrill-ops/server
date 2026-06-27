const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const mongoose = require('mongoose')
const cors = require('cors')
require('dotenv').config()

const app = express()
const server = http.createServer(app)

const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || '*', methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling'],
})

app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use((req, res, next) => { req.io = io; next() })

app.use('/api/auth',      require('./routes/auth'))
app.use('/api/menu',      require('./routes/menu'))
app.use('/api/orders',    require('./routes/orders'))
app.use('/api/users',     require('./routes/users'))
app.use('/api/analytics', require('./routes/analytics'))
app.use('/api/contact',   require('./routes/contact'))
app.use('/api/upload',      require('./routes/upload'))
app.use('/api/categories', require('./routes/categories'))

app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  time: new Date().toISOString(),
  db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
}))

app.use('/api/*', (req, res) => res.status(404).json({ message: 'Route not found' }))
app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message || 'Server error' }))

io.on('connection', (socket) => {
  socket.on('join-room', (role) => {
    if (['kitchen', 'admin', 'staff'].includes(role)) socket.join(role)
  })
  socket.on('join-user', (userId) => { if (userId) socket.join('customer-' + userId) })
  socket.on('order-ready-ping', ({ userId, orderId }) => {
    io.to('customer-' + userId).emit('order-ready', { orderId })
  })
})

const PORT = process.env.PORT || 5000

async function autoSeed() {
  try {
    const User = require('./models/User')
    const adminCount = await User.countDocuments({ role: 'admin' })
    if (adminCount === 0) {
      await User.create({ name: 'HMS Admin', email: 'admin@hmssipandgrill.com', password: 'Admin@HMS2026!', role: 'admin' })
      console.log('✓ Default admin created: admin@hmssipandgrill.com / Admin@HMS2026!')
    }
  } catch (e) { console.log('Auto-seed skipped:', e.message) }
}

async function startServer() {
  const uri = process.env.MONGODB_URI

  if (!uri || uri.includes('YOUR_USERNAME')) {
    console.error('\n╔══════════════════════════════════════════════════════════╗')
    console.error('║  ❌  MONGODB_URI not set in your .env file               ║')
    console.error('║                                                          ║')
    console.error('║  Steps to fix:                                           ║')
    console.error('║  1. Go to https://mongodb.com/cloud/atlas (free)        ║')
    console.error('║  2. Create a cluster → Connect → Drivers → copy URI     ║')
    console.error('║  3. Paste into server/.env as MONGODB_URI=...           ║')
    console.error('║  4. Run: npm run dev                                     ║')
    console.error('╚══════════════════════════════════════════════════════════╝\n')
    process.exit(1)
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })
    console.log('✓ MongoDB connected')
    await autoSeed()
    server.listen(PORT, () => {
      console.log('✓ HMS Server running → http://localhost:' + PORT)
    })
  } catch (error) {
    console.error('\n╔══════════════════════════════════════════════════════════╗')
    console.error('║  ❌  MongoDB connection failed                           ║')
    console.error('╠══════════════════════════════════════════════════════════╣')
    console.error('║  Error: ' + error.message.slice(0, 50).padEnd(50) + '  ║')
    console.error('╠══════════════════════════════════════════════════════════╣')
    console.error('║  Common fixes:                                           ║')
    console.error('║  • Check your MONGODB_URI in server/.env                ║')
    console.error('║  • Whitelist your IP in MongoDB Atlas Network Access    ║')
    console.error('║  • Ensure username/password in URI are correct          ║')
    console.error('╚══════════════════════════════════════════════════════════╝\n')
    process.exit(1)
  }
}

startServer()
