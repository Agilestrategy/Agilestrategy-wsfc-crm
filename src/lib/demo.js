// Demo mode for showing the member app off without a real account.
// /demo asks for a PIN, then the member app runs against this in browser data set (kept in localStorage).
// Nothing here touches Supabase, Stripe or Netlify functions.

const FLAG = 'wsfc-demo'
const DB_KEY = 'wsfc-demo-db'
// PIN is checked as a SHA-256 hash so it is not readable in the bundle.
const PIN_HASH = '6041013c04b1780fe86ebfa18a4a3cf5507810ef071eac53ca6a74e61fb73065'

export const isDemo = () => { try { return localStorage.getItem(FLAG) === '1' } catch { return false } }
export const startDemo = () => { try { localStorage.setItem(FLAG, '1') } catch { /* ignore */ } }
export const endDemo = () => { try { localStorage.removeItem(FLAG); localStorage.removeItem(DB_KEY); localStorage.removeItem('wsfc-cart') } catch { /* ignore */ } }
export const resetDemo = () => { try { localStorage.removeItem(DB_KEY); localStorage.removeItem('wsfc-cart') } catch { /* ignore */ } }

export async function checkPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('wsfc:' + String(pin).trim()))
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return hex === PIN_HASH
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2))
const daysAgo = (n, h = 18) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, 12, 0, 0); return d.toISOString() }

export const DEMO_USER = { id: 'demo-user', email: 'sam.member@example.co.nz', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { full_name: 'Sam Rangi' } }
const MEMBER_ID = 'demo-member'

function seed() {
  const members = [{
    id: MEMBER_ID, auth_user_id: DEMO_USER.id, member_number: '1060', first_name: 'Sam', last_name: 'Rangi', preferred_name: 'Sam', full_name: 'Sam Rangi',
    email: DEMO_USER.email, mobile: '021 000 0000', phone: null, status: 'active', status_tier: 'gold', financial_until: '2027-06-30', joined_on: '2019-08-01',
    address_line1: '12 Harbour View Road', suburb: 'Ohope', city: 'Whakatāne', postcode: '3121', boat_name: 'Reel Deal', date_of_birth: '1982-03-14',
    is_household_primary: true, push_opt_in: false, category_id: 'cat-senior', membership_categories: { name: 'Senior' },
  }]
  const engagements = [
    { id: uid(), member_id: MEMBER_ID, type: 'swipe_bar', points: 10, occurred_at: daysAgo(2), reference: 'BAR' },
    { id: uid(), member_id: MEMBER_ID, type: 'swipe_door', points: 5, occurred_at: daysAgo(9, 11), reference: 'DOOR' },
    { id: uid(), member_id: MEMBER_ID, type: 'event', points: 25, occurred_at: daysAgo(16, 19), reference: 'Spring tournament briefing' },
    { id: uid(), member_id: MEMBER_ID, type: 'swipe_bar', points: 10, occurred_at: daysAgo(23), reference: 'BAR' },
    { id: uid(), member_id: MEMBER_ID, type: 'volunteer', points: 40, occurred_at: daysAgo(40, 9), reference: 'Weigh station' },
    { id: uid(), member_id: MEMBER_ID, type: 'swipe_bar', points: 10, occurred_at: daysAgo(51), reference: 'BAR' },
  ]
  // List prices sit 25% above the base price (whole dollars); Gold takes 10% off, Black 25% off and unlocks the limited range.
  const P = (title, price, sort, options = {}, extra = {}) => ({ id: 'p-' + sort, title, base_price: price, retail_price: Math.ceil(price * 1.25), sort, options, description: extra.description || null, image_url: null, is_preorder: !!extra.is_preorder, preorder_target: extra.preorder_target || null, lead_time: null, is_active: true, status: 'active', supplier_code: extra.code || null, min_tier: extra.min_tier || null, is_limited: !!extra.is_limited })
  const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL']
  const shop_products = [
    P('Staple tee', 55, 10, { Size: SIZES, Colour: ['Black', 'White'] }, { description: 'AS Colour Staple tee with the 60th anniversary badge.', code: '5001' }),
    P('Long sleeve tee', 65, 20, { Size: SIZES, Colour: ['Black', 'Navy'] }, { code: '5009' }),
    P('Singlet', 50, 30, { Size: SIZES, Colour: ['Black', 'White'] }, { code: '5025' }),
    P('Dual Tech fishing shirt', 110, 40, { Size: SIZES }, { description: 'Long sleeve, UPF 50, quick dry. Built for the water.', code: 'DT' }),
    P('Custom fishing polo', 130, 50, { Size: SIZES }, { description: 'Fully sublimated club polo. Pre order, runs once 50 are in.', is_preorder: true, preorder_target: 50 }),
    P('Cap', 55, 60, { Colour: ['Black', 'Navy', 'Sand'] }),
    P('Snapback', 65, 70, { Colour: ['Black', 'Navy'] }, { min_tier: 'black', is_limited: true, description: 'Limited run. Black members only.' }),
    P('Beanie', 55, 80, { Colour: ['Black', 'Navy'] }),
    P('Woven patch', 20, 90),
    P('Can cooler', 18, 100, { Colour: ['Black', 'Navy'] }),
    P('Dry bag', 20, 110),
    P('Bottle opener', 10, 120),
    P('Key ring', 10, 130),
    P('Dishcloth', 10, 140),
    P('Sticker', 5, 150),
    P('Bar runner', 60, 160, {}, { min_tier: 'black', is_limited: true, description: 'Numbered 60th bar runner. Black members only.' }),
    P('60th tournament jacket', 180, 170, { Size: SIZES }, { min_tier: 'black', is_limited: true, description: 'Limited to 60 pieces, numbered. Black members only.' }),
  ]
  const o1 = uid(), o2 = uid()
  const shop_orders = [
    { id: o1, order_number: 'WSFC-1004', shopify_created_at: daysAgo(12, 20), email: DEMO_USER.email, customer_name: 'Sam Rangi', member_id: MEMBER_ID, status: 'at_club', payment_method: 'stripe', paid_at: daysAgo(12, 20), total: 73, subtotal: 73, currency: 'NZD', note: null },
    { id: o2, order_number: 'WSFC-1009', shopify_created_at: daysAgo(3, 12), email: DEMO_USER.email, customer_name: 'Sam Rangi', member_id: MEMBER_ID, status: 'paid', payment_method: 'stripe', paid_at: daysAgo(3, 12), total: 110, subtotal: 110, currency: 'NZD', note: null },
  ]
  const shop_order_items = [
    { id: uid(), order_id: o1, product_id: 'p-10', title: 'Staple tee', variant_title: 'L / Black', quantity: 1, price: 55 },
    { id: uid(), order_id: o1, product_id: 'p-100', title: 'Can cooler', variant_title: 'Navy', quantity: 1, price: 18 },
    { id: uid(), order_id: o2, product_id: 'p-40', title: 'Dual Tech fishing shirt', variant_title: 'XL', quantity: 1, price: 110 },
  ]
  const membership_categories = [
    { id: 'cat-senior', code: 'SEN', name: 'Senior', annual_fee: 98, is_family: false, is_active: true, sort_order: 10 },
    { id: 'cat-family', code: 'FAM', name: 'Family', annual_fee: 140, is_family: true, is_active: true, sort_order: 20 },
    { id: 'cat-junior', code: 'JUN', name: 'Junior', annual_fee: 25, is_family: false, is_active: true, sort_order: 30 },
  ]
  const F = (code, label, per_year, premium_pct, sort) => ({ code, label, per_year, premium_pct, sort, is_active: true })
  const billing_frequencies = [F('weekly', 'Weekly', 52, 15, 10), F('fortnightly', 'Fortnightly', 26, 15, 20), F('monthly', 'Monthly', 12, 15, 30), F('quarterly', 'Quarterly', 4, 10, 40), F('six_monthly', 'Six monthly', 2, 5, 50), F('annual', 'Annual', 1, 0, 60)]
  return { members, engagements, shop_products, shop_orders, shop_order_items, shop_settings: [{ id: 1, store_url: null, min_run: 10, discount_gold: 10, discount_black: 25, retail_markup_pct: 25 }], push_subscriptions: [], membership_categories, billing_frequencies, member_subscriptions: [], next_order: 1012, checkins: {} }
}

function loadDb() { try { const j = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); if (j && j.members) return j } catch { /* ignore */ } const d = seed(); saveDb(d); return d }
function saveDb(db) { try { localStorage.setItem(DB_KEY, JSON.stringify(db)) } catch { /* ignore */ } }

// Tiny query builder covering what the member app uses.
function table(name) {
  const st = { name, filters: [], order: null, limit: null, mode: 'select', patch: null, rows: null, single: false, maybe: false }
  const b = {
    select() { return b },
    eq(k, v) { st.filters.push((r) => r[k] === v || String(r[k]) === String(v)); return b },
    neq(k, v) { st.filters.push((r) => r[k] !== v); return b },
    gt(k, v) { st.filters.push((r) => r[k] > v); return b },
    gte(k, v) { st.filters.push((r) => r[k] >= v); return b },
    lt(k, v) { st.filters.push((r) => r[k] < v); return b },
    in(k, vs) { st.filters.push((r) => vs.includes(r[k])); return b },
    not(k, op, v) { if (op === 'is' && v === null) st.filters.push((r) => r[k] != null); return b },
    is(k, v) { st.filters.push((r) => r[k] === v); return b },
    or() { return b },   // the members lookup: the demo has one member, always matched
    ilike() { return b },
    order(k, o) { st.order = { k, asc: o?.ascending !== false }; return b },
    limit(n) { st.limit = n; return b },
    single() { st.single = true; return b },
    maybeSingle() { st.maybe = true; return b },
    update(patch) { st.mode = 'update'; st.patch = patch; return b },
    insert(rows) { st.mode = 'insert'; st.rows = Array.isArray(rows) ? rows : [rows]; return b },
    upsert(rows) { st.mode = 'insert'; st.rows = Array.isArray(rows) ? rows : [rows]; return b },
    delete() { st.mode = 'delete'; return b },
    then(res, rej) { return Promise.resolve(run()).then(res, rej) },
  }
  function run() {
    const db = loadDb(); const all = db[st.name] || (db[st.name] = [])
    const match = (r) => st.filters.every((f) => f(r))
    if (st.mode === 'update') { for (const r of all) if (match(r)) Object.assign(r, st.patch); saveDb(db); return { data: null, error: null } }
    if (st.mode === 'delete') { db[st.name] = all.filter((r) => !match(r)); saveDb(db); return { data: null, error: null } }
    if (st.mode === 'insert') { const out = st.rows.map((r) => ({ id: uid(), ...r })); all.push(...out); saveDb(db); return { data: st.single ? out[0] : out, error: null } }
    let rows = all.filter(match).map((r) => ({ ...r }))
    if (st.name === 'shop_orders') rows.forEach((o) => { o.shop_order_items = (db.shop_order_items || []).filter((i) => i.order_id === o.id) })
    if (st.order) rows.sort((a, c) => (a[st.order.k] > c[st.order.k] ? 1 : a[st.order.k] < c[st.order.k] ? -1 : 0) * (st.order.asc ? 1 : -1))
    if (st.limit) rows = rows.slice(0, st.limit)
    if (st.single || st.maybe) return { data: rows[0] || null, error: null }
    return { data: rows, error: null }
  }
  return b
}

const session = { access_token: 'demo', token_type: 'bearer', expires_at: 4102444800, user: DEMO_USER }
const listeners = new Set()

export const demoClient = {
  from: table,
  auth: {
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async () => ({ data: { user: DEMO_USER }, error: null }),
    onAuthStateChange: (cb) => { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } } },
    signInWithOtp: async () => ({ error: null }),
    signOut: async () => { endDemo(); window.location.href = '/demo'; return { error: null } },
  },
  rpc: async (fn, args) => {
    const db = loadDb()
    if (fn === 'app_link_me') return { data: [db.members[0]], error: null }
    if (fn === 'member_checkin') {
      const code = String(args?.p_code || '').toUpperCase(); const pts = { BAR: 10, DOOR: 5 }[code]
      if (!pts) return { data: { ok: false, error: 'That code is not one of ours. Try BAR or DOOR.' }, error: null }
      const today = new Date().toISOString().slice(0, 10)
      if (db.checkins[code] === today) return { data: { ok: true, points: 0, message: 'Already checked in here today. See you tomorrow!' }, error: null }
      db.checkins[code] = today
      db.engagements.push({ id: uid(), member_id: MEMBER_ID, type: code === 'BAR' ? 'swipe_bar' : 'swipe_door', points: pts, occurred_at: new Date().toISOString(), reference: code })
      saveDb(db)
      return { data: { ok: true, points: pts, message: `Checked in at the ${code === 'BAR' ? 'bar' : 'door'}. +${pts} points, nice one Sam.` }, error: null }
    }
    return { data: null, error: { message: `Not in the demo: ${fn}` } }
  },
}

// Shop checkout without the Netlify function: creates the order here and either "pays" (mock screen) or holds it for the bar.
export function demoPlaceOrder(items, pay) {
  const db = loadDb()
  const tier = db.members[0].status_tier; const RANK = { silver: 1, gold: 2, black: 3 }
  const discount = tier === 'black' ? 25 : tier === 'gold' ? 10 : 0
  const lines = []
  for (const it of items) {
    const p = db.shop_products.find((x) => x.id === it.product_id); if (!p) continue
    if (p.min_tier && (RANK[tier] || 0) < (RANK[p.min_tier] || 0)) continue
    const variant = Object.keys(p.options || {}).map((k) => it.options?.[k]).filter(Boolean).join(' / ') || null
    lines.push({ product_id: p.id, title: p.title, variant_title: variant, quantity: Math.max(1, Math.min(20, Number(it.quantity) || 1)), list_price: Number(p.retail_price), price: Math.round(Number(p.retail_price) * (1 - discount / 100) * 100) / 100 })
  }
  const listTotal = lines.reduce((a, l) => a + l.list_price * l.quantity, 0)
  const total = Math.round(lines.reduce((a, l) => a + l.price * l.quantity, 0) * 100) / 100
  const id = uid(); const order_number = `WSFC-${db.next_order++}`
  db.shop_orders.push({ id, order_number, shopify_created_at: new Date().toISOString(), email: DEMO_USER.email, customer_name: 'Sam Rangi', member_id: MEMBER_ID, status: 'awaiting_payment', payment_method: pay, paid_at: null, total, subtotal: total, currency: 'NZD', note: null, member_tier: tier, discount_pct: discount, discount_amount: Math.round((listTotal - total) * 100) / 100 })
  lines.forEach((l) => db.shop_order_items.push({ id: uid(), order_id: id, ...l }))
  saveDb(db)
  return { order_id: id, order_number, total, url: pay === 'stripe' ? `/me/pay?order=${id}` : null }
}

// Subscription set up without Stripe: creates the row and sends the member to the mock payment screen.
export function demoSubscribe(categoryId, frequency) {
  const db = loadDb()
  const c = db.membership_categories.find((x) => x.id === categoryId) || db.membership_categories[0]
  const f = db.billing_frequencies.find((x) => x.code === frequency) || db.billing_frequencies.at(-1)
  const instalment = Math.round((c.annual_fee * (1 + f.premium_pct / 100) / f.per_year) * 100) / 100
  const id = uid()
  db.member_subscriptions.push({ id, member_id: MEMBER_ID, category_id: c.id, frequency: f.code, annual_fee: c.annual_fee, premium_pct: f.premium_pct, instalment, status: 'incomplete', current_period_end: null, started_at: null, cancel_at_period_end: false, created_at: new Date().toISOString() })
  saveDb(db)
  return { id, url: `/me/pay?sub=${id}` }
}

export function demoActivateSubscription(subId) {
  const db = loadDb(); const s = db.member_subscriptions.find((x) => x.id === subId)
  if (s && s.status === 'incomplete') {
    const days = { weekly: 7, fortnightly: 14, monthly: 30, quarterly: 91, six_monthly: 182, annual: 365 }[s.frequency] || 365
    s.status = 'active'; s.started_at = new Date().toISOString(); s.current_period_end = new Date(Date.now() + days * 864e5).toISOString()
    const m = db.members[0]; m.status = 'active'; m.category_id = s.category_id
    const until = new Date(Math.max(Date.now(), new Date(m.financial_until || 0).valueOf()) + 8 * 864e5); if (until > new Date(m.financial_until || 0)) m.financial_until = until.toISOString().slice(0, 10)
    m.membership_categories = { name: db.membership_categories.find((c) => c.id === s.category_id)?.name }
    saveDb(db)
  }
  return s
}

export function demoMarkPaid(orderId) {
  const db = loadDb(); const o = db.shop_orders.find((x) => x.id === orderId)
  if (o && o.status === 'awaiting_payment') { o.status = 'paid'; o.paid_at = new Date().toISOString(); saveDb(db) }
  return o
}

export function demoSetTier(tier) {
  const db = loadDb(); db.members[0].status_tier = tier; saveDb(db)
  listeners.forEach((cb) => cb('USER_UPDATED', { ...session }))   // nudges MemberApp to reload the member
}
