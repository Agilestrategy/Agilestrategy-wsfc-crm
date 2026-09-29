// Stripe webhook. Merch: checkout.session.completed marks the order paid; checkout.session.expired cancels it.
// Subscriptions: checkout.session.completed (mode subscription) links the Stripe subscription, invoice.paid extends the member's
// financial_until, invoice.payment_failed flags past_due, customer.subscription.updated/deleted mirror status.
// Register https://<site>/.netlify/functions/stripe-webhook in the Stripe dashboard (Developers > Webhooks) for those events
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

  const subStatus = (st) => ({ active: 'active', trialing: 'active', past_due: 'past_due', unpaid: 'past_due', paused: 'paused', canceled: 'cancelled', incomplete: 'incomplete', incomplete_expired: 'cancelled' }[st] || 'incomplete')

  if (event.type === 'checkout.session.completed' && event.data.object.mode === 'subscription') {
    const s = event.data.object; const rowId = s.metadata?.sub_row
    if (rowId) {
      const subId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id
      const sub = subId ? await stripe.subscriptions.retrieve(subId) : null
      const periodEnd = sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null
      await db.from('member_subscriptions').update({ stripe_subscription_id: subId, stripe_customer_id: typeof s.customer === 'string' ? s.customer : s.customer?.id, status: sub ? subStatus(sub.status) : 'active', current_period_end: periodEnd, started_at: new Date().toISOString() }).eq('id', rowId)
      if (sub && sub.status === 'active' && periodEnd) await db.rpc('subscription_paid', { p_sub: rowId, p_period_end: periodEnd, p_amount: (s.amount_total || 0) / 100 })
      const { data: row } = await db.from('member_subscriptions').select('member_id, frequency').eq('id', rowId).maybeSingle()
      if (row?.member_id) await db.from('notifications').insert({ title: 'Your membership is set up', body: `Thanks, your ${row.frequency.replace('_', ' ')} membership payments are running. You are all set for the year ahead.`, url: '/me/membership', audience: { member_ids: [row.member_id] }, created_by: 'subscriptions' })
    }
  } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
    const inv = event.data.object
    const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id || inv.parent?.subscription_details?.subscription
    if (subId) {
      const { data: row } = await db.from('member_subscriptions').select('id').eq('stripe_subscription_id', subId).maybeSingle()
      const line = inv.lines?.data?.[0]; const end = line?.period?.end
      if (row && end) await db.rpc('subscription_paid', { p_sub: row.id, p_period_end: new Date(end * 1000).toISOString(), p_amount: (inv.amount_paid || 0) / 100 })
    }
  } else if (event.type === 'invoice.payment_failed') {
    const inv = event.data.object
    const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id || inv.parent?.subscription_details?.subscription
    if (subId) {
      const { data: row } = await db.from('member_subscriptions').select('id, member_id').eq('stripe_subscription_id', subId).maybeSingle()
      if (row) {
        await db.from('member_subscriptions').update({ status: 'past_due' }).eq('id', row.id)
        await db.from('notifications').insert({ title: 'Membership payment did not go through', body: 'Your latest membership instalment failed. Open the app to update your card or bank details.', url: '/me/membership', audience: { member_ids: [row.member_id] }, created_by: 'subscriptions' })
      }
    }
  } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object
    const patch = { status: event.type.endsWith('deleted') ? 'cancelled' : subStatus(sub.status), cancel_at_period_end: !!sub.cancel_at_period_end,
      current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null }
    if (patch.status === 'cancelled') patch.cancelled_at = new Date().toISOString()
    await db.from('member_subscriptions').update(patch).eq('stripe_subscription_id', sub.id)
  } else if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
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
