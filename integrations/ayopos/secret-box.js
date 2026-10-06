'use strict'
/** AES-256-GCM for the signing secret at rest, so a database leak alone does not let anyone forge AYOPOS messages. */
const crypto = require('crypto')

function key() {
  const raw = process.env.INTEGRATION_ENC_KEY || process.env.JWT_SECRET
  if (!raw || raw.length < 32) throw new Error('Set INTEGRATION_ENC_KEY (32+ characters) before connecting to AYOPOS.')
  return crypto.createHash('sha256').update(raw).digest()
}
function encrypt(plain) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`
}
function decrypt(blob) {
  const [v, iv, tag, data] = String(blob).split('.')
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unreadable stored secret.')
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')
}
module.exports = { encrypt, decrypt }
