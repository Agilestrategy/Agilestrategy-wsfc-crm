// Shared Shopify Admin API (GraphQL) sync used by the scheduled, manual and webhook functions.
// Env (Netlify, server-side only):
//   SHOPIFY_STORE_DOMAIN   e.g. wsfc-merch.myshopify.com
//   SHOPIFY_ADMIN_TOKEN    Admin API access token from the store's custom app (scopes: read_products, read_orders, read_customers)
//   SHOPIFY_WEBHOOK_SECRET signing secret shown on the custom app's Webhooks tab (webhook function only)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js'

export const API_VERSION = '2025-07'

export function env() {
  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  const missing = Object.entries({ SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }).filter(([, v]) => !v).map(([k]) => k)
  return { SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, missing }
}

export function sb() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env()
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

export async function gql(query, variables = {}) {
  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN } = env()
  const res = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`)
  const json = await res.json()
  if (json.errors?.length) throw new Error('Shopify: ' + json.errors.map((e) => e.message).join('; '))
  return json.data
}

const gid = (s) => (s ? Number(String(s).split('/').pop()) : null)

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
const PRODUCTS_Q = `query($cursor: String) {
  products(first: 50, after: $cursor, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes { id title handle productType vendor status updatedAt
      featuredMedia { preview { image { url } } }
      variants(first: 100) { nodes { id title sku price inventoryQuantity } } }
  } }`

export async function syncProducts(db) {
  let cursor = null, n = 0
  do {
    const d = await gql(PRODUCTS_Q, { cursor })
    for (const p of d.products.nodes) {
      const row = {
        shopify_product_id: gid(p.id), title: p.title, handle: p.handle, product_type: p.productType, vendor: p.vendor,
        status: (p.status || '').toLowerCase(), image_url: p.featuredMedia?.preview?.image?.url || null, updated_at: new Date().toISOString(),
      }
      const { data: prod, error } = await db.from('shop_products').upsert(row, { onConflict: 'shopify_product_id' }).select('id').single()
      if (error) throw error
      const variants = p.variants.nodes.map((v) => ({
        shopify_variant_id: gid(v.id), product_id: prod.id, title: v.title, sku: v.sku, price: v.price, inventory_quantity: v.inventoryQuantity, updated_at: new Date().toISOString(),
      }))
      if (variants.length) { const { error: e2 } = await db.from('shop_variants').upsert(variants, { onConflict: 'shopify_variant_id' }); if (e2) throw e2 }
      n++
    }
    cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null
  } while (cursor)
  await db.from('shop_settings').update({ last_product_sync_at: new Date().toISOString() }).eq('id', 1)
  return n
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
const ORDER_FIELDS = `id name createdAt updatedAt email phone cancelledAt
  displayFinancialStatus displayFulfillmentStatus note
  customer { firstName lastName email phone }
  shippingAddress { name phone }
  subtotalPriceSet { shopMoney { amount currencyCode } }
  totalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 100) { nodes { id title quantity sku variantTitle
    originalUnitPriceSet { shopMoney { amount } }
    product { id } variant { id } } }`

const ORDERS_Q = `query($cursor: String, $q: String) {
  orders(first: 50, after: $cursor, query: $q, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes { ${ORDER_FIELDS} } } }`

export async function upsertOrder(db, o) {
  const cust = o.customer || {}
  const name = [cust.firstName, cust.lastName].filter(Boolean).join(' ') || o.shippingAddress?.name || null
  const fin = (o.displayFinancialStatus || '').toLowerCase()
  const row = {
    shopify_order_id: gid(o.id), order_number: o.name, shopify_created_at: o.createdAt, shopify_updated_at: o.updatedAt,
    email: o.email || cust.email || null, phone: o.phone || cust.phone || o.shippingAddress?.phone || null, customer_name: name,
    financial_status: fin, fulfillment_status: (o.displayFulfillmentStatus || '').toLowerCase() || null,
    subtotal: o.subtotalPriceSet?.shopMoney?.amount, total: o.totalPriceSet?.shopMoney?.amount, currency: o.totalPriceSet?.shopMoney?.currencyCode || 'NZD',
    note: o.note || null, raw: o, synced_at: new Date().toISOString(),
  }
  // Existing orders keep their club status, except a Shopify cancellation or refund which cancels them.
  const { data: existing } = await db.from('shop_orders').select('id, status').eq('shopify_order_id', row.shopify_order_id).maybeSingle()
  if (o.cancelledAt || fin === 'refunded' || fin === 'voided') row.status = 'cancelled'
  else if (!existing) row.status = 'paid'
  const { data: ord, error } = await db.from('shop_orders').upsert(row, { onConflict: 'shopify_order_id' }).select('id').single()
  if (error) throw error

  // Resolve product / variant ids from the mirror.
  const pids = [...new Set(o.lineItems.nodes.map((l) => gid(l.product?.id)).filter(Boolean))]
  const vids = [...new Set(o.lineItems.nodes.map((l) => gid(l.variant?.id)).filter(Boolean))]
  const { data: prods } = pids.length ? await db.from('shop_products').select('id, shopify_product_id').in('shopify_product_id', pids) : { data: [] }
  const { data: vars } = vids.length ? await db.from('shop_variants').select('id, shopify_variant_id').in('shopify_variant_id', vids) : { data: [] }
  const pmap = Object.fromEntries((prods || []).map((p) => [p.shopify_product_id, p.id]))
  const vmap = Object.fromEntries((vars || []).map((v) => [v.shopify_variant_id, v.id]))
  const lines = o.lineItems.nodes.map((l) => ({
    order_id: ord.id, shopify_line_id: gid(l.id), shopify_product_id: gid(l.product?.id), shopify_variant_id: gid(l.variant?.id),
    product_id: pmap[gid(l.product?.id)] || null, variant_id: vmap[gid(l.variant?.id)] || null,
    title: l.title, variant_title: l.variantTitle, sku: l.sku, quantity: l.quantity, price: l.originalUnitPriceSet?.shopMoney?.amount,
  }))
  if (lines.length) { const { error: e2 } = await db.from('shop_order_items').upsert(lines, { onConflict: 'shopify_line_id' }); if (e2) throw e2 }
  return ord.id
}

export async function syncOrders(db, { full = false } = {}) {
  const { data: s } = await db.from('shop_settings').select('last_order_sync_at').eq('id', 1).single()
  const since = !full && s?.last_order_sync_at ? new Date(new Date(s.last_order_sync_at).getTime() - 10 * 60e3).toISOString() : null
  const q = since ? `updated_at:>='${since}'` : null
  let cursor = null, n = 0
  const started = new Date().toISOString()
  do {
    const d = await gql(ORDERS_Q, { cursor, q })
    for (const o of d.orders.nodes) { await upsertOrder(db, o); n++ }
    cursor = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null
  } while (cursor)
  await db.from('shop_settings').update({ last_order_sync_at: started, last_sync_error: null }).eq('id', 1)
  return n
}

export async function runSync(source, opts = {}) {
  const e = env()
  if (e.missing.length) return { ok: false, error: 'Missing env: ' + e.missing.join(', ') }
  const db = sb()
  try {
    const products = await syncProducts(db)
    const orders = await syncOrders(db, opts)
    await db.from('shop_sync_log').insert({ source, products_upserted: products, orders_upserted: orders })
    return { ok: true, products, orders }
  } catch (err) {
    await db.from('shop_sync_log').insert({ source, error: String(err.message || err) })
    await db.from('shop_settings').update({ last_sync_error: String(err.message || err) }).eq('id', 1)
    return { ok: false, error: String(err.message || err) }
  }
}
