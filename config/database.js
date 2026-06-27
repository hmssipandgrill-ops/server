const mongoose = require('mongoose')

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hmslounge', {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    })
    console.log(`✓ MongoDB connected: ${conn.connection.host}`)
    return conn
  } catch (error) {
    console.error('✗ MongoDB connection failed:', error.message)
    throw error
  }
}

module.exports = connectDB
