// On demand sync from the console ("Sync now" button). Caller must be a signed in staff member.
import { createClient } from '@supabase/supabase-js'
import { runSync } from '../lib/shopify.mjs'

export default async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  const token = (req.headers.get('authorization') || '').replace(/^Bearer /i, '')
  if (!token) return new Response('unauthorised', { status: 401 })
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return new Response('not configured', { status: 500 })
  const admin = createClient(url, key, { auth: { persistSession: false } })
  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user) return new Response('unauthorised', { status: 401 })
  const { data: staff } = await admin.from('staff').select('id').eq('is_active', true).or(`user_id.eq.${user.id},email.ilike.${user.email}`).maybeSingle()
  if (!staff) return new Response('staff only', { status: 403 })
  const full = new URL(req.url).searchParams.get('full') === '1'
  const r = await runSync('manual', { full })
  return new Response(JSON.stringify(r), { status: r.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } })
}
