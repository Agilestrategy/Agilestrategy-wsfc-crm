import Papa from 'papaparse'
import { supabase } from './supabase'

// Target fields a members CSV can be mapped onto
export const TARGETS = [
  ['', 'ignore'],
  ['member_number', 'Member number'], ['first_name', 'First name'], ['last_name', 'Last name'], ['full_name_split', 'Full name (split into first/last)'],
  ['preferred_name', 'Preferred name'], ['email', 'Email'], ['mobile', 'Mobile'], ['phone', 'Phone'], ['date_of_birth', 'Date of birth'], ['gender', 'Gender'],
  ['address_line1', 'Address line 1'], ['address_line2', 'Address line 2'], ['suburb', 'Suburb'], ['city', 'City'], ['postcode', 'Postcode'],
  ['category', 'Membership category (text)'], ['status', 'Status (text)'], ['joined_on', 'Joined date'], ['financial_until', 'Financial until / expiry'],
  ['lapsed_on', 'Lapsed date'], ['boat_name', 'Boat name'], ['occupation', 'Occupation'], ['employer', 'Employer'], ['notes', 'Notes'],
  ['card_number', 'Card number'], ['legacy_id', 'Legacy system ID'],
]

const GUESS = [
  [/^(member|mem|membership)?\s*(no|num|number|id)$/i, 'member_number'], [/^(first|given)\s*name$/i, 'first_name'], [/^first$/i, 'first_name'],
  [/^(last|sur|family)\s*name$/i, 'last_name'], [/^surname$/i, 'last_name'], [/^(full\s*)?name$/i, 'full_name_split'], [/^member\s*name$/i, 'full_name_split'],
  [/e-?mail/i, 'email'], [/mobile|cell/i, 'mobile'], [/^(phone|telephone|home\s*phone|ph)$/i, 'phone'], [/(dob|birth)/i, 'date_of_birth'],
  [/^(address|street|address\s*1|address line 1)$/i, 'address_line1'], [/address\s*2/i, 'address_line2'], [/suburb/i, 'suburb'], [/^(city|town)$/i, 'city'], [/post\s*code|zip/i, 'postcode'],
  [/(category|type|class|membership)/i, 'category'], [/status/i, 'status'], [/(joined|join date|start)/i, 'joined_on'], [/(expir|financial|paid to|renew|valid)/i, 'financial_until'],
  [/boat/i, 'boat_name'], [/occupation/i, 'occupation'], [/employer|company/i, 'employer'], [/note|comment/i, 'notes'], [/card/i, 'card_number'], [/gender|sex/i, 'gender'],
]

export function guessMapping(headers) {
  const map = {}
  const used = new Set()
  for (const h of headers) {
    const clean = h.trim()
    for (const [re, t] of GUESS) {
      if (re.test(clean) && !used.has(t)) { map[h] = t; used.add(t); break }
    }
    map[h] ??= ''
  }
  return map
}

export function parseFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, { header: true, skipEmptyLines: true, complete: r => resolve(r), error: reject })
  })
}

export const isMailchimp = (headers) => headers.includes('Email Address') && headers.includes('EUID')

// dd/mm/yyyy, d/m/yy, yyyy-mm-dd, 12 Aug 2025 → ISO date or null
export function toDate(v) {
  if (!v) return null
  const s = String(v).trim(); if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/)
  if (m) { let y = m[3]; if (y.length === 2) y = (Number(y) > 40 ? '19' : '20') + y; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` }
  const d = new Date(s); return isNaN(d) ? null : d.toISOString().slice(0, 10)
}

const norm = (s) => (s ?? '').toString().trim()
const lower = (s) => norm(s).toLowerCase()

export function categoryIdFor(text, cats) {
  const t = lower(text); if (!t) return null
  const exact = cats.find(c => c.code === t || c.name.toLowerCase() === t); if (exact) return exact.id
  if (/senior.*fam/.test(t)) return cats.find(c => c.code === 'senior_family')?.id
  if (/jun.*fam/.test(t)) return cats.find(c => c.code === 'junior_family')?.id
  if (/fam/.test(t)) return cats.find(c => c.code === 'family')?.id
  if (/jun|youth|kid/.test(t)) return cats.find(c => c.code === 'junior')?.id
  if (/senior|super|gold card|pension/.test(t)) return cats.find(c => c.code === 'senior')?.id
  if (/corp|business/.test(t)) return cats.find(c => c.code === 'corporate')?.id
  if (/life|honor|honour/.test(t)) return cats.find(c => c.code === 'life')?.id
  if (/social/.test(t)) return cats.find(c => c.code === 'social')?.id
  if (/fish|full|ordinary|adult|single/.test(t)) return cats.find(c => c.code === 'fishing')?.id
  if (/day/.test(t)) return cats.find(c => c.code === 'day')?.id
  return cats.find(c => c.code === 'other')?.id
}

export function statusFor(text, financialUntil) {
  const t = lower(text)
  if (/lapse/.test(t)) return 'lapsed'
  if (/expire/.test(t)) return 'expired'
  if (/cancel|resign|deceased/.test(t)) return 'cancelled'
  if (/pend|await|new/.test(t)) return 'pending'
  if (/active|financial|current|paid|yes|y$/.test(t)) return 'active'
  if (financialUntil) return financialUntil >= new Date().toISOString().slice(0, 10) ? 'active' : 'lapsed'
  return 'unknown'
}

// Build a members row from a CSV row using the mapping
export function buildMember(row, mapping, cats, batchId, sourceLabel) {
  const m = { source: sourceLabel, import_batch_id: batchId, legacy_ids: {}, raw: row }
  let catText = '', statusText = '', card = null
  for (const [col, target] of Object.entries(mapping)) {
    if (!target) continue
    const v = norm(row[col])
    switch (target) {
      case 'full_name_split': {
        if (!v) break
        if (v.includes(',')) { const [l, f] = v.split(',').map(norm); m.last_name = l; m.first_name = f }
        else { const parts = v.split(/\s+/); m.first_name = parts.shift(); m.last_name = parts.join(' ') || null }
        break
      }
      case 'category': catText = v; break
      case 'status': statusText = v; break
      case 'card_number': card = v || null; break
      case 'legacy_id': if (v) m.legacy_ids.legacy_id = v; break
      case 'date_of_birth': case 'joined_on': case 'financial_until': case 'lapsed_on': m[target] = toDate(v); break
      case 'email': m.email = v ? v.toLowerCase() : null; break
      default: m[target] = v || null
    }
  }
  m.category_id = categoryIdFor(catText, cats)
  m.status = statusFor(statusText, m.financial_until)
  if (m.email) m.email_status = 'unknown'
  return { member: m, card }
}

// Upsert members in batches. keyMode: 'member_number' | 'email' | 'name'
export async function upsertMembers(rows, keyMode, onProgress) {
  let inserted = 0, updated = 0, skipped = 0
  const cards = []
  const CH = 200
  for (let i = 0; i < rows.length; i += CH) {
    const chunk = rows.slice(i, i + CH)
    for (const { member, card } of chunk) {
      let existing = null
      if (keyMode === 'member_number' && member.member_number) {
        ({ data: existing } = await supabase.from('members').select('id').eq('member_number', member.member_number).maybeSingle())
      } else if (keyMode === 'email' && member.email) {
        ({ data: existing } = await supabase.from('members').select('id').ilike('email', member.email).maybeSingle())
      } else if (keyMode === 'name' && member.first_name && member.last_name) {
        const { data } = await supabase.from('members').select('id').ilike('first_name', member.first_name).ilike('last_name', member.last_name).limit(2)
        existing = data?.length === 1 ? data[0] : null
      }
      if (!member.first_name && !member.last_name && !member.email && !member.member_number) { skipped++; continue }
      let id
      if (existing) {
        const patch = Object.fromEntries(Object.entries(member).filter(([k, v]) => v !== null && v !== undefined && k !== 'legacy_ids'))
        const { error } = await supabase.from('members').update(patch).eq('id', existing.id)
        if (error) { skipped++; continue }
        id = existing.id; updated++
      } else {
        const { data, error } = await supabase.from('members').insert(member).select('id').single()
        if (error) { skipped++; continue }
        id = data.id; inserted++
      }
      if (card) cards.push({ member_id: id, card_number: card })
    }
    onProgress?.(Math.min(i + CH, rows.length))
  }
  if (cards.length) await supabase.from('cards').upsert(cards, { onConflict: 'card_number', ignoreDuplicates: true })
  return { inserted, updated, skipped }
}

// Mailchimp CSV (any of the four) → email_contacts
export async function upsertMailchimp(rows, filename, batchId, onProgress) {
  const f = filename.toLowerCase()
  const status = f.startsWith('subscribed') ? 'subscribed' : f.startsWith('unsubscribed') ? 'unsubscribed' : f.startsWith('cleaned') ? 'cleaned' : f.startsWith('nonsubscribed') ? 'nonsubscribed' : 'unknown'
  const ts = (s) => (s && s.trim() ? new Date(s.replace(' ', 'T') + 'Z').toISOString() : null)
  const records = rows.map(r => ({
    email: lower(r['Email Address']), first_name: norm(r['First Name']) || null, last_name: norm(r['Last Name']) || null, status,
    tags: norm(r.TAGS).replace(/"/g, '').split(',').map(t => t.trim()).filter(Boolean),
    phone: norm(r['Phone Number']) || null, birthday: norm(r.Birthday) || null, optin_at: ts(r.OPTIN_TIME),
    status_changed_at: ts(r.UNSUB_TIME || r.CLEAN_TIME || r.LAST_CHANGED), reason: norm(r.UNSUB_REASON || r.CLEAN_CAMPAIGN_TITLE || r.UNSUB_CAMPAIGN_TITLE) || null,
    source: norm(r.SOURCE) || null, mailchimp_leid: norm(r.LEID) || null, mailchimp_euid: norm(r.EUID) || null, import_batch_id: batchId, raw: r,
  })).filter(r => r.email)
  let n = 0
  for (let i = 0; i < records.length; i += 500) {
    const { error } = await supabase.from('email_contacts').upsert(records.slice(i, i + 500), { onConflict: 'email' })
    if (error) throw error
    n += Math.min(500, records.length - i); onProgress?.(n)
  }
  return { inserted: n, updated: 0, skipped: rows.length - records.length, status }
}
