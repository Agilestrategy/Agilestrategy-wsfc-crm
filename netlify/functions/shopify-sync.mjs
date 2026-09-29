// Scheduled: every 15 minutes, mirror Shopify products and orders into the CRM.
import { runSync } from '../lib/shopify.mjs'

export const config = { schedule: '*/15 * * * *' }

export default async () => {
  const r = await runSync('schedule')
  return new Response(JSON.stringify(r), { status: r.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } })
}
