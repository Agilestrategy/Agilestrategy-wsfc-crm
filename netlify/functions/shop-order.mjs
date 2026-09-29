// Member app checkout. POST { items: [{product_id, quantity, options: {Size:"L", Colour:"Black"}}], pay: "stripe" | "at_club", note }
// Header: Authorization: Bearer <supabase access token> (the signed in member).
// Prices are taken from the database, never from the client. Returns { order_id, order_number, url? }.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY (optional: without it, only pay at club is offered), SITE_URL (optional).
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return json({ error: 'Server not configured' }, 500)
  const token = (req.headers.get('authorization') || '').replace(/^Bearer /i, '')
  if (!token) return json({ error: 'Please sign in' }, 401)
  const db = createClient(url, key, { auth: { persistSession: false } })
  const { data: { user }, error: uerr } = await db.auth.getUser(token)
  if (uerr || !user) return json({ error: 'Please sign in again' }, 401)

  let body; try { body = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  const items = Array.isArray(body.items) ? body.items.filter((i) => i?.product_id && Number(i.quantity) > 0) : []
  if (!items.length) return json({ error: 'Your cart is empty' }, 400)
  const pay = body.pay === 'stripe' ? 'stripe' : 'at_club'
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (pay === 'stripe' && !stripeKey) return json({ error: 'Online payment is not switched on yet. Choose pay at the club.' }, 400)

  // Member record (household primary first), same rule as the app.
  const { data: member } = await db.from('members').select('id, first_name, last_name, email, phone, mobile, status_tier')
    .or(`auth_user_id.eq.${user.id},email.ilike.${user.email}`).order('is_household_primary', { ascending: false }).limit(1).maybeSingle()

  // Price every line from the catalogue.
  const ids = [...new Set(items.map((i) => i.product_id))]
  const { data: products, error: perr } = await db.from('shop_products').select('id, title, retail_price, options, is_active, status, supplier_code, min_tier').in('id', ids)
  if (perr) return json({ error: perr.message }, 500)
  // Tier rules: Gold and Black discounts from shop_settings, min_tier gating. Same as src/lib/pricing.js on the phone.
  const { data: settings } = await db.from('shop_settings').select('discount_gold, discount_black').eq('id', 1).maybeSingle()
  const RANK = { silver: 1, gold: 2, black: 3 }
  const tier = member?.status_tier || null
  const discount = tier === 'black' ? Number(settings?.discount_black ?? 25) : tier === 'gold' ? Number(settings?.discount_gold ?? 10) : 0
  const memberPrice = (list) => Math.round(Number(list) * (1 - discount / 100) * 100) / 100
  const pmap = Object.fromEntries((products || []).map((p) => [p.id, p]))
  const lines = []
  for (const it of items) {
    const p = pmap[it.product_id]
    if (!p || !p.is_active || (p.status && p.status !== 'active') || p.retail_price == null) return json({ error: `${p?.title || 'An item'} is not available` }, 400)
    if (p.min_tier && (RANK[tier] || 0) < (RANK[p.min_tier] || 0)) return json({ error: `${p.title} is for ${p.min_tier[0].toUpperCase() + p.min_tier.slice(1)} members` }, 400)
    const opts = it.options && typeof it.options === 'object' ? it.options : {}
    for (const [k, allowed] of Object.entries(p.options || {})) {
      if (Array.isArray(allowed) && allowed.length && !allowed.includes(opts[k])) return json({ error: `Choose a ${k.toLowerCase()} for ${p.title}` }, 400)
    }
    const variant = Object.keys(p.options || {}).map((k) => opts[k]).filter(Boolean).join(' / ') || null
    lines.push({ product: p, quantity: Math.max(1, Math.min(20, Math.floor(Number(it.quantity)))), variant, list: Number(p.retail_price), price: memberPrice(p.retail_price) })
  }
  const listTotal = lines.reduce((a, l) => a + l.list * l.quantity, 0)
  const total = Math.round(lines.reduce((a, l) => a + l.price * l.quantity, 0) * 100) / 100
  const discountAmount = Math.round((listTotal - total) * 100) / 100
  const name = member ? [member.first_name, member.last_name].filter(Boolean).join(' ') : (user.user_metadata?.full_name || null)

  // Create the order first (awaiting_payment), then the Stripe session if requested.
  const { data: num } = await db.rpc('shop_next_order_number')
  const { data: order, error: oerr } = await db.from('shop_orders').insert({
    order_number: num, shopify_created_at: new Date().toISOString(), email: user.email, phone: member?.mobile || member?.phone || null,
    customer_name: name, member_id: member?.id || null, financial_status: 'unpaid', subtotal: total, total, currency: 'NZD',
    status: 'awaiting_payment', payment_method: pay, note: (body.note || '').slice(0, 500) || null,
    member_tier: tier, discount_pct: discount, discount_amount: discountAmount,
  }).select('id, order_number').single()
  if (oerr) return json({ error: oerr.message }, 500)
  const { error: ierr } = await db.from('shop_order_items').insert(lines.map((l) => ({
    order_id: order.id, product_id: l.product.id, title: l.product.title, variant_title: l.variant, sku: l.product.supplier_code, quantity: l.quantity, price: l.price, list_price: l.list,
  })))
  if (ierr) return json({ error: ierr.message }, 500)

  if (pay === 'at_club') {
    return json({ order_id: order.id, order_number: order.order_number, total })
  }

  const site = process.env.SITE_URL || new URL(req.url).origin
  const stripe = new Stripe(stripeKey)
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email,
    line_items: lines.map((l) => ({
      quantity: l.quantity,
      price_data: { currency: 'nzd', unit_amount: Math.round(l.price * 100), product_data: { name: l.product.title + (l.variant ? ` (${l.variant})` : '') + (discount ? ` · ${tier} member ${discount}% off` : ''), metadata: { product_id: l.product.id } } },
    })),
    metadata: { order_id: order.id, order_number: order.order_number, member_id: member?.id || '' },
    payment_intent_data: { description: `WSFC merch ${order.order_number}`, metadata: { order_id: order.id } },
    success_url: `${site}/me/orders?paid=${order.id}`,
    cancel_url: `${site}/me/shop?cancelled=${order.id}`,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
  })
  await db.from('shop_orders').update({ stripe_session_id: session.id }).eq('id', order.id)
  return json({ order_id: order.id, order_number: order.order_number, total, url: session.url })
}
