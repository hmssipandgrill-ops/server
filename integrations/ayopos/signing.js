'use strict'
/**
 * Request signing shared by both directions of the AYOPOS <-> website link.
 *
 *   signature = HMAC-SHA256(secret, `${timestamp}.${eventId}.${source}.${rawBody}`)
 *
 * - timestamp  : unix seconds. Rejected outside ±5 minutes, so a captured request is only replayable briefly...
 * - eventId    : UUID. Stored by the receiver; a repeated id is rejected, so it is not replayable at all.
 * - source     : 'site' | 'ayopos'. Part of the signed text, so a request the website sent to AYOPOS can never be
 *                reflected back at the website's own webhook (or vice-versa) and be accepted.
 * - rawBody    : the exact bytes received (never re-serialised JSON).
 */
const crypto = require('crypto')

const TOLERANCE_SECONDS = 300
const HEADERS = { timestamp: 'x-ayopos-timestamp', eventId: 'x-ayopos-event-id', signature: 'x-ayopos-signature', source: 'x-ayopos-source', connection: 'x-ayopos-connection' }

function computeSignature(secret, { timestamp, eventId, source, rawBody }) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${eventId}.${source}.`).update(rawBody).digest('hex')
}

/** Headers to attach to an outgoing request. */
function signRequest(secret, { eventId = crypto.randomUUID(), source, rawBody, connectionId, now = Date.now() }) {
  const timestamp = String(Math.floor(now / 1000))
  const sig = computeSignature(secret, { timestamp, eventId, source, rawBody })
  return {
    'content-type': 'application/json',
    [HEADERS.timestamp]: timestamp, [HEADERS.eventId]: eventId, [HEADERS.source]: source,
    [HEADERS.signature]: `v1=${sig}`, ...(connectionId ? { [HEADERS.connection]: connectionId } : {}),
  }
}

/**
 * Verifies an incoming request. Returns { ok: true, eventId } or { ok: false, reason }.
 * `reason` is for server logs only — never echo it to the caller beyond a generic 401.
 */
function verifyRequest(secret, headers, rawBody, { expectedSource, now = Date.now() } = {}) {
  const h = (k) => { const v = headers[k]; return Array.isArray(v) ? v[0] : v }
  const timestamp = h(HEADERS.timestamp), eventId = h(HEADERS.eventId), source = h(HEADERS.source), header = h(HEADERS.signature)
  if (!timestamp || !eventId || !source || !header) return { ok: false, reason: 'missing_headers' }
  if (!/^\d{9,12}$/.test(timestamp)) return { ok: false, reason: 'bad_timestamp' }
  if (!/^[A-Za-z0-9-]{8,64}$/.test(eventId)) return { ok: false, reason: 'bad_event_id' }
  if (expectedSource && source !== expectedSource) return { ok: false, reason: 'wrong_source' }
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return { ok: false, reason: 'stale_timestamp' }
  if (!Buffer.isBuffer(rawBody)) return { ok: false, reason: 'no_raw_body' }
  const m = /^v1=([0-9a-f]{64})$/.exec(header)
  if (!m) return { ok: false, reason: 'bad_signature_format' }
  const expected = Buffer.from(computeSignature(secret, { timestamp, eventId, source, rawBody }), 'hex')
  const given = Buffer.from(m[1], 'hex')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: 'bad_signature' }
  return { ok: true, eventId }
}

module.exports = { signRequest, verifyRequest, computeSignature, HEADERS, TOLERANCE_SECONDS }
