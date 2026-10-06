'use strict'
const { signRequest } = require('./signing')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * POST JSON to AYOPOS. Safety choices: HTTPS only outside local dev, no redirects (a redirect could carry the signature
 * to another host), 10s timeout, and a few retries with backoff for network errors / 5xx / 429.
 */
async function postJson(url, body, { secret, connectionId, source = 'site', attempts = 3, fetchImpl = fetch } = {}) {
  const u = new URL(url)
  const local = ['localhost', '127.0.0.1'].includes(u.hostname)
  if (u.protocol !== 'https:' && !(local && process.env.NODE_ENV !== 'production')) throw Object.assign(new Error('AYOPOS address must use https.'), { status: 0 })
  const rawBody = Buffer.from(JSON.stringify(body))
  let last
  for (let i = 0; i < attempts; i++) {
    try {
      const headers = secret ? signRequest(secret, { source, rawBody, connectionId }) : { 'content-type': 'application/json' }
      const res = await fetchImpl(url, { method: 'POST', headers, body: rawBody, redirect: 'error', signal: AbortSignal.timeout(10000) })
      const text = await res.text()
      let json = null; try { json = text ? JSON.parse(text) : null } catch { /* non-JSON */ }
      if (res.ok) return json ?? {}
      last = Object.assign(new Error(json?.error?.message || json?.message || `AYOPOS answered ${res.status}`), { status: res.status, code: json?.error?.code })
      if (res.status < 500 && res.status !== 429) throw last // client errors will not improve on retry
    } catch (e) {
      last = e
      if (e.status && e.status < 500 && e.status !== 429) throw e
    }
    if (i < attempts - 1) await sleep(500 * 2 ** i)
  }
  throw last
}

module.exports = { postJson }
