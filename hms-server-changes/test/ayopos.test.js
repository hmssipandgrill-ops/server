'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
process.env.INTEGRATION_ENC_KEY = 'x'.repeat(48)

const { signRequest, verifyRequest } = require('../integrations/ayopos/signing')
const { toCommonProduct, sanitiseIncomingProduct, decideConflict } = require('../integrations/ayopos/mapping')
const { encrypt, decrypt } = require('../integrations/ayopos/secret-box')
const { createService } = require('../integrations/ayopos/service')

const SECRET = 's'.repeat(40)
const silent = { warn() {}, error() {}, log() {} }

// ---------- signing ----------
test('signature round-trips and rejects tampering, staleness, wrong source, bad format', () => {
  const rawBody = Buffer.from('{"type":"ping"}')
  const h = signRequest(SECRET, { source: 'ayopos', rawBody, connectionId: 'c1' })
  assert.equal(verifyRequest(SECRET, h, rawBody, { expectedSource: 'ayopos' }).ok, true)
  assert.equal(verifyRequest(SECRET, h, Buffer.from('{"type":"pinG"}'), { expectedSource: 'ayopos' }).reason, 'bad_signature')
  assert.equal(verifyRequest('t'.repeat(40), h, rawBody, { expectedSource: 'ayopos' }).reason, 'bad_signature')
  assert.equal(verifyRequest(SECRET, h, rawBody, { expectedSource: 'site' }).reason, 'wrong_source')
  assert.equal(verifyRequest(SECRET, h, rawBody, { expectedSource: 'ayopos', now: Date.now() + 6 * 60 * 1000 }).reason, 'stale_timestamp')
  assert.equal(verifyRequest(SECRET, { ...h, 'x-ayopos-signature': 'v1=zz' }, rawBody).reason, 'bad_signature_format')
  assert.equal(verifyRequest(SECRET, {}, rawBody).reason, 'missing_headers')
  // reflection: a request the SITE signed cannot be accepted as coming from AYOPOS, even with the same secret
  const siteSigned = signRequest(SECRET, { source: 'site', rawBody })
  assert.equal(verifyRequest(SECRET, { ...siteSigned, 'x-ayopos-source': 'ayopos' }, rawBody, { expectedSource: 'ayopos' }).reason, 'bad_signature')
})

// ---------- secret at rest ----------
test('secret box encrypts, decrypts, detects tampering', () => {
  const blob = encrypt(SECRET)
  assert.ok(!blob.includes(SECRET))
  assert.equal(decrypt(blob), SECRET)
  const parts = blob.split('.'); parts[3] = Buffer.from('tampered').toString('base64url')
  assert.throws(() => decrypt(parts.join('.')))
})

// ---------- mapping ----------
test('common product exposes only the shared fields', () => {
  const p = toCommonProduct({ _id: 'a'.repeat(24), name: ' Jollof ', description: 'd', basePrice: 0, sizes: [{ label: 'S', price: 1500 }, { label: 'L', price: 900 }], image: 'http://insecure/x.png', category: 'Mains', isActive: true, updatedAt: new Date('2026-01-01'), prepTime: 20, allergens: ['nuts'], isPopular: true })
  assert.deepEqual(Object.keys(p).sort(), ['category', 'currency', 'description', 'externalId', 'imageUrl', 'isActive', 'name', 'price', 'updatedAt'])
  assert.equal(p.price, 900); assert.equal(p.imageUrl, 'https://insecure/x.png'); assert.equal(p.name, 'Jollof')   // http:// is upgraded: AYOPOS is https, so an http picture would be blocked
})
test('incoming product is allow-listed and validated', () => {
  const ok = sanitiseIncomingProduct({ ayoposId: 'prd_1', name: 'X', price: '12.345', isActive: 'yes', updatedAt: '2026-02-01T00:00:00Z', evil: '$where', imageUrl: 'javascript:alert(1)' })
  assert.deepEqual(Object.keys(ok.value).sort(), ['ayoposId', 'imageUrl', 'isActive', 'name', 'price', 'updatedAt'])
  assert.equal(ok.value.price, 12.35); assert.equal(ok.value.isActive, false); assert.equal(ok.value.imageUrl, '')
  for (const bad of [null, {}, { ayoposId: 'a', updatedAt: 'nope' }, { ayoposId: 'a', updatedAt: '2026-01-01', price: -1 }, { ayoposId: 'a b', updatedAt: '2026-01-01' }, { externalId: 'not-an-objectid', updatedAt: '2026-01-01' }, { ayoposId: 'a', updatedAt: '2026-01-01', name: '   ' }])
    assert.ok(sanitiseIncomingProduct(bad).error, JSON.stringify(bad))
})
test('conflict rules', () => {
  const t = (s) => new Date(`2026-01-01T00:00:${s}Z`)
  // untouched locally since last sync -> take newer, ignore out-of-order older
  assert.equal(decideConflict({ policy: 'SITE_WINS', local: { updatedAt: t('10'), syncedAt: t('10') }, incomingUpdatedAt: t('20') }).apply, true)
  assert.equal(decideConflict({ policy: 'AYOPOS_WINS', local: { updatedAt: t('10'), syncedAt: t('10') }, incomingUpdatedAt: t('05') }).apply, false)
  // edited on both sides
  const both = { updatedAt: t('30'), syncedAt: t('10') }
  assert.equal(decideConflict({ policy: 'AYOPOS_WINS', local: both, incomingUpdatedAt: t('20') }).apply, true)
  assert.equal(decideConflict({ policy: 'SITE_WINS', local: both, incomingUpdatedAt: t('40') }).apply, false)
  assert.equal(decideConflict({ policy: 'LATEST_WINS', local: both, incomingUpdatedAt: t('40') }).apply, true)
  assert.equal(decideConflict({ policy: 'LATEST_WINS', local: both, incomingUpdatedAt: t('20') }).apply, false)
  assert.equal(decideConflict({ policy: 'LATEST_WINS', local: null, incomingUpdatedAt: t('20') }).apply, true)
})

// ---------- service with in-memory fakes ----------
let clock = Date.parse('2026-03-01T10:00:00Z'); const tick = () => new Date((clock += 1000))
let seq = 0; const oid = () => (++seq).toString(16).padStart(24, '0')
function world({ direction = 'TWO_WAY', conflictPolicy = 'LATEST_WINS', status = 'ACTIVE', env = {} } = {}) {
  const items = []; const cats = []; const seen = new Set(); const calls = []
  const conn = { status, direction, conflictPolicy, connectionId: 'conn_1', secretEnc: status === 'DISCONNECTED' ? null : encrypt(SECRET), ayoposApiBase: 'https://api.ayopos.test/api/v1', lastError: null }
  class MenuItem {
    constructor(d) { Object.assign(this, { sizes: [], isActive: true, ayoposId: null, syncedAt: null, $locals: {} }, d, { _id: d._id || oid() }) }
    async save() { this.updatedAt = tick(); this.createdAt ??= this.updatedAt; if (!items.includes(this)) items.push(this); return this }
    static find(f = {}) { // mongoose-like: awaitable, and .sort() is chainable
      const r = items.filter((i) => (!f._id ? true : f._id.$in.includes(String(i._id)))).sort((a, b) => String(a._id).localeCompare(String(b._id)))
      const q = { sort: () => q, then: (res, rej) => Promise.resolve(r).then(res, rej) }
      return q
    }
    static async findOne(f) { return items.find((i) => i.ayoposId === f.ayoposId) || null }
    static async findById(id) { return items.find((i) => String(i._id) === String(id)) || null }
    static async countDocuments(f = {}) { return items.filter((i) => !f.ayoposId || i.ayoposId !== null).length }
    static async findOneAndUpdate(q, u) { const i = await MenuItem.findById(q._id); Object.assign(i, u.$set); i.updatedAt = tick(); return i }
    static async updateOne(q, u) { const i = await MenuItem.findById(q._id); Object.assign(i, u.$set) }
  }
  const Category = { findOne: async (f) => cats.find((c) => c.slug === f.slug) || null, create: async ({ name }) => { cats.push({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') }) } }
  const Processed = { create: async ({ eventId }) => { if (seen.has(eventId)) throw Object.assign(new Error('dup'), { code: 11000 }); seen.add(eventId) } }
  const repo = { get: async () => ({ ...conn }), update: async (p) => { Object.assign(conn, p) } }
  const http = async (url, body, opts) => { calls.push({ url, body, opts }); return http.reply(url, body) }
  http.reply = () => ({})
  const svc = createService({ repo, MenuItem, Category, Processed, http, log: silent, env: { AYOPOS_API_BASE: 'https://api.ayopos.test/api/v1', PUBLIC_API_URL: 'https://site.test', ...env } })
  const hook = (rawObj, source = 'ayopos', secret = SECRET) => { const rawBody = Buffer.from(JSON.stringify(rawObj)); return [signRequest(secret, { source, rawBody, connectionId: 'conn_1' }), rawBody] }
  return { items, cats, calls, conn, svc, MenuItem, http, hook }
}
const upsert = (p) => ({ type: 'product.upserted', product: { updatedAt: new Date(clock + 60000).toISOString(), ...p } })

test('pushAll sends common fields, stores ayoposId and marks items as synced', async () => {
  const w = world(); const a = await new w.MenuItem({ name: 'Suya', category: 'Grill', basePrice: 2500 }).save(); const b = await new w.MenuItem({ name: 'Zobo', category: 'Drinks', basePrice: 800 }).save()
  w.http.reply = (url, body) => ({ mappings: body.products.map((p, i) => ({ externalId: p.externalId, ayoposId: `prd_${i}`, status: 'created' })) })
  const r = await w.svc.pushAll()
  assert.equal(r.sent, 2); assert.match(w.calls[0].url, /\/integrations\/store-sync\/inbound\/conn_1$/)
  assert.equal(w.calls[0].opts.secret, SECRET); assert.equal(w.calls[0].body.products.length, 2)
  assert.equal(a.ayoposId, 'prd_0'); assert.equal(+a.syncedAt, +a.updatedAt)
  assert.ok(!JSON.stringify(w.calls[0].body).includes('prepTime'))
})

test('pushAll refuses when direction is AYOPOS -> site only', async () => {
  const w = world({ direction: 'AYOPOS_TO_SITE' })
  await assert.rejects(w.svc.pushAll(), /not enabled/)
})

test('webhook: valid update applies; replay, tampering, wrong source, wrong secret are rejected', async () => {
  const w = world(); const it = await new w.MenuItem({ name: 'Old', category: 'Grill', basePrice: 100, ayoposId: 'prd_9' }).save(); it.syncedAt = it.updatedAt
  const [h, raw] = w.hook(upsert({ ayoposId: 'prd_9', name: 'New name', price: 300 }))
  const applied = await w.svc.handleWebhook(h, raw)
  assert.equal(applied.updated, String(it._id)); assert.equal(applied.updatedAt, it.updatedAt.toISOString())
  assert.equal(it.name, 'New name'); assert.equal(it.basePrice, 300); assert.equal(+it.syncedAt, +it.updatedAt)
  assert.deepEqual(await w.svc.handleWebhook(h, raw), { duplicate: true })                       // replay
  const [h2, raw2] = w.hook(upsert({ ayoposId: 'prd_9', name: 'Hacked' }))
  await assert.rejects(w.svc.handleWebhook(h2, Buffer.from(raw2.toString().replace('Hacked', 'Hackeds'))), { status: 401 })
  await assert.rejects(w.svc.handleWebhook(...w.hook(upsert({ ayoposId: 'prd_9', name: 'x' }), 'site')), { status: 401 })
  await assert.rejects(w.svc.handleWebhook(...w.hook(upsert({ ayoposId: 'prd_9', name: 'x' }), 'ayopos', 'z'.repeat(40))), { status: 401 })
  assert.equal(it.name, 'New name')
})

test('webhook: edit on the site since last sync is protected by SITE_WINS, overwritten by AYOPOS_WINS', async () => {
  for (const [policy, expectedName] of [['SITE_WINS', 'Local edit'], ['AYOPOS_WINS', 'From AYOPOS']]) {
    const w = world({ conflictPolicy: policy }); const it = await new w.MenuItem({ name: 'Base', category: 'Grill', basePrice: 100, ayoposId: 'prd_1' }).save()
    it.syncedAt = it.updatedAt; it.name = 'Local edit'; await it.save()
    const r = await w.svc.handleWebhook(...w.hook(upsert({ ayoposId: 'prd_1', name: 'From AYOPOS' })))
    assert.equal(it.name, expectedName, JSON.stringify(r))
  }
})

test('webhook: direction and pause gates, and no price change on items with sizes', async () => {
  const one = world({ direction: 'SITE_TO_AYOPOS' }); assert.deepEqual(await one.svc.handleWebhook(...one.hook(upsert({ ayoposId: 'p', name: 'x' }))), { ignored: 'direction' })
  const two = world({ status: 'PAUSED' }); assert.deepEqual(await two.svc.handleWebhook(...two.hook(upsert({ ayoposId: 'p', name: 'x' }))), { ignored: 'paused' })
  const w = world(); const it = await new w.MenuItem({ name: 'Wine', category: 'Drinks', basePrice: 0, sizes: [{ label: 'Glass', price: 2000 }], ayoposId: 'prd_w' }).save(); it.syncedAt = it.updatedAt
  const r = await w.svc.handleWebhook(...w.hook(upsert({ ayoposId: 'prd_w', price: 1 })))
  assert.equal(r.note, 'price_skipped_has_sizes'); assert.equal(it.basePrice, 0)
})

test('webhook: new products from AYOPOS arrive hidden by default, category is created, no echo to AYOPOS', async () => {
  const w = world()
  const r = await w.svc.handleWebhook(...w.hook(upsert({ ayoposId: 'prd_new', name: 'Pizza', category: 'Mains', price: 5000, isActive: true })))
  assert.equal(r.published, false); const doc = w.items.find((i) => i.ayoposId === 'prd_new')
  assert.equal(doc.isActive, false); assert.equal(w.cats.length, 1)
  w.svc.onItemSaved(doc); assert.equal(w.svc._pending.size, 0)           // inbound-created doc is flagged: nothing queued
  const fresh = await new w.MenuItem({ name: 'Local', category: 'Mains', basePrice: 1 }).save(); w.svc.onItemSaved(fresh); assert.equal(w.svc._pending.size, 1)
  const auto = world({ env: { AYOPOS_AUTO_PUBLISH: 'true' } })
  assert.equal((await auto.svc.handleWebhook(...auto.hook(upsert({ ayoposId: 'prd_n2', name: 'Pizza', category: 'Mains', price: 5000, isActive: true })))).published, true)
})

test('webhook: delete hides instead of destroying; revoke wipes the secret; bad payloads are rejected', async () => {
  const w = world(); const it = await new w.MenuItem({ name: 'Gone', category: 'x', basePrice: 1, ayoposId: 'prd_d' }).save()
  assert.deepEqual(await w.svc.handleWebhook(...w.hook({ type: 'product.deleted', product: { ayoposId: 'prd_d' } })), { hidden: String(it._id) })
  assert.equal(it.isActive, false); assert.equal(w.items.length, 1)
  assert.deepEqual(await w.svc.handleWebhook(...w.hook(upsert({ ayoposId: 'prd_d', price: -5 }))), { rejected: 'bad_price' })
  await w.svc.handleWebhook(...w.hook({ type: 'connection.revoked' }))
  assert.equal(w.conn.status, 'DISCONNECTED'); assert.equal(w.conn.secretEnc, null)
  await assert.rejects(w.svc.handleWebhook(...w.hook({ type: 'ping' })), { status: 401 })
})

test('pair: stores an encrypted secret, never the plain one; rejects odd replies and codes', async () => {
  const w = world({ status: 'DISCONNECTED' }); await new w.MenuItem({ name: 'A', category: 'x', basePrice: 1 }).save()
  await assert.rejects(w.svc.pair('bad'), { status: 400 })
  w.http.reply = () => ({ connectionId: 'conn_9', signingSecret: 'short', direction: 'TWO_WAY', conflictPolicy: 'LATEST_WINS' })
  await assert.rejects(w.svc.pair('ABCD-EFGH-1234'), { status: 502 })
  w.http.reply = (url) => (url.endsWith('/pair') ? { connectionId: 'conn_9', signingSecret: SECRET, direction: 'TWO_WAY', conflictPolicy: 'AYOPOS_WINS', businessName: 'HMS Lounge & Bar' } : { mappings: [] })
  const s = await w.svc.pair('abcd-efgh-1234')
  assert.equal(s.status, 'ACTIVE'); assert.equal(w.conn.conflictPolicy, 'AYOPOS_WINS'); assert.notEqual(w.conn.secretEnc, SECRET); assert.equal(decrypt(w.conn.secretEnc), SECRET)
  assert.equal(w.calls.find((c) => c.url.endsWith('/pair')).opts.attempts, 1)
  await assert.rejects(w.svc.pair('ABCD-EFGH-1234'), { status: 409 })
})
