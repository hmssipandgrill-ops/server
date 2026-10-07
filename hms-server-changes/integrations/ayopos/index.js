'use strict'
const express = require('express')
const MenuItem = require('../../models/MenuItem')
const Category = require('../../models/Category')
const AyoposConnection = require('../../models/AyoposConnection')
const ProcessedEvent = require('../../models/ProcessedEvent')
const { auth, roles } = require('../../middleware/auth')
const { createService } = require('./service')

const repo = {
  async get(withSecret) {
    const q = AyoposConnection.findOneAndUpdate({ key: 'default' }, { $setOnInsert: { key: 'default' } }, { upsert: true, new: true, setDefaultsOnInsert: true })
    return withSecret ? q.select('+secretEnc') : q
  },
  update: (patch) => AyoposConnection.updateOne({ key: 'default' }, { $set: patch }, { upsert: true }),
}

const service = createService({ repo, MenuItem, Category, Processed: ProcessedEvent })

/** Small in-memory limiter for the public webhook (per IP). Signature checks are the real defence; this just caps abuse. */
const hits = new Map()
function webhookLimiter(req, res, next) {
  const now = Date.now(), key = req.ip, e = hits.get(key)
  if (!e || now - e.start > 60000) hits.set(key, { start: now, n: 1 })
  else if (++e.n > 120) return res.status(429).json({ message: 'Too many requests' })
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > 60000) hits.delete(k)
  next()
}

const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req)) } catch (e) { res.status(e.status || 500).json({ message: e.status ? e.message : 'Something went wrong' }); if (!e.status) console.error('[ayopos]', e) }
}

// "Check settings" makes outgoing requests on the admin's behalf: keep it to a handful per minute.
const checks = new Map()
function checkLimiter(req, res, next) {
  const now = Date.now(), k = String(req.user && req.user._id), e = checks.get(k)
  if (!e || now - e.start > 60000) checks.set(k, { start: now, n: 1 })
  else if (++e.n > 6) return res.status(429).json({ message: 'Please wait a minute before checking again.' })
  next()
}

const router = express.Router()
// Public, but every request must carry a valid HMAC signature + fresh timestamp + unseen event id.
router.post('/webhook', webhookLimiter, wrap((req) => service.handleWebhook(req.headers, req.rawBody || Buffer.alloc(0))))
// Admin only
// A harmless, public "is this the right website?" answer, used by "Check settings" to prove a typed address leads back here.
router.get('/whoami', (req, res) => res.json({ ok: true, service: 'hms-ayopos-connector' }))
/** Best guess of this API's public address, from how the admin reached it (only ever a suggestion the admin can edit). */
const suggestedUrl = (req) => {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim()
  return host ? `${proto}://${host}` : null
}
// Highest role only (admin). The settings can only be changed while disconnected.
router.get('/',        auth, roles('admin'), wrap((req) => service.status({ suggestedPublicApiUrl: suggestedUrl(req) })))
router.put('/settings',       auth, roles('admin'), wrap((req) => service.saveSettings(req.body)))
router.post('/settings/check', auth, roles('admin'), checkLimiter, wrap((req) => service.checkSettings(req.body && Object.keys(req.body).length ? req.body : null)))
router.post('/pair',   auth, roles('admin'), wrap((req) => service.pair(req.body?.pairingCode)))
router.post('/sync',   auth, roles('admin'), wrap(async () => ({ ...(await service.pushAll()), ...(await service.status()) })))
router.delete('/',     auth, roles('admin'), wrap(() => service.disconnect()))

/** Safety net: every 15 minutes push anything that changed but was missed (e.g. server restarted mid-queue). */
function startReconciler() {
  const t = setInterval(async () => { try { const s = await service.status(); if (s.status === 'ACTIVE' && s.direction !== 'AYOPOS_TO_SITE') await service.pushAll({ sinceOnly: true }) } catch (e) { console.error('[ayopos] reconcile:', e.message) } }, 15 * 60 * 1000)
  t.unref?.()
}

module.exports = { router, startReconciler, onItemSaved: service.onItemSaved, onItemDeleted: service.onItemDeleted, service }
