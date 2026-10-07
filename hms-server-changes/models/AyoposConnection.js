const mongoose = require('mongoose')

/** Single-row settings document: this website's link to one AYOPOS business. The signing secret is stored encrypted. */
const schema = new mongoose.Schema({
  key:               { type: String, default: 'default', unique: true },
  status:            { type: String, enum: ['DISCONNECTED', 'ACTIVE', 'PAUSED'], default: 'DISCONNECTED' },
  connectionId:      { type: String, default: null },
  secretEnc:         { type: String, default: null, select: false },
  direction:         { type: String, enum: ['TWO_WAY', 'SITE_TO_AYOPOS', 'AYOPOS_TO_SITE'], default: 'TWO_WAY' },
  conflictPolicy:    { type: String, enum: ['LATEST_WINS', 'AYOPOS_WINS', 'SITE_WINS'], default: 'LATEST_WINS' },
  ayoposApiBase:     { type: String, default: null },
  ayoposBusinessName:{ type: String, default: null },
  ayoposBusiness:    { type: mongoose.Schema.Types.Mixed, default: null },
  lastSyncAt:        { type: Date, default: null },
  lastError:         { type: String, default: null },
  connectedAt:       { type: Date, default: null },
  // Connection settings entered by the top admin on the dashboard (see integrations/ayopos/settings.js). Env vars are the fallback.
  config:            { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true })

module.exports = mongoose.model('AyoposConnection', schema)
