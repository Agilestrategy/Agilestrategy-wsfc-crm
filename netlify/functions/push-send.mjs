// Scheduled Netlify function: every 5 minutes, send queued push notifications.
// Env (Netlify, server-side only): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:)
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

export const config = { schedule: '*/5 * * * *' }

export default async () => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || !process.env.VAPID_PRIVATE_KEY) return new Response('not configured', { status: 500 })
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:president@wsfc.co.nz', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const { data: queue } = await sb.from('notifications').select('*').eq('status', 'queued').order('created_at').limit(20)
  for (const n of queue || []) {
    await sb.from('notifications').update({ status: 'sending' }).eq('id', n.id)
    let q = sb.from('push_subscriptions').select('id, endpoint, p256dh, auth, member_id, members!inner(id, status_tier, push_opt_in, status)')
    q = q.eq('members.push_opt_in', true)
    if (n.audience?.tier) q = q.eq('members.status_tier', n.audience.tier)
    if (n.audience?.member_ids) q = q.in('member_id', n.audience.member_ids)
    const { data: subs } = await q
    let sent = 0, failed = 0
    const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url || '/me', tag: n.id })
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 })
        sent++
        await sb.from('push_subscriptions').update({ last_seen_at: new Date().toISOString() }).eq('id', s.id)
      } catch (e) {
        failed++
        if (e.statusCode === 404 || e.statusCode === 410) await sb.from('push_subscriptions').delete().eq('id', s.id) // gone: clean up
      }
    }
    await sb.from('notifications').update({ status: failed && !sent ? 'failed' : 'sent', sent_count: sent, failed_count: failed, sent_at: new Date().toISOString() }).eq('id', n.id)
  }
  return new Response(`processed ${(queue || []).length}`)
}
