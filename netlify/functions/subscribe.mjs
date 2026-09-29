// Membership subscriptions. POST with Authorization: Bearer <supabase access token>.
//   { action: "checkout", category_id, frequency }  -> { url }  Stripe Checkout in subscription mode, priced from the database
//   { action: "portal" }                            -> { url }  Stripe customer portal (change card, cancel, see invoices)
//   { action: "quote", category_id, frequency }     -> the membership_price() result, no Stripe call
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, SITE_URL (optional),
//      STRIPE_PAYMENT_METHODS (optional, comma list, default "card"; add "nz_bank_account" once bank debit is enabled in Stripe).
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

  const { data: member } = await db.from('members').select('id, first_name, last_name, email, mobile, category_id, financial_until')
    .or(`auth_user_id.eq.${user.id},email.ilike.${user.email}`).order('is_household_primary', { ascending: false }).limit(1).maybeSingle()
  if (!member) return json({ error: 'No membership record is linked to this sign in' }, 404)

  if (body.action === 'quote') {
    const { data, error } = await db.rpc('membership_price', { p_category: body.category_id, p_frequency: body.frequency })
    return error ? json({ error: error.message }, 400) : json(data)
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return json({ error: 'Online payment is not switched on yet. Renew at the bar or the office.' }, 400)
  const stripe = new Stripe(stripeKey)
  const site = process.env.SITE_URL || new URL(req.url).origin
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ') || null

  // One Stripe customer per member, remembered on their latest subscription row.
  const { data: existing } = await db.from('member_subscriptions').select('id, status, stripe_customer_id, stripe_subscription_id').eq('member_id', member.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  let customerId = existing?.stripe_customer_id
  if (!customerId) {
    const c = await stripe.customers.create({ email: user.email, name, phone: member.mobile || undefined, metadata: { member_id: member.id } })
    customerId = c.id
  }

  if (body.action === 'portal') {
    const s = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${site}/me/membership` })
    return json({ url: s.url })
  }

  if (body.action !== 'checkout') return json({ error: 'Unknown action' }, 400)
  if (existing && existing.status === 'active' && existing.stripe_subscription_id) return json({ error: 'You already have a subscription running. Use Manage my subscription to change it.' }, 400)

  const { data: price, error: perr } = await db.rpc('membership_price', { p_category: body.category_id, p_frequency: body.frequency })
  if (perr || !price || price.annual_fee == null) return json({ error: 'That membership type has no fee set yet. Ask the office.' }, 400)

  const { data: row, error: rerr } = await db.from('member_subscriptions').insert({
    member_id: member.id, category_id: body.category_id, frequency: price.frequency, annual_fee: price.annual_fee, premium_pct: price.premium_pct,
    instalment: price.instalment, status: 'incomplete', stripe_customer_id: customerId,
  }).select('id').single()
  if (rerr) return json({ error: rerr.message }, 500)

  const methods = (process.env.STRIPE_PAYMENT_METHODS || 'card').split(',').map((s) => s.trim()).filter(Boolean)
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    payment_method_types: methods,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'nzd', unit_amount: Math.round(price.instalment * 100),
        recurring: { interval: price.stripe_interval, interval_count: price.stripe_interval_count },
        product_data: { name: `WSFC ${price.category} membership, ${price.label.toLowerCase()}`, metadata: { category_id: body.category_id, frequency: price.frequency } },
      },
    }],
    subscription_data: { metadata: { sub_row: row.id, member_id: member.id, frequency: price.frequency }, description: `WSFC ${price.category} membership` },
    metadata: { sub_row: row.id, member_id: member.id },
    success_url: `${site}/me/membership?subscribed=${row.id}`,
    cancel_url: `${site}/me/membership?cancelled=1`,
    allow_promotion_codes: false,
  })
  await db.from('member_subscriptions').update({ stripe_checkout_session: session.id }).eq('id', row.id)
  return json({ url: session.url, quote: price })
}
