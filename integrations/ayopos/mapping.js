'use strict'
/**
 * The ONLY data that crosses the link. Deliberately small: what every shop/restaurant has in common.
 * Nothing about orders, customers, staff, costs or stock ever leaves this server.
 *
 *   product  : externalId, ayoposId?, name, description, price, currency, category, imageUrl, isActive, updatedAt
 *   business : name, phone, email, address, logoUrl
 *
 * Both directions pass through the sanitisers below: unknown keys are dropped, strings are trimmed and length-capped,
 * numbers are range-checked, and image URLs must be https. A malicious or buggy peer therefore cannot inject anything else.
 */
const CURRENCY = 'NGN'
const LIMITS = { name: 120, description: 2000, category: 60, imageUrl: 500, price: 1e9 }

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '')

function safeHttpsUrl(v) {
  if (typeof v !== 'string' || v.length > LIMITS.imageUrl) return ''
  try { const u = new URL(v); return u.protocol === 'https:' ? u.toString() : '' } catch { return '' }
}

/**
 * Websites store picture addresses in many shapes (Cloudinary's plain `url` is http://, admins paste relative paths…).
 * Turn any of them into the one thing AYOPOS can show: a plain https address. Identical rules to AYOPOS's normaliseImageUrl.
 *   https://…  -> as is      http://…  -> https://…      //host/x -> https://host/x      /uploads/x or uploads/x -> resolved against `base` (this website)
 * data:, javascript:, file:, credentials in the URL, spaces or over-long values become '' (nothing is sent).
 */
function normaliseImageUrl(raw, base) {
  if (typeof raw !== 'string') return ''
  const v = raw.trim()
  if (!v || v.length > LIMITS.imageUrl || /[\u0000-\u001F\u007F\s]/.test(v)) return ''
  let u
  try {
    if (/^https?:\/\//i.test(v)) u = new URL(v)
    else if (v.startsWith('//')) u = new URL(`https:${v}`)
    else if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return ''
    else { if (!base) return ''; u = new URL(v, new URL(base).origin + '/') }
  } catch { return '' }
  if (u.username || u.password) return ''
  if (u.protocol === 'http:') u.protocol = 'https:'
  if (u.protocol !== 'https:') return ''
  const out = u.toString()
  return out.length <= LIMITS.imageUrl ? out : ''
}

/** MenuItem document -> common product. Sizes/variants are intentionally not shared. */
function toCommonProduct(item, opts = {}) {
  const sizes = Array.isArray(item.sizes) ? item.sizes.map((s) => Number(s.price)).filter((n) => Number.isFinite(n) && n > 0) : []
  const price = item.basePrice > 0 ? item.basePrice : sizes.length ? Math.min(...sizes) : 0
  return {
    externalId: String(item._id),
    ...(item.ayoposId ? { ayoposId: item.ayoposId } : {}),
    name: str(item.name, LIMITS.name),
    description: str(item.description, LIMITS.description),
    price: Math.round(price * 100) / 100,
    currency: CURRENCY,
    category: str(item.category, LIMITS.category),
    imageUrl: normaliseImageUrl(item.image, opts.siteUrl),
    isActive: !!item.isActive,
    updatedAt: new Date(item.updatedAt || Date.now()).toISOString(),
  }
}

/** Untrusted incoming product -> clean object, or { error }. Only fields present in the payload are returned (partial updates are fine). */
function sanitiseIncomingProduct(p) {
  if (!p || typeof p !== 'object') return { error: 'not_an_object' }
  const out = {}
  if (p.ayoposId !== undefined) { const id = str(String(p.ayoposId), 64); if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { error: 'bad_ayopos_id' }; out.ayoposId = id }
  if (p.externalId !== undefined) { const id = str(String(p.externalId), 64); if (!/^[a-f0-9]{24}$/i.test(id)) return { error: 'bad_external_id' }; out.externalId = id.toLowerCase() }
  if (!out.ayoposId && !out.externalId) return { error: 'no_identifier' }
  if (p.name !== undefined) { out.name = str(p.name, LIMITS.name); if (!out.name) return { error: 'empty_name' } }
  if (p.description !== undefined) out.description = str(p.description, LIMITS.description)
  if (p.category !== undefined) { out.category = str(p.category, LIMITS.category); if (!out.category) return { error: 'empty_category' } }
  if (p.price !== undefined) { const n = Number(p.price); if (!Number.isFinite(n) || n < 0 || n > LIMITS.price) return { error: 'bad_price' }; out.price = Math.round(n * 100) / 100 }
  if (p.imageUrl !== undefined) out.imageUrl = normaliseImageUrl(p.imageUrl)
  if (p.isActive !== undefined) out.isActive = p.isActive === true
  const ts = Date.parse(p.updatedAt)
  if (!Number.isFinite(ts)) return { error: 'bad_updated_at' }
  out.updatedAt = new Date(ts)
  return { value: out }
}

/**
 * Should an incoming change overwrite the local record?  Pure function so the rules are easy to test and to reason about.
 *   local = { updatedAt: Date, syncedAt: Date|null }   (syncedAt = when this record last matched AYOPOS)
 */
function decideConflict({ policy, local, incomingUpdatedAt }) {
  if (!local) return { apply: true }
  const editedLocallySinceSync = !local.syncedAt || local.updatedAt > local.syncedAt
  if (!editedLocallySinceSync) return { apply: incomingUpdatedAt >= local.updatedAt ? true : false, reason: 'older_than_local' }
  if (policy === 'AYOPOS_WINS') return { apply: true }
  if (policy === 'SITE_WINS') return { apply: false, reason: 'site_wins' }
  return incomingUpdatedAt > local.updatedAt ? { apply: true } : { apply: false, reason: 'local_is_newer' } // LATEST_WINS
}

function businessFromEnv(env = process.env) {
  return {
    name: str(env.BUSINESS_NAME || 'HMS Lounge & Bar', 120), phone: str(env.BUSINESS_PHONE || '', 40), email: str(env.BUSINESS_EMAIL || '', 120),
    address: str(env.BUSINESS_ADDRESS || '', 300), logoUrl: safeHttpsUrl(env.BUSINESS_LOGO_URL || ''),
  }
}

module.exports = { normaliseImageUrl, toCommonProduct, sanitiseIncomingProduct, decideConflict, businessFromEnv, safeHttpsUrl, LIMITS, CURRENCY }
