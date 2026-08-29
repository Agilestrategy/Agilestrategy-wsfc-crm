import { supabase } from './supabase'

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

function b64ToU8(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null
  return navigator.serviceWorker.register('/sw.js')
}

// Ask permission, subscribe the browser, store the subscription against the member
export async function enablePush(memberId) {
  if (!pushSupported()) throw new Error('This browser does not support notifications.')
  if (!VAPID) throw new Error('Notifications are not configured yet (missing VAPID key).')
  const reg = await registerSW()
  await navigator.serviceWorker.ready
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications were not allowed.')
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID) })
  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    { member_id: memberId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent, last_seen_at: new Date().toISOString() },
    { onConflict: 'endpoint' })
  if (error) throw error
  await supabase.from('members').update({ push_opt_in: true }).eq('id', memberId)
  return true
}

export async function disablePush(memberId) {
  const reg = await navigator.serviceWorker?.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) { await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe() }
  await supabase.from('members').update({ push_opt_in: false }).eq('id', memberId)
}

export async function currentPushState() {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker?.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}
