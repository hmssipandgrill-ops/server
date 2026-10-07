'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
process.env.INTEGRATION_ENC_KEY = 'x'.repeat(48)
const { normaliseSettings, effectiveSettings } = require('../integrations/ayopos/settings')
const { createService } = require('../integrations/ayopos/service')

const good = { apiBase: 'api.ayopos.com', publicApiUrl: 'https://api.hms-lounge.com/', siteUrl: '', business: { name: ' HMS Lounge ', phone: '0800', email: 'hms@x.com', address: 'Abuja', logoUrl: '' } }
const bad = (over, re) => assert.throws(() => normaliseSettings({ ...good, ...over }), (e) => e.status === 400 && re.test(e.message), JSON.stringify(over))

test('addresses are cleaned: https added, /api/v1 appended to the AYOPOS address, trailing slashes removed', () => {
  const s = normaliseSettings(good)
  assert.equal(s.apiBase, 'https://api.ayopos.com/api/v1')
  assert.equal(s.publicApiUrl, 'https://api.hms-lounge.com')
  assert.equal(s.siteUrl, ''); assert.equal(s.business.name, 'HMS Lounge')
  assert.equal(normaliseSettings({ ...good, apiBase: 'https://api.ayopos.com/api/v1/' }).apiBase, 'https://api.ayopos.com/api/v1')
  assert.equal(normaliseSettings({ ...good, apiBase: 'https://api.ayopos.com/custom/path' }).apiBase, 'https://api.ayopos.com/custom/path')
})

test('unsafe or unusable addresses are refused with a plain message', () => {
  bad({ apiBase: '' }, /AYOPOS API address is required/)
  bad({ publicApiUrl: '  ' }, /API address is required/)
  bad({ apiBase: 'http://api.ayopos.com' }, /https/)
  bad({ apiBase: 'https://user:pw@api.ayopos.com' }, /username or password/)
  bad({ apiBase: 'https://api.ayopos.com/x?y=1' }, /“\?”/)
  bad({ publicApiUrl: 'https://192.168.1.10' }, /public address/)
  bad({ publicApiUrl: 'https://169.254.169.254' }, /public address/)
  bad({ publicApiUrl: 'https://intranet' }, /public address/)
  bad({ publicApiUrl: 'https://api.hms.com:8443' }, /port 443/)
  bad({ apiBase: 'not a url ::' }, /valid web address|public address/)
  bad({ business: { email: 'nope' } }, /email/)
  bad({ business: { logoUrl: 'http://x/logo.png' } }, /https/)
  assert.equal(normaliseSettings({ ...good, autoPublish: 'yes' }).autoPublish, false)       // only a real boolean true turns it on
})

test('in development, plain-http localhost is allowed so it can be tried locally; never in production', () => {
  assert.equal(normaliseSettings({ ...good, apiBase: 'http://localhost:8080', publicApiUrl: 'http://localhost:5000' }).apiBase, 'http://localhost:8080/api/v1')
  const prev = process.env.NODE_ENV; process.env.NODE_ENV = 'production'
  try { bad({ apiBase: 'http://localhost:8080' }, /https/); bad({ apiBase: 'https://localhost:8080' }, /public address/); bad({ publicApiUrl: 'https://127.0.0.1' }, /public address/) } finally { process.env.NODE_ENV = prev }
})

test('saved settings win; blanks fall back to the server environment', () => {
  const env = { AYOPOS_API_BASE: 'https://env.example.com/api/v1/', PUBLIC_API_URL: 'https://env-site.example.com', BUSINESS_NAME: 'Env Name', BUSINESS_PHONE: '111', AYOPOS_AUTO_PUBLISH: 'true' }
  const e = effectiveSettings({ apiBase: 'https://saved.example.com/api/v1', business: { name: 'Saved Name', phone: '' }, autoPublish: false }, env)
  assert.equal(e.apiBase, 'https://saved.example.com/api/v1'); assert.equal(e.publicApiUrl, 'https://env-site.example.com')
  assert.equal(e.business.name, 'Saved Name'); assert.equal(e.business.phone, '111'); assert.equal(e.autoPublish, false)
  assert.equal(effectiveSettings(null, env).apiBase, 'https://env.example.com/api/v1'); assert.equal(effectiveSettings(null, env).autoPublish, true)
  assert.equal(effectiveSettings(null, {}).business.name, 'HMS Lounge & Bar')
})

function world({ status = 'DISCONNECTED', env = {}, fetchImpl } = {}) {
  const conn = { status, direction: 'TWO_WAY', conflictPolicy: 'LATEST_WINS', connectionId: null, secretEnc: null, ayoposApiBase: null, lastError: null, config: null }
  const calls = []
  const http = async (url, body) => { calls.push({ url, body }); return { connectionId: 'c1', signingSecret: 's'.repeat(43), direction: 'TWO_WAY', conflictPolicy: 'LATEST_WINS', businessName: 'AYOPOS Biz' } }
  const svc = createService({ repo: { get: async () => ({ ...conn }), update: async (p) => { Object.assign(conn, p) } }, MenuItem: { countDocuments: async () => 3 }, Category: {}, Processed: {}, env, http, fetchImpl, log: { warn() {}, error() {}, log() {} } })
  return { svc, conn, calls }
}

test('nothing set up: the page is "not configured"; saving settings makes it configured (no environment variables needed)', async () => {
  const w = world()
  const before = await w.svc.status({ suggestedPublicApiUrl: 'https://api.hms-lounge.com' })
  assert.equal(before.configured, false); assert.equal(before.canEditSettings, true); assert.equal(before.suggestedPublicApiUrl, 'https://api.hms-lounge.com')
  await assert.rejects(w.svc.pair('ABCD-EFGH-1234'), (e) => e.status === 400 && /Save the connection settings/.test(e.message))
  const after = await w.svc.saveSettings(good)
  assert.equal(after.configured, true); assert.equal(after.settings.apiBase, 'https://api.ayopos.com/api/v1')
})

test('pairing uses the saved settings: AYOPOS address, webhook address, website address and business details', async () => {
  const w = world()
  await w.svc.saveSettings({ ...good, siteUrl: 'hms-lounge.com' })
  await w.svc.pair('abcd-efgh-1234')
  const [pairCall] = w.calls
  assert.equal(pairCall.url, 'https://api.ayopos.com/api/v1/integrations/store-sync/pair')
  assert.equal(pairCall.body.webhookUrl, 'https://api.hms-lounge.com/api/integrations/ayopos/webhook')
  assert.equal(pairCall.body.site.url, 'https://hms-lounge.com'); assert.deepEqual(pairCall.body.business, { name: 'HMS Lounge', phone: '0800', email: 'hms@x.com', address: 'Abuja', logoUrl: '' })
  assert.equal(w.conn.ayoposApiBase, 'https://api.ayopos.com/api/v1'); assert.equal(w.conn.status, 'ACTIVE')
})

test('settings cannot be changed while connected', async () => {
  const w = world({ status: 'ACTIVE' })
  await assert.rejects(w.svc.saveSettings(good), (e) => e.status === 409 && /Disconnect/.test(e.message))
  assert.equal((await w.svc.status()).canEditSettings, false)
  const bad = world(); await assert.rejects(bad.svc.saveSettings({ ...good, apiBase: 'http://evil.example.com' }), (e) => e.status === 400)
  assert.equal(bad.conn.config, null)                                           // nothing half-saved
})

test('"Check settings" proves both ends can be reached, explains failures, and does not save', async () => {
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(url)
    if (url.endsWith('/healthz')) return { ok: true, status: 200, json: async () => ({}) }
    if (url.endsWith('/api/integrations/ayopos/whoami')) return { ok: true, status: 200, json: async () => ({ ok: true, service: 'hms-ayopos-connector' }) }
    throw new Error('unexpected ' + url)
  }
  const w = world({ fetchImpl })
  const r = await w.svc.checkSettings(good)
  assert.equal(r.ok, true); assert.equal(r.ayopos.ok, true); assert.equal(r.website.ok, true)
  assert.deepEqual(seen.sort(), ['https://api.ayopos.com/healthz', 'https://api.hms-lounge.com/api/integrations/ayopos/whoami'])   // healthz is at the API root, not under /api/v1
  assert.equal(w.conn.config, null)

  const w2 = world({ fetchImpl: async (url) => (url.endsWith('/healthz') ? { ok: false, status: 502 } : { ok: true, status: 200, json: async () => ({ ok: true, service: 'something-else' }) }) })
  const r2 = await w2.svc.checkSettings(good)
  assert.equal(r2.ok, false); assert.match(r2.ayopos.message, /could not be reached.*502/); assert.match(r2.website.message, /does not lead back to this website/)
  const w3 = world({ fetchImpl: async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }) } })
  assert.match((await w3.svc.checkSettings(good)).website.message, /did not answer in time/)
  await assert.rejects(w3.svc.checkSettings({ ...good, publicApiUrl: '' }), (e) => e.status === 400)
})

test('auto-publish setting controls whether AYOPOS-created products go live', async () => {
  const items = []
  class MenuItem { constructor(d) { Object.assign(this, { $locals: {}, sizes: [] }, d, { _id: 'a'.repeat(24), updatedAt: new Date() }) } async save() { items.push(this); return this } static async countDocuments() { return 0 } static async findOne() { return null } static async findById() { return null } static async updateOne() {} }
  for (const [saved, expected] of [[true, true], [false, false]]) {
    items.length = 0
    const conn = { status: 'ACTIVE', direction: 'TWO_WAY', conflictPolicy: 'LATEST_WINS', config: { autoPublish: saved } }
    const svc = createService({ repo: { get: async () => ({ ...conn }), update: async () => {} }, MenuItem, Category: { findOne: async () => ({}), create: async () => {} }, Processed: {}, env: { AYOPOS_AUTO_PUBLISH: String(!saved) }, log: console })
    const r = await svc.applyProduct(conn, { type: 'product.upserted', ayoposId: 'prd_1', name: 'Pizza', category: 'Mains', price: 5000, isActive: true, updatedAt: new Date().toISOString() })
    assert.equal(r.published, expected)
  }
})
