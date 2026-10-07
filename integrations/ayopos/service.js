'use strict'
const { verifyRequest } = require('./signing')
const { encrypt, decrypt } = require('./secret-box')
const { postJson } = require('./http')
const { toCommonProduct, sanitiseIncomingProduct, decideConflict } = require('./mapping')
const { normaliseSettings, effectiveSettings } = require('./settings')

const BATCH = 100
const DEBOUNCE_MS = 2000
const MAX_ATTEMPTS = 5
const DIRECTIONS = ['TWO_WAY', 'SITE_TO_AYOPOS', 'AYOPOS_TO_SITE']
const POLICIES = ['LATEST_WINS', 'AYOPOS_WINS', 'SITE_WINS']

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code })
const slugify = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

/**
 * The website side of the AYOPOS link. Dependencies are injected so the rules can be tested without a database or network.
 *
 *  repo.get(withSecret) / repo.update(patch)  — the single connection row
 *  MenuItem, Category, Processed              — mongoose models (or compatible fakes)
 *  http(url, body, opts)                      — signed POST helper
 */
function createService({ repo, MenuItem, Category, Processed, env = process.env, http = postJson, fetchImpl = fetch, log = console }) {
  const pending = new Map()
  let timer = null

  const settingsOf = (c) => effectiveSettings(c.config, env)
  const canPush = (c) => c.status === 'ACTIVE' && c.direction !== 'AYOPOS_TO_SITE'
  const canApply = (c) => c.status === 'ACTIVE' && c.direction !== 'SITE_TO_AYOPOS'
  const inboundUrl = (c, path) => `${c.ayoposApiBase}/integrations/store-sync/${path}/${c.connectionId}`

  async function status(extra = {}) {
    const c = await repo.get(false)
    const linked = await MenuItem.countDocuments({ ayoposId: { $ne: null } })
    const st = settingsOf(c)
    return {
      configured: !!st.apiBase && !!st.publicApiUrl, status: c.status, connected: c.status !== 'DISCONNECTED',
      direction: c.direction, conflictPolicy: c.conflictPolicy, ayoposBusinessName: c.ayoposBusinessName, linkedProducts: linked,
      lastSyncAt: c.lastSyncAt, lastError: c.lastError, connectedAt: c.connectedAt,
      // What the admin typed on the page (or the server's environment fallback). Editable only while disconnected.
      settings: st, canEditSettings: c.status === 'DISCONNECTED', suggestedPublicApiUrl: extra.suggestedPublicApiUrl || null,
    }
  }

  /** Top admin only (enforced by the route). Changing the address of a live link would break it, so it needs a disconnect first. */
  async function saveSettings(input) {
    const c = await repo.get(false)
    if (c.status !== 'DISCONNECTED') throw httpError(409, 'Disconnect from AYOPOS before changing the connection settings.')
    const config = normaliseSettings(input)
    await repo.update({ config })
    return status()
  }

  async function probe(url, validate) {
    try {
      const res = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(6000), headers: { accept: 'application/json' } })
      if (!res.ok) return { ok: false, message: `It answered ${res.status}.` }
      return validate ? validate(await res.json().catch(() => null)) : { ok: true, message: 'Reachable.' }
    } catch (e) { return { ok: false, message: e && e.name === 'TimeoutError' ? 'It did not answer in time.' : 'Could not be reached.' } }
  }

  /** "Check settings": validates what is typed (without saving) and proves both ends can be reached. */
  async function checkSettings(input) {
    const settings = input ? normaliseSettings(input) : settingsOf(await repo.get(false))
    if (!settings.apiBase || !settings.publicApiUrl) throw httpError(400, 'Fill in both addresses first.')
    const [ayopos, website] = await Promise.all([
      probe(`${new URL(settings.apiBase).origin}/healthz`).then((r) => ({ ...r, message: r.ok ? 'AYOPOS answered.' : `AYOPOS could not be reached at that address. ${r.message}` })),
      probe(`${settings.publicApiUrl}/api/integrations/ayopos/whoami`, (j) => (j && j.service === 'hms-ayopos-connector' ? { ok: true, message: 'Reachable from the internet.' } : { ok: false, message: 'That address does not lead back to this website.' }))
        .then((r) => ({ ...r, message: r.ok ? r.message : `AYOPOS would not be able to reach this website at that address. ${r.message}` })),
    ])
    return { ayopos, website, ok: ayopos.ok && website.ok }
  }

  async function pair(rawCode) {
    const code = String(rawCode || '').trim().toUpperCase()
    if (!/^[A-Z0-9-]{8,40}$/.test(code)) throw httpError(400, 'That pairing code does not look right.')
    const existing = await repo.get(false)
    if (existing.status !== 'DISCONNECTED') throw httpError(409, 'This website is already connected. Disconnect first.')
    const st = settingsOf(existing)
    if (!st.apiBase || !st.publicApiUrl) throw httpError(400, 'Save the connection settings first (the AYOPOS address and this website’s address).')
    const business = st.business
    let res
    try {
      // attempts:1 — the code is single-use, so a blind retry after a timeout would only fail with "already used".
      res = await http(`${st.apiBase}/integrations/store-sync/pair`, {
        pairingCode: code, connectorVersion: '1.0.0', site: { url: st.siteUrl || null, name: business.name }, business,
        webhookUrl: `${st.publicApiUrl}/api/integrations/ayopos/webhook`, productCount: await MenuItem.countDocuments({}),
      }, { attempts: 1 })
    } catch (e) { throw httpError(e.status && e.status < 500 ? 400 : 502, e.status && e.status < 500 ? e.message : 'Could not reach AYOPOS. Try again in a moment.') }
    if (!res || typeof res.connectionId !== 'string' || typeof res.signingSecret !== 'string' || res.signingSecret.length < 32 || !DIRECTIONS.includes(res.direction) || !POLICIES.includes(res.conflictPolicy)) {
      throw httpError(502, 'AYOPOS sent an unexpected reply.')
    }
    await repo.update({
      status: 'ACTIVE', connectionId: res.connectionId, secretEnc: encrypt(res.signingSecret), direction: res.direction, conflictPolicy: res.conflictPolicy,
      ayoposApiBase: st.apiBase, ayoposBusinessName: typeof res.businessName === 'string' ? res.businessName.slice(0, 120) : null, connectedAt: new Date(), lastError: null,
    })
    if (res.direction !== 'AYOPOS_TO_SITE') setImmediate(() => pushAll().catch((e) => log.error('[ayopos] initial sync failed:', e.message)))
    return status()
  }

  async function disconnect() {
    const c = await repo.get(true)
    if (c.status === 'DISCONNECTED') return status()
    try { await http(inboundUrl(c, 'disconnect'), { type: 'disconnect' }, { secret: decrypt(c.secretEnc), connectionId: c.connectionId, attempts: 1 }) } catch (e) { log.warn('[ayopos] disconnect notice failed:', e.message) }
    pending.clear()
    await repo.update({ status: 'DISCONNECTED', connectionId: null, secretEnc: null, lastError: null })
    return status()
  }

  /** Pushes products (all, or only those edited since their last sync) in batches of 100. Returns counts. */
  async function pushAll({ sinceOnly = false } = {}) {
    const c = await repo.get(true)
    if (!canPush(c)) throw httpError(409, 'Pushing to AYOPOS is not enabled for this connection.')
    const filter = sinceOnly ? { $or: [{ syncedAt: null }, { $expr: { $gt: ['$updatedAt', '$syncedAt'] } }] } : {}
    const items = await MenuItem.find(filter).sort({ _id: 1 })
    let sent = 0
    try {
      for (const group of chunk(items, BATCH)) { await sendProducts(c, group, settingsOf(c).business); sent += group.length }
      if (items.length === 0 && !sinceOnly) await sendProducts(c, [], settingsOf(c).business)
      await repo.update({ lastSyncAt: new Date(), lastError: null })
    } catch (e) { await repo.update({ lastError: String(e.message).slice(0, 300) }); throw e }
    return { sent }
  }

  async function sendProducts(c, items, business) {
    const secret = decrypt(c.secretEnc)
    const res = await http(inboundUrl(c, 'inbound'), { type: 'products.upsert', products: items.map((i) => toCommonProduct(i)), ...(business ? { business } : {}) }, { secret, connectionId: c.connectionId })
    const pushedAt = new Map(items.map((i) => [String(i._id), i.updatedAt]))
    for (const m of Array.isArray(res.mappings) ? res.mappings : []) {
      if (!pushedAt.has(String(m.externalId)) || typeof m.ayoposId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(m.ayoposId)) continue
      const matched = ['created', 'updated', 'unchanged'].includes(m.status)
      await MenuItem.updateOne({ _id: m.externalId }, { $set: { ayoposId: m.ayoposId, ...(matched ? { syncedAt: pushedAt.get(String(m.externalId)) } : {}) } }, { timestamps: false })
    }
  }

  // ---- change queue (debounced; flushed in batches; retried with backoff) ----
  function enqueue(op) {
    if (op.kind === 'delete') pending.delete(`u:${op.id}`)
    pending.set(`${op.kind === 'delete' ? 'd' : 'u'}:${op.id}`, { attempts: 0, ...op })
    if (!timer) { timer = setTimeout(() => { timer = null; flush().catch((e) => log.error('[ayopos] flush:', e.message)) }, DEBOUNCE_MS); timer.unref?.() }
  }

  async function flush() {
    const ops = [...pending.values()]; pending.clear()
    if (ops.length === 0) return
    const c = await repo.get(true)
    if (!canPush(c)) return
    const ups = ops.filter((o) => o.kind === 'upsert'), dels = ops.filter((o) => o.kind === 'delete')
    try {
      if (ups.length) {
        const docs = await MenuItem.find({ _id: { $in: ups.map((o) => o.id) } })
        for (const group of chunk(docs, BATCH)) await sendProducts(c, group)
      }
      for (const group of chunk(dels, BATCH)) {
        await http(inboundUrl(c, 'inbound'), { type: 'products.delete', products: group.map((o) => ({ externalId: String(o.id), ...(o.ayoposId ? { ayoposId: o.ayoposId } : {}) })) }, { secret: decrypt(c.secretEnc), connectionId: c.connectionId })
      }
      await repo.update({ lastSyncAt: new Date(), lastError: null })
    } catch (e) {
      const retry = ops.filter((o) => o.attempts + 1 < MAX_ATTEMPTS)
      for (const o of retry) { const t = setTimeout(() => enqueue({ ...o, attempts: o.attempts + 1 }), 5000 * 2 ** o.attempts); t.unref?.() }
      await repo.update({ lastError: `Sync problem: ${String(e.message).slice(0, 250)}${retry.length ? ' (retrying)' : ''}` })
    }
  }

  // ---- inbound webhook (AYOPOS -> this site) ----
  async function handleWebhook(headers, rawBody) {
    const c = await repo.get(true)
    if (c.status === 'DISCONNECTED' || !c.secretEnc) throw httpError(401, 'Unauthorized')
    const v = verifyRequest(decrypt(c.secretEnc), headers, rawBody, { expectedSource: 'ayopos' })
    const claimedConn = headers['x-ayopos-connection']
    if (!v.ok || (claimedConn && claimedConn !== c.connectionId)) { log.warn(`[ayopos] webhook rejected: ${v.ok ? 'wrong_connection' : v.reason}`); throw httpError(401, 'Unauthorized') }
    try { await Processed.create({ eventId: v.eventId }) } catch (e) { if (e && e.code === 11000) return { duplicate: true }; throw e }

    let body
    try { body = JSON.parse(rawBody.toString('utf8')) } catch { throw httpError(400, 'Body must be JSON.') }
    switch (body && body.type) {
      case 'ping': return { pong: true }
      case 'connection.updated': {
        const patch = {}
        if (DIRECTIONS.includes(body.direction)) patch.direction = body.direction
        if (POLICIES.includes(body.conflictPolicy)) patch.conflictPolicy = body.conflictPolicy
        if (['ACTIVE', 'PAUSED'].includes(body.status)) patch.status = body.status
        await repo.update(patch); return { updated: Object.keys(patch) }
      }
      case 'connection.revoked':
        pending.clear(); await repo.update({ status: 'DISCONNECTED', connectionId: null, secretEnc: null, lastError: 'Disconnected from the AYOPOS side.' }); return { revoked: true }
      case 'business.updated': {
        const b = body.business || {}; const clean = {}
        for (const [k, max] of [['name', 120], ['phone', 40], ['email', 120], ['address', 300]]) if (typeof b[k] === 'string') clean[k] = b[k].trim().slice(0, max)
        await repo.update({ ayoposBusiness: clean, ...(clean.name ? { ayoposBusinessName: clean.name } : {}) }); return { stored: true }
      }
      case 'product.upserted': case 'product.deleted': {
        if (c.status === 'PAUSED') return { ignored: 'paused' }
        if (!canApply(c)) return { ignored: 'direction' }
        return body.type === 'product.upserted' ? applyProduct(c, body.product) : applyDelete(body.product)
      }
      default: return { ignored: 'unknown_type' }
    }
  }

  async function ensureCategory(name) {
    const slug = slugify(name)
    if (!slug) return
    if (!(await Category.findOne({ slug }))) { try { await Category.create({ name }) } catch (e) { if (e.code !== 11000) throw e } }
  }

  async function findLocal(p) {
    let item = p.ayoposId ? await MenuItem.findOne({ ayoposId: p.ayoposId }) : null
    if (!item && p.externalId) item = await MenuItem.findById(p.externalId)
    return item
  }

  async function applyProduct(c, raw) {
    const { value: p, error } = sanitiseIncomingProduct(raw)
    if (error) return { rejected: error }
    const item = await findLocal(p)

    if (!item) {
      if (!p.name || !p.category || p.price === undefined) return { rejected: 'incomplete_new_product' }
      if (!p.ayoposId) return { rejected: 'unknown_product' }
      await ensureCategory(p.category)
      // New products from outside arrive HIDDEN unless you opt in, so nothing appears on your public menu unreviewed.
      const publish = settingsOf(c).autoPublish && p.isActive === true
      const doc = new MenuItem({ name: p.name, category: p.category, description: p.description || '', basePrice: p.price, image: p.imageUrl || '', isActive: publish, ayoposId: p.ayoposId })
      doc.$locals.skipAyopos = true
      await doc.save()
      await MenuItem.updateOne({ _id: doc._id }, { $set: { syncedAt: doc.updatedAt } }, { timestamps: false })
      // updatedAt is reported in THIS server's clock so AYOPOS never has to compare its own clock with ours.
      return { created: String(doc._id), published: publish, updatedAt: new Date(doc.updatedAt).toISOString() }
    }

    const d = decideConflict({ policy: c.conflictPolicy, local: { updatedAt: item.updatedAt, syncedAt: item.syncedAt }, incomingUpdatedAt: p.updatedAt })
    if (!d.apply) return { skipped: d.reason }
    const $set = {}
    if (p.ayoposId) $set.ayoposId = p.ayoposId
    if (p.name !== undefined) $set.name = p.name
    if (p.description !== undefined) $set.description = p.description
    if (p.category !== undefined) { await ensureCategory(p.category); $set.category = p.category }
    if (p.imageUrl !== undefined) $set.image = p.imageUrl
    if (p.isActive !== undefined) $set.isActive = p.isActive
    let note
    if (p.price !== undefined) { if (Array.isArray(item.sizes) && item.sizes.length) note = 'price_skipped_has_sizes'; else $set.basePrice = p.price }
    const updated = await MenuItem.findOneAndUpdate({ _id: item._id }, { $set }, { new: true })
    await MenuItem.updateOne({ _id: item._id }, { $set: { syncedAt: updated.updatedAt } }, { timestamps: false })
    return { updated: String(item._id), updatedAt: new Date(updated.updatedAt).toISOString(), ...(note ? { note } : {}) }
  }

  /** A delete on the AYOPOS side hides the item here instead of destroying it — it can be switched back on. */
  async function applyDelete(raw) {
    const { value: p, error } = sanitiseIncomingProduct({ ...raw, updatedAt: new Date().toISOString() })
    if (error) return { rejected: error }
    const item = await findLocal(p)
    if (!item) return { ignored: 'not_found' }
    const updated = await MenuItem.findOneAndUpdate({ _id: item._id }, { $set: { isActive: false } }, { new: true })
    await MenuItem.updateOne({ _id: item._id }, { $set: { syncedAt: updated.updatedAt } }, { timestamps: false })
    return { hidden: String(item._id) }
  }

  const onItemSaved = (doc) => { if (!doc.$locals?.skipAyopos) enqueue({ kind: 'upsert', id: String(doc._id) }) }
  const onItemDeleted = (doc) => enqueue({ kind: 'delete', id: String(doc._id), ayoposId: doc.ayoposId || undefined })

  return { status, saveSettings, checkSettings, pair, disconnect, pushAll, enqueue, flush, handleWebhook, applyProduct, onItemSaved, onItemDeleted, _pending: pending }
}

module.exports = { createService, httpError }
