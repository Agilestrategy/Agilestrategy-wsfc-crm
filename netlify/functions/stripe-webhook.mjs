// Stripe webhook: checkout.session.completed marks the order paid; checkout.session.expired cancels it.
// Register https://<site>/.netlify/functions/stripe-webhook in the Stripe dashboard (Developers > Webhooks) for those two events
// and put the signing secret in STRIPE_WEBHOOK_SECRET. Env also: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

export default async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return new Response('not configured', { status: 500 })
  const stripe = new Stripe(STRIPE_SECRET_KEY)
  const body = await req.text()
  let event
  try { event = stripe.webhooks.constructEvent(body, req.headers.get('stripe-signature') || '', STRIPE_WEBHOOK_SECRET) }
  catch (e) { return new Response('bad signature: ' + e.message, { status: 400 }) }
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const s = event.data.object
    const orderId = s.metadata?.order_id
    if (orderId && s.payment_status === 'paid') {
      const { data: o } = await db.from('shop_orders').select('id, status, member_id, order_number').eq('id', orderId).maybeSingle()
      if (o && o.status === 'awaiting_payment') {
        await db.from('shop_orders').update({ status: 'paid', financial_status: 'paid', paid_at: new Date().toISOString(), stripe_payment_intent: typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id || null, stripe_session_id: s.id }).eq('id', o.id)
        if (o.member_id) await db.from('notifications').insert({ title: 'Thanks, your merch order is in', body: `Order ${o.order_number} is paid and goes into the next Friday production run. We will let you know when it is at the club.`, url: '/me/orders', audience: { member_ids: [o.member_id] }, created_by: 'merch' })
      }
    }
  } else if (event.type === 'checkout.session.expired') {
    const orderId = event.data.object.metadata?.order_id
    if (orderId) await db.from('shop_orders').update({ status: 'cancelled', note: 'Checkout expired without payment' }).eq('id', orderId).eq('status', 'awaiting_payment')
  }
  return new Response('ok')
}
