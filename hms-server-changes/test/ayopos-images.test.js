'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
process.env.INTEGRATION_ENC_KEY = 'x'.repeat(48)
const { normaliseImageUrl, toCommonProduct } = require('../integrations/ayopos/mapping')
const { createService } = require('../integrations/ayopos/service')

const BASE = 'https://hms-lounge.com'
test('every shape of picture address a menu item can hold ends up as plain https (or nothing)', () => {
  const cases = [
    ['https://res.cloudinary.com/demo/image/upload/v1/a.jpg', undefined, 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg'],
    // what the HMS dashboard stores today: Cloudinary's plain `url`
    ['http://res.cloudinary.com/demo/image/upload/v1/hms-lounge/menu/a.jpg', undefined, 'https://res.cloudinary.com/demo/image/upload/v1/hms-lounge/menu/a.jpg'],
    ['//cdn.example.com/a.jpg', undefined, 'https://cdn.example.com/a.jpg'],
    ['/uploads/a.jpg', BASE, 'https://hms-lounge.com/uploads/a.jpg'],
    ['uploads/a.jpg', BASE, 'https://hms-lounge.com/uploads/a.jpg'],
    ['/uploads/a.jpg', undefined, ''],
    ['https://cdn.example.com/a.jpg?w=400&sig=abc', undefined, 'https://cdn.example.com/a.jpg?w=400&sig=abc'],
    ['https://cdn.example.com/my pic.jpg', undefined, ''],
    ['javascript:alert(1)', BASE, ''], ['data:image/png;base64,AAAA', BASE, ''], ['file:///etc/passwd', BASE, ''],
    ['https://user:pw@cdn.example.com/a.jpg', undefined, ''], ['https://x.com/' + 'a'.repeat(600), undefined, ''], ['', BASE, ''], [undefined, BASE, ''], [5, BASE, ''],
  ]
  for (const [raw, base, expected] of cases) assert.equal(normaliseImageUrl(raw, base), expected, String(raw))
})

test('the common product carries the normalised picture, resolving relative paths against this website', () => {
  const item = (image) => ({ _id: 'a'.repeat(24), name: 'X', basePrice: 100, category: 'c', isActive: true, updatedAt: new Date(), image })
  assert.equal(toCommonProduct(item('http://res.cloudinary.com/demo/a.jpg')).imageUrl, 'https://res.cloudinary.com/demo/a.jpg')
  assert.equal(toCommonProduct(item('/uploads/a.jpg'), { siteUrl: BASE }).imageUrl, 'https://hms-lounge.com/uploads/a.jpg')
  assert.equal(toCommonProduct(item('/uploads/a.jpg')).imageUrl, '')
})

test('pushing sends the pictures, resolved with the website address saved on the AYOPOS page', async () => {
  const sent = []
  const items = [{ _id: 'a'.repeat(24), name: 'Pizza', basePrice: 5000, category: 'Mains', isActive: true, updatedAt: new Date(), image: 'http://res.cloudinary.com/demo/pizza.jpg' },
                 { _id: 'b'.repeat(24), name: 'Suya', basePrice: 2500, category: 'Grill', isActive: true, updatedAt: new Date(), image: '/uploads/suya.jpg' }]
  const MenuItem = { find: () => { const q = { sort: () => q, then: (a, b) => Promise.resolve(items).then(a, b) }; return q }, updateOne: async () => {} }
  const conn = { status: 'ACTIVE', direction: 'TWO_WAY', conflictPolicy: 'LATEST_WINS', connectionId: 'c1', secretEnc: require('../integrations/ayopos/secret-box').encrypt('s'.repeat(43)), ayoposApiBase: 'https://api.ayopos.test/api/v1', config: { siteUrl: BASE } }
  const svc = createService({ repo: { get: async () => ({ ...conn }), update: async () => {} }, MenuItem, Category: {}, Processed: {}, env: {}, http: async (url, body) => { sent.push(body); return { mappings: [] } }, log: console })
  await svc.pushAll()
  assert.deepEqual(sent[0].products.map((p) => p.imageUrl), ['https://res.cloudinary.com/demo/pizza.jpg', 'https://hms-lounge.com/uploads/suya.jpg'])
})
