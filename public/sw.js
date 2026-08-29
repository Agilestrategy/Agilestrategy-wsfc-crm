/* WSFC Members service worker: push notifications + minimal offline shell */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'WSFC', body: event.data && event.data.text() } }
  const title = data.title || 'Whakatāne Sportfishing Club'
  const options = {
    body: data.body || '',
    icon: '/wsfc-logo-256.png',
    badge: '/favicon.png',
    data: { url: data.url || '/me' },
    tag: data.tag || undefined,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/me'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus() } }
    return self.clients.openWindow(url)
  }))
})

// network-first for navigation, cache the app shell as a fallback
const SHELL = 'wsfc-shell-v1'
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).then((r) => { caches.open(SHELL).then((c) => c.put('/me', r.clone())); return r })
    .catch(() => caches.match('/me')))
})
