'use strict'
/**
 * Connection settings the website's top admin enters on the AYOPOS page (no server access needed).
 * Stored on the AyoposConnection document; the old environment variables remain a fallback so existing set-ups keep working.
 *
 *   apiBase      : the AYOPOS API address shown in AYOPOS when creating a pairing code (…/api/v1)
 *   publicApiUrl : the public https address of THIS website's API (AYOPOS sends signed updates here)
 *   siteUrl      : the public address of the website itself (optional)
 *   autoPublish  : products created in AYOPOS go live immediately instead of arriving hidden
 *   business     : name / phone / email / address / logo shared with AYOPOS
 */
const net = require('net')
const { safeHttpsUrl, LIMITS } = require('./mapping')

const blocked = new net.BlockList()
for (const [n, b] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(n, b, 'ipv4')
for (const [n, b] of [['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) blocked.addSubnet(n, b, 'ipv6')
blocked.addAddress('::1', 'ipv6')

const httpError = (status, message) => Object.assign(new Error(message), { status })
const devMode = () => process.env.NODE_ENV !== 'production'
const isLocalHost = (h) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(h)

function isPrivateHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  const f = net.isIP(h)
  if (f) return blocked.check(h, f === 4 ? 'ipv4' : 'ipv6')
  return !h.includes('.')
}

/** Friendly URL cleaner: adds https:// if missing, trims slashes, refuses credentials/query strings and private addresses. */
function cleanUrl(raw, label, { required = true, appendApiV1 = false, standardPort = false } = {}) {
  let v = String(raw ?? '').trim()
  if (!v) { if (required) throw httpError(400, `${label} is required.`); return '' }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`
  let u
  try { u = new URL(v) } catch { throw httpError(400, `${label} is not a valid web address.`) }
  if (u.username || u.password) throw httpError(400, `${label} must not contain a username or password.`)
  if (u.search || u.hash) throw httpError(400, `${label} must not contain “?” or “#”.`)
  const local = isLocalHost(u.hostname)
  const devLocal = devMode() && local
  if (u.protocol !== 'https:' && !devLocal) throw httpError(400, `${label} must start with https://`)
  if (!devLocal && isPrivateHost(u.hostname)) throw httpError(400, `${label} must be a public address (not localhost or a private network).`)
  if (standardPort && !devLocal && u.port && u.port !== '443') throw httpError(400, `${label} must use the standard https port — AYOPOS can only send updates to port 443.`)
  let path = u.pathname.replace(/\/+$/, '')
  if (appendApiV1 && path === '') path = '/api/v1'
  return `${u.origin}${path}`
}

const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '')

function normaliseSettings(input) {
  const i = input && typeof input === 'object' ? input : {}
  const b = i.business && typeof i.business === 'object' ? i.business : {}
  const email = text(b.email, 120)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'The business email is not valid.')
  const logoRaw = text(b.logoUrl, LIMITS.imageUrl)
  const logoUrl = logoRaw ? safeHttpsUrl(logoRaw) : ''
  if (logoRaw && !logoUrl) throw httpError(400, 'The logo address must start with https://')
  return {
    apiBase: cleanUrl(i.apiBase, 'The AYOPOS API address', { appendApiV1: true }),
    publicApiUrl: cleanUrl(i.publicApiUrl, "This website's API address", { standardPort: true }),
    siteUrl: cleanUrl(i.siteUrl, 'The website address', { required: false }),
    autoPublish: i.autoPublish === true,
    business: { name: text(b.name, 120), phone: text(b.phone, 40), email, address: text(b.address, 300), logoUrl },
  }
}

/** Saved settings win; anything left blank falls back to the server's environment variables. */
function effectiveSettings(config, env = process.env) {
  const c = config && typeof config === 'object' ? config : {}
  const cb = c.business && typeof c.business === 'object' ? c.business : {}
  const pick = (a, b) => (a !== undefined && a !== null && a !== '' ? a : b || '')
  return {
    apiBase: pick(c.apiBase, env.AYOPOS_API_BASE ? env.AYOPOS_API_BASE.replace(/\/+$/, '') : ''),
    publicApiUrl: pick(c.publicApiUrl, env.PUBLIC_API_URL ? env.PUBLIC_API_URL.replace(/\/+$/, '') : ''),
    siteUrl: pick(c.siteUrl, env.SITE_URL),
    autoPublish: typeof c.autoPublish === 'boolean' ? c.autoPublish : env.AYOPOS_AUTO_PUBLISH === 'true',
    business: {
      name: pick(cb.name, env.BUSINESS_NAME || 'HMS Lounge & Bar'), phone: pick(cb.phone, env.BUSINESS_PHONE), email: pick(cb.email, env.BUSINESS_EMAIL),
      address: pick(cb.address, env.BUSINESS_ADDRESS), logoUrl: pick(cb.logoUrl, env.BUSINESS_LOGO_URL),
    },
  }
}

module.exports = { normaliseSettings, effectiveSettings, cleanUrl, isPrivateHost }
