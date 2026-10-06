const mongoose = require('mongoose')

/** Event ids already handled — rejects replays. Auto-expires well after the 5-minute signature window. */
const schema = new mongoose.Schema({
  eventId:   { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 2 },
})

module.exports = mongoose.model('ProcessedEvent', schema)
