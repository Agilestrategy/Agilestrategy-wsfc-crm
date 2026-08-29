#!/usr/bin/env node
// Imports a Mailchimp audience export (the four CSVs: subscribed / unsubscribed /
// cleaned / nonsubscribed) into email_contacts, then runs match_email_contacts().
//
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/import-mailchimp.mjs ./data/audience_export
//
// The service role key bypasses RLS. Never ship it to the browser.

import fs from 'node:fs'
import path from 'node:path'
import Papa from 'papaparse'
import { createClient } from '@supabase/supabase-js'

const dir = process.argv[2]
if (!dir) { console.error('usage: import-mailchimp.mjs <folder with mailchimp csvs>'); process.exit(1) }
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const sb = createClient(url, key, { auth: { persistSession: false } })

const statusOf = (file) => {
  const f = path.basename(file).toLowerCase()
  if (f.startsWith('subscribed')) return 'subscribed'
  if (f.startsWith('unsubscribed')) return 'unsubscribed'
  if (f.startsWith('cleaned')) return 'cleaned'
  if (f.startsWith('nonsubscribed')) return 'nonsubscribed'
  return 'unknown'
}
const parseTags = (s) => (s || '').replace(/"/g, '').split(',').map(t => t.trim()).filter(Boolean)
const ts = (s) => (s && s.trim() ? new Date(s.replace(' ', 'T') + 'Z').toISOString() : null)
const clean = (s) => { const v = (s ?? '').toString().trim(); return v === '' ? null : v }

const files = fs.readdirSync(dir).filter(f => f.endsWith('.csv'))
if (!files.length) { console.error('no csv files in', dir); process.exit(1) }

const { data: batch, error: bErr } = await sb.from('import_batches')
  .insert({ source: 'mailchimp', filename: files.join(', '), created_by: 'import-mailchimp.mjs' })
  .select().single()
if (bErr) throw bErr

let total = 0, upserted = 0
for (const file of files) {
  const status = statusOf(file)
  const text = fs.readFileSync(path.join(dir, file), 'utf8')
  const { data: rows } = Papa.parse(text, { header: true, skipEmptyLines: true })
  console.log(`${file}: ${rows.length} rows → ${status}`)
  total += rows.length

  const records = rows.map(r => ({
    email: clean(r['Email Address'])?.toLowerCase(),
    first_name: clean(r['First Name']),
    last_name: clean(r['Last Name']),
    status,
    tags: parseTags(r.TAGS),
    phone: clean(r['Phone Number']),
    birthday: clean(r.Birthday),
    optin_at: ts(r.OPTIN_TIME),
    status_changed_at: ts(r.UNSUB_TIME || r.CLEAN_TIME || r.LAST_CHANGED),
    reason: clean(r.UNSUB_REASON || r.CLEAN_CAMPAIGN_TITLE || r.UNSUB_CAMPAIGN_TITLE),
    source: clean(r.SOURCE),
    mailchimp_leid: clean(r.LEID),
    mailchimp_euid: clean(r.EUID),
    import_batch_id: batch.id,
    raw: r,
  })).filter(r => r.email)

  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500)
    const { error } = await sb.from('email_contacts').upsert(chunk, { onConflict: 'email' })
    if (error) { console.error('chunk failed', error); process.exit(1) }
    upserted += chunk.length
  }
}

await sb.from('import_batches').update({ row_count: total, inserted: upserted }).eq('id', batch.id)
const { data: m, error: mErr } = await sb.rpc('match_email_contacts')
if (mErr) console.warn('match_email_contacts failed:', mErr.message)
else console.log('matched to members:', m)
console.log(`done. ${upserted} contacts upserted from ${total} rows (batch ${batch.id})`)
