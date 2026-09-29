// Shopify webhook receiver: orders/create, orders/updated, orders/cancelled, products/update.
// Register in the store's custom app (Webhooks tab) pointing at https://<site>/.netlify/functions/shopify-webhook
// Verified with SHOPIFY_WEBHOOK_SECRET (HMAC SHA256 of the raw body, base64).
import crypto from 'node:crypto'
import { env, sb, gql, upsertOrder, syncProducts } from '../lib/shopify.mjs'

const ORDER_BY_ID = `query($id: ID!) { order(id: $id) { id name createdAt updatedAt email phone cancelledAt
  displayFinancialStatus displayFulfillmentStatus note
  customer { firstName lastName email phone } shippingAddress { name phone }
  subtotalPriceSet { shopMoney { amount currencyCode } } totalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 100) { nodes { id title quantity sku variantTitle originalUnitPriceSet { shopMoney { amount } } product { id } variant { id } } } } }`

export default async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET
  const body = await req.text()
  if (secret) {
    const given = req.headers.get('x-shopify-hmac-sha256') || ''
    const digest = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')
    const ok = given.length === digest.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(digest))
    if (!ok) return new Response('bad signature', { status: 401 })
  }
  if (env().missing.length) return new Response('not configured', { status: 500 })
  const topic = req.headers.get('x-shopify-topic') || ''
  const payload = JSON.parse(body || '{}')
  const db = sb()
  try {
    if (topic.startsWith('orders/')) {
      // Re-read through GraphQL so the shape matches the scheduled sync exactly.
      const d = await gql(ORDER_BY_ID, { id: payload.admin_graphql_api_id || `gid://shopify/Order/${payload.id}` })
      if (d.order) await upsertOrder(db, d.order)
      await db.from('shop_sync_log').insert({ source: 'webhook:' + topic, orders_upserted: d.order ? 1 : 0 })
    } else if (topic.startsWith('products/')) {
      const n = await syncProducts(db)
      await db.from('shop_sync_log').insert({ source: 'webhook:' + topic, products_upserted: n })
    }
    return new Response('ok')
  } catch (err) {
    await db.from('shop_sync_log').insert({ source: 'webhook:' + topic, error: String(err.message || err) })
    return new Response('error', { status: 500 })
  }
}
