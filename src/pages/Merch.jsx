import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase, fmtDate, fmtDateTime } from '../lib/supabase'

const STATUS = [
  ['awaiting_payment', 'Awaiting payment'], ['paid', 'Paid'], ['in_next_run', 'In next run'], ['sent_to_mark', 'Sent to Mark'], ['at_club', 'At club'], ['collected', 'Collected'], ['cancelled', 'Cancelled'],
]
const label = (s) => STATUS.find(([k]) => k === s)?.[1] || s
const tone = { awaiting_payment: 'lapsed', paid: 'pending', in_next_run: 'pending', sent_to_mark: 'expired', at_club: 'active', collected: 'unknown', cancelled: 'lapsed' }
const money = (n) => (n == null ? '' : '$' + Number(n).toFixed(2))

function Stat({ n, l, s, tone }) {
  return <div className={`card stat ${tone || ''}`}><div className="n">{n ?? '–'}</div><div className="l">{l}</div>{s && <div className="s">{s}</div>}</div>
}

export default function Merch() {
  const [tab, setTab] = useState('orders')
  const [sum, setSum] = useState(null)
  const [settings, setSettings] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const loadTop = async () => {
    const { data } = await supabase.from('v_merch_summary').select('*').single(); setSum(data)
    const { data: s } = await supabase.from('shop_settings').select('*').eq('id', 1).single(); setSettings(s)
  }
  useEffect(() => { loadTop() }, [])

  async function syncNow(full) {
    setBusy(true); setMsg('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`/.netlify/functions/shopify-sync-now${full ? '?full=1' : ''}`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } })
      const j = await r.json().catch(() => ({}))
      setMsg(r.ok ? `Synced: ${j.products} products, ${j.orders} orders.` : `Sync failed: ${j.error || r.statusText}`)
    } catch (e) { setMsg('Sync failed: ' + e.message) }
    setBusy(false); loadTop()
  }

  const connected = Boolean(settings?.last_product_sync_at)
  return (
    <>
      <div className="page-head">
        <div><h1>Merchandise</h1><p>Members order in the app (Stripe, Apple Pay, Google Pay, or pay at the bar). Orders land here, get bundled into the Friday run for Mark, and are tracked to collection at the club.</p></div>
        <div style={{ display: 'flex', gap: '.4rem' }}>
          {settings?.store_url && <a className="btn ghost" href={settings.store_url} target="_blank" rel="noreferrer">Open shop</a>}
          <button className="btn primary" disabled={busy} onClick={() => syncNow(false)}>{busy ? 'Syncing…' : 'Sync now'}</button>
        </div>
      </div>
      {msg && <div className={`alert ${msg.startsWith('Sync failed') ? 'err' : 'ok'}`}>{msg}</div>}
      {!connected && <div className="alert">Shopify is not connected yet. Add the store domain and Admin API token in Netlify (see the Settings tab), then press Sync now.</div>}

      <div className="grid cols-4" style={{ marginBottom: '1rem' }}>
        <Stat n={sum?.orders_new} l="New paid orders" s={sum?.orders_unpaid ? `waiting for the next run · ${sum.orders_unpaid} unpaid (pay at bar)` : 'waiting for the next run'} tone="orange" />
        <Stat n={sum?.units_waiting} l="Units waiting" s="across all products" tone="navy" />
        <Stat n={sum?.orders_with_mark} l="With Mark" s="in production or freight" />
        <Stat n={sum?.orders_at_club} l="At the club" s="ready to collect" />
      </div>

      <div className="tabs">
        {[['orders', 'Orders'], ['readiness', 'Run readiness'], ['runs', 'Friday runs'], ['products', 'Products and costs'], ['settings', 'Settings']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'orders' && <Orders onChange={loadTop} />}
      {tab === 'readiness' && <Readiness settings={settings} />}
      {tab === 'runs' && <Runs onChange={loadTop} settings={settings} />}
      {tab === 'products' && <Products />}
      {tab === 'settings' && <Settings settings={settings} onSaved={loadTop} />}
    </>
  )
}

// ---------------------------------------------------------------------------
function Orders({ onChange }) {
  const [rows, setRows] = useState([]); const [filter, setFilter] = useState('open'); const [q, setQ] = useState(''); const [open, setOpen] = useState(null)
  const load = async () => {
    let s = supabase.from('shop_orders').select('*, shop_order_items(*), members(first_name, last_name, member_number, status_tier)').order('shopify_created_at', { ascending: false }).limit(300)
    if (filter === 'open') s = s.in('status', ['awaiting_payment', 'paid', 'in_next_run', 'sent_to_mark', 'at_club'])
    else if (filter !== 'all') s = s.eq('status', filter)
    const { data } = await s; setRows(data || [])
  }
  useEffect(() => { load() }, [filter])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase(); if (!t) return rows
    return rows.filter((r) => [r.order_number, r.customer_name, r.email, r.members?.member_number].some((v) => String(v || '').toLowerCase().includes(t)))
  }, [rows, q])
  async function setStatus(r, status) { await supabase.from('shop_orders').update({ status }).eq('id', r.id); load(); onChange() }
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.75rem', flexWrap: 'wrap' }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="open">Open orders</option><option value="all">All</option>
          {STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input placeholder="Search order, name, email, member #" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <span className="small muted">{shown.length} shown</span>
      </div>
      <table>
        <thead><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Member</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {shown.map((r) => (
            <Fragment key={r.id}>
              <tr style={{ opacity: r.status === 'cancelled' ? .5 : 1 }}>
                <td><b>{r.order_number}</b></td>
                <td>{fmtDate(r.shopify_created_at)}</td>
                <td>{r.customer_name}<div className="small muted">{r.email}{r.phone ? ` · ${r.phone}` : ''}</div></td>
                <td>{r.members ? <>{r.members.first_name} {r.members.last_name} <span className={`pill tier-${r.members.status_tier || ''}`}>{r.members.member_number ? `#${r.members.member_number}` : ''}</span></> : <span className="small muted">not a member</span>}</td>
                <td>{r.shop_order_items.reduce((a, i) => a + i.quantity, 0)} <button className="btn ghost sm" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'hide' : 'view'}</button></td>
                <td>{money(r.total)}</td>
                <td><span className={`pill ${tone[r.status]}`}>{label(r.status)}</span><div className="small muted">{r.payment_method === 'stripe' ? 'Paid online' : r.payment_method === 'at_club' ? (r.paid_at ? 'Paid at bar' : 'Pay at bar') : r.payment_method === 'shopify' || r.shopify_order_id ? 'Shopify' : ''}</div></td>
                <td>
                  <select value={r.status} onChange={(e) => setStatus(r, e.target.value)}>
                    {STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </td>
              </tr>
              {open === r.id && (
                <tr><td colSpan={8} style={{ background: '#fafafa' }}>
                  {r.shop_order_items.map((i) => <div key={i.id} className="small">{i.quantity} × {i.title}{i.variant_title ? ` (${i.variant_title})` : ''}{i.sku ? ` · ${i.sku}` : ''} · {money(i.price)}</div>)}
                  {r.note && <div className="small muted">Note: {r.note}</div>}
                  <div className="small muted">Status changed {fmtDateTime(r.status_updated_at)} · synced {fmtDateTime(r.synced_at)}</div>
                </td></tr>
              )}
            </Fragment>
          ))}
          {!shown.length && <tr><td colSpan={8} className="muted">No orders yet. Once Shopify is connected, paid orders appear here within 15 minutes, or instantly if the webhook is set up.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
function Readiness({ settings }) {
  const [rows, setRows] = useState([])
  useEffect(() => { supabase.from('v_run_readiness').select('*').order('units_waiting', { ascending: false }).then(({ data }) => setRows(data || [])) }, [])
  const waiting = rows.filter((r) => r.units_waiting > 0)
  const topup = waiting.filter((r) => !r.is_preorder).reduce((a, r) => a + r.shortfall, 0)
  return (
    <div className="card">
      <p className="small muted" style={{ marginTop: 0 }}>Minimum {settings?.min_run || 10} units per item per lot. Where a line is short on Friday, the club tops up to the minimum and holds the balance as bar stock. Pre order lines run once they reach their target.</p>
      <table>
        <thead><tr><th>Product</th><th>Code</th><th>Orders</th><th>Units waiting</th><th>Lot minimum</th><th>Short by</th><th>Club stock</th><th>Oldest order</th><th>Ready?</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const target = r.is_preorder ? r.preorder_target : r.min_run
            const ready = r.units_waiting > 0 && r.shortfall === 0
            return (
              <tr key={r.product_id} style={{ opacity: r.units_waiting ? 1 : .55 }}>
                <td><b>{r.title}</b>{r.is_preorder && <div className="small muted">pre order{r.preorder_closes ? ` · closes ${fmtDate(r.preorder_closes)}` : ''}</div>}</td>
                <td className="small">{r.supplier_code || ''}</td>
                <td>{r.orders_waiting}</td><td><b>{r.units_waiting}</b></td><td>{target}</td>
                <td>{r.units_waiting ? r.shortfall : ''}</td>
                <td>{r.stock_on_hand}</td>
                <td className="small">{r.oldest_waiting ? fmtDate(r.oldest_waiting) : ''}</td>
                <td>{r.units_waiting ? <span className={`pill ${ready ? 'active' : r.is_preorder ? 'pending' : 'expired'}`}>{ready ? 'Run it' : r.is_preorder ? `${r.units_waiting}/${target}` : `top up ${r.shortfall}`}</span> : ''}</td>
              </tr>
            )
          })}
          {!rows.length && <tr><td colSpan={9} className="muted">No products synced yet.</td></tr>}
        </tbody>
      </table>
      {waiting.length > 0 && <p className="small muted">If the Friday run went today: {waiting.reduce((a, r) => a + r.units_waiting, 0)} ordered units plus {topup} top up units to reach the minimums.</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
function Runs({ onChange, settings }) {
  const [runs, setRuns] = useState([]); const [msg, setMsg] = useState('')
  const load = async () => { const { data } = await supabase.from('shop_runs').select('*').order('created_at', { ascending: false }).limit(30); setRuns(data || []) }
  useEffect(() => { load() }, [])
  async function build() {
    setMsg('')
    const { error } = await supabase.rpc('shop_build_run', { p_notes: `Run built ${new Date().toLocaleDateString('en-NZ')}` })
    setMsg(error ? error.message : 'Run built. Export it and send to Mark, then mark it sent.'); load(); onChange()
  }
  async function send(r) { const { error } = await supabase.rpc('shop_send_run', { p_run: r.id }); setMsg(error ? error.message : `Run ${fmtDate(r.run_date)} marked as sent to Mark.`); load(); onChange() }
  async function receive(r) { const { error } = await supabase.rpc('shop_receive_run', { p_run: r.id }); setMsg(error ? error.message : 'Run received. Members have been notified their order is at the club.'); load(); onChange() }
  function csv(r) {
    const lines = r.lines || []
    const min = settings?.min_run || 10
    const out = [['Product', 'Variant', 'SKU', 'Supplier code', 'Qty', 'Orders (order · name · qty)']]
    const totals = {}
    for (const l of lines) {
      const k = l.product_id || l.title
      totals[k] = { title: l.title, code: l.supplier_code, preorder: l.is_preorder, qty: (totals[k]?.qty || 0) + Number(l.quantity) }
      out.push([l.title, l.variant || '', l.sku || '', l.supplier_code || '', l.quantity, (l.orders || []).map((o) => `${o.order} · ${o.name || ''} · ${o.qty}`).join(' | ')])
    }
    for (const t of Object.values(totals)) if (!t.preorder && t.qty < min) out.push([t.title, 'TOP UP to lot minimum (club stock)', '', t.code || '', min - t.qty, `ordered ${t.qty}, minimum ${min}`])
    const text = out.map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = `WSFC_merch_run_${r.run_date}.csv`; a.click()
  }
  function print(r) {
    const w = window.open('', '_blank'); if (!w) return
    const rows = (r.lines || []).map((l) => `<tr><td>${l.title}</td><td>${l.variant || ''}</td><td>${l.sku || ''}</td><td>${l.supplier_code || ''}</td><td style="text-align:right">${l.quantity}</td><td class="s">${(l.orders || []).map((o) => `${o.order} ${o.name || ''} ×${o.qty}`).join('<br>')}</td></tr>`).join('')
    w.document.write(`<html><head><title>WSFC merch run ${r.run_date}</title><style>body{font-family:Arial,sans-serif;color:#1B2F3E;padding:28px}h1{margin:0 0 4px}p{margin:4px 0 14px;color:#555}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f2f2f2}.s{font-size:11px;color:#555}</style></head><body>
      <img src="/wsfc-logo.png" style="width:90px"><h1>Merchandise run · ${fmtDate(r.run_date)}</h1><p>Whakatāne Sportfishing Club consolidated order for Mark · ${r.order_count} orders · ${r.unit_count} units · freight to the club for collection. Minimum ${settings?.min_run || 10} per item per lot; top ups noted below are held as club stock.</p>
      <table><thead><tr><th>Product</th><th>Variant</th><th>SKU</th><th>Supplier code</th><th>Qty</th><th>Orders</th></tr></thead><tbody>${rows}</tbody></table>
      ${r.topup_units ? `<p>Top up to minimums: ${r.topup_units} units (see run readiness for the split).</p>` : ''}</body></html>`)
    w.document.close(); w.focus(); setTimeout(() => w.print(), 400)
  }
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '.75rem' }}>
        <p className="small muted" style={{ margin: 0 }}>Cut off every Friday. Build the run, export or print it for Mark, then mark it sent. When the freight arrives, mark it received and every member in the run gets a notification.</p>
        <button className="btn primary" onClick={build}>Build this week's run</button>
      </div>
      {msg && <div className="alert ok">{msg}</div>}
      <table>
        <thead><tr><th>Run</th><th>Status</th><th>Orders</th><th>Units</th><th>Top up</th><th>Sent</th><th>Received</th><th></th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td><b>{fmtDate(r.run_date)}</b><div className="small muted">{r.notes}</div></td>
              <td><span className={`pill ${r.status === 'sent' ? 'expired' : r.status === 'received' ? 'active' : 'pending'}`}>{r.status}</span></td>
              <td>{r.order_count}</td><td>{r.unit_count}</td><td>{r.topup_units || ''}</td>
              <td className="small">{r.sent_at ? `${fmtDateTime(r.sent_at)} · ${r.sent_by || ''}` : ''}</td>
              <td className="small">{r.received_at ? fmtDateTime(r.received_at) : ''}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn ghost sm" onClick={() => csv(r)}>CSV</button> <button className="btn ghost sm" onClick={() => print(r)}>Print</button>{' '}
                {r.status === 'open' && <button className="btn sm" onClick={() => send(r)}>Mark sent to Mark</button>}
                {r.status === 'sent' && <button className="btn sm" onClick={() => receive(r)}>Received at club</button>}
              </td>
            </tr>
          ))}
          {!runs.length && <tr><td colSpan={8} className="muted">No runs yet.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
function Products() {
  const [rows, setRows] = useState([]); const [msg, setMsg] = useState(''); const [adding, setAdding] = useState(false)
  const load = async () => { const { data } = await supabase.from('shop_products').select('*').order('sort').order('title'); setRows(data || []) }
  useEffect(() => { load() }, [])
  async function save(r, patch) { const { error } = await supabase.from('shop_products').update(patch).eq('id', r.id); setMsg(error ? error.message : ''); load() }
  const optsToText = (o) => Object.entries(o || {}).map(([k, v]) => `${k}: ${(v || []).join(', ')}`).join('; ')
  const textToOpts = (t) => { const o = {}; for (const part of t.split(';')) { const [k, v] = part.split(':'); if (k && v) o[k.trim()] = v.split(',').map((x) => x.trim()).filter(Boolean) } return o }
  const Num = ({ r, k, step = '0.01', w = 84 }) => <input type="number" step={step} defaultValue={r[k] ?? ''} style={{ width: w }} onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== r[k]) save(r, { [k]: v }) }} />
  const Txt = ({ r, k, w = 120, ph }) => <input defaultValue={r[k] || ''} placeholder={ph} style={{ width: w }} onBlur={(e) => e.target.value !== (r[k] || '') && save(r, { [k]: e.target.value || null })} />
  async function add(e) {
    e.preventDefault(); const f = new FormData(e.target)
    const { error } = await supabase.from('shop_products').insert({ title: f.get('title'), retail_price: Number(f.get('retail_price')) || null, supplier_code: f.get('supplier_code') || null, unit_cost: Number(f.get('unit_cost')) || null, setup_cost: Number(f.get('setup_cost')) || 0, min_run: Number(f.get('min_run')) || null, options: textToOpts(f.get('options') || ''), description: f.get('description') || null, image_url: f.get('image_url') || null, source: 'club', status: 'active', sort: Number(f.get('sort')) || 100 })
    setMsg(error ? error.message : 'Product added.'); if (!error) { e.target.reset(); setAdding(false) } load()
  }
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
        <p className="small muted" style={{ marginTop: 0 }}>The range members see in the app. Price is what the member pays (inc GST). Options are typed as <code>Size: S, M, L; Colour: Black, White</code>. Cost, set up, minimum and pre order drive run readiness and margin. Edit a cell and click away to save. Untick Active to hide an item.</p>
        <button className="btn primary" onClick={() => setAdding(!adding)}>{adding ? 'Close' : 'New product'}</button>
      </div>
      {msg && <div className={`alert ${/added/i.test(msg) ? 'ok' : 'err'}`}>{msg}</div>}
      {adding && (
        <form onSubmit={add} className="grid cols-4" style={{ gap: '.5rem', marginBottom: '1rem' }}>
          <label className="f">Title<input name="title" required /></label>
          <label className="f">Price inc GST<input name="retail_price" type="number" step="0.01" required /></label>
          <label className="f">Supplier code<input name="supplier_code" /></label>
          <label className="f">Sort<input name="sort" type="number" defaultValue={100} /></label>
          <label className="f">Unit cost ex GST<input name="unit_cost" type="number" step="0.01" /></label>
          <label className="f">Set up per lot<input name="setup_cost" type="number" step="0.01" defaultValue={0} /></label>
          <label className="f">Lot minimum<input name="min_run" type="number" defaultValue={10} /></label>
          <label className="f">Image URL<input name="image_url" placeholder="https://…" /></label>
          <label className="f" style={{ gridColumn: 'span 2' }}>Options<input name="options" placeholder="Size: S, M, L, XL; Colour: Black, White" /></label>
          <label className="f" style={{ gridColumn: 'span 2' }}>Description<input name="description" /></label>
          <div style={{ gridColumn: 'span 4' }}><button className="btn primary">Add product</button></div>
        </form>
      )}
      <table>
        <thead><tr><th>Active</th><th>Product</th><th>Price inc GST</th><th>Options</th><th>Image URL</th><th>Code</th><th>Unit cost</th><th>Set up</th><th>Lot min</th><th>Pre order</th><th>Target</th><th>Closes</th><th>Stock</th><th>Sort</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ opacity: r.is_active ? 1 : .5 }}>
              <td><input type="checkbox" checked={r.is_active} onChange={(e) => save(r, { is_active: e.target.checked })} /></td>
              <td style={{ minWidth: 180 }}><div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>{r.image_url && <img src={r.image_url} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 6 }} />}<Txt r={r} k="title" w={160} /></div>{r.source === 'shopify' && <span className="pill unknown">Shopify</span>}</td>
              <td><Num r={r} k="retail_price" w={80} /></td>
              <td><input defaultValue={optsToText(r.options)} style={{ width: 210 }} placeholder="Size: S, M, L; Colour: Black" onBlur={(e) => e.target.value !== optsToText(r.options) && save(r, { options: textToOpts(e.target.value) })} /></td>
              <td><Txt r={r} k="image_url" w={140} ph="https://…" /></td>
              <td><Txt r={r} k="supplier_code" w={80} /></td>
              <td><Num r={r} k="unit_cost" w={70} /></td>
              <td><Num r={r} k="setup_cost" w={60} /></td>
              <td><Num r={r} k="min_run" step="1" w={54} /></td>
              <td><input type="checkbox" checked={r.is_preorder} onChange={(e) => save(r, { is_preorder: e.target.checked })} /></td>
              <td><Num r={r} k="preorder_target" step="1" w={54} /></td>
              <td><input type="date" defaultValue={r.preorder_closes || ''} onBlur={(e) => e.target.value !== (r.preorder_closes || '') && save(r, { preorder_closes: e.target.value || null })} /></td>
              <td><Num r={r} k="stock_on_hand" step="1" w={54} /></td>
              <td><Num r={r} k="sort" step="1" w={54} /></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={14} className="muted">No products yet. Add one, or connect Shopify and press Sync now.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
function Settings({ settings, onSaved }) {
  const [log, setLog] = useState([]); const [msg, setMsg] = useState('')
  useEffect(() => { supabase.from('shop_sync_log').select('*').order('ran_at', { ascending: false }).limit(15).then(({ data }) => setLog(data || [])) }, [settings])
  async function save(e) {
    e.preventDefault(); const f = new FormData(e.target)
    const { error } = await supabase.from('shop_settings').update({ store_domain: f.get('store_domain') || null, store_url: f.get('store_url') || null, min_run: Number(f.get('min_run')) || 10, updated_at: new Date().toISOString() }).eq('id', 1)
    setMsg(error ? error.message : 'Saved.'); onSaved()
  }
  const site = window.location.origin
  return (
    <div className="grid cols-2">
      <form className="card" onSubmit={save} style={{ display: 'grid', gap: '.6rem', alignContent: 'start' }}>
        <h2>Shop settings</h2>
        {msg && <div className="alert ok">{msg}</div>}
        <label className="f">Shopify store domain<input name="store_domain" defaultValue={settings?.store_domain || ''} placeholder="wsfc-merch.myshopify.com" /></label>
        <label className="f">Public shop link (shown to members)<input name="store_url" defaultValue={settings?.store_url || ''} placeholder="https://shop.wsfc.co.nz" /></label>
        <label className="f">Minimum units per item per lot<input name="min_run" type="number" defaultValue={settings?.min_run || 10} /></label>
        <button className="btn primary">Save</button>
        <div className="small muted">Last product sync {settings?.last_product_sync_at ? fmtDateTime(settings.last_product_sync_at) : 'never'} · last order sync {settings?.last_order_sync_at ? fmtDateTime(settings.last_order_sync_at) : 'never'}{settings?.last_sync_error ? ` · last error: ${settings.last_sync_error}` : ''}</div>
      </form>
      <div className="card">
        <h2>Online payment (Stripe)</h2>
        <ol className="small" style={{ paddingLeft: '1.2rem', lineHeight: 1.6 }}>
          <li>Open a Stripe account in the club\u2019s name (stripe.com/nz), connect Xero, and add the club\u2019s domain under Payment methods so Apple Pay and Google Pay appear.</li>
          <li>In Netlify add <code>STRIPE_SECRET_KEY</code> (Developers → API keys). Until it is set, members can still order and pay at the bar.</li>
          <li>Stripe → Developers → Webhooks: add <code>{site}/.netlify/functions/stripe-webhook</code> for <code>checkout.session.completed</code> and <code>checkout.session.expired</code>, and put the signing secret in <code>STRIPE_WEBHOOK_SECRET</code>.</li>
        </ol>
        <h2 style={{ marginTop: '1rem' }}>Connecting Shopify (optional web store)</h2>
        <ol className="small" style={{ paddingLeft: '1.2rem', lineHeight: 1.6 }}>
          <li>In Shopify admin: Settings → Apps and sales channels → Develop apps → Create an app (name it WSFC CRM).</li>
          <li>Configure Admin API scopes: <code>read_products</code>, <code>read_orders</code>, <code>read_customers</code>. Install the app and copy the Admin API access token (shown once).</li>
          <li>In Netlify → Site configuration → Environment variables, add <code>SHOPIFY_STORE_DOMAIN</code> and <code>SHOPIFY_ADMIN_TOKEN</code> (and <code>SUPABASE_URL</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code> if not already set). Redeploy.</li>
          <li>Press Sync now above. The scheduled sync then runs every 15 minutes.</li>
          <li>Optional, for instant orders: on the app's Webhooks tab subscribe <code>orders/create</code>, <code>orders/updated</code>, <code>orders/cancelled</code> and <code>products/update</code> to <code>{site}/.netlify/functions/shopify-webhook</code> (JSON), and add the signing secret as <code>SHOPIFY_WEBHOOK_SECRET</code> in Netlify.</li>
          <li>In Shopify set delivery to <b>local pickup</b> at the club only, so members are not offered shipping.</li>
        </ol>
        <h2 style={{ marginTop: '1rem' }}>Sync log</h2>
        {log.map((l) => <div key={l.id} className="small" style={{ color: l.error ? 'var(--warn)' : undefined }}>{fmtDateTime(l.ran_at)} · {l.source} · {l.error ? l.error : `${l.products_upserted} products, ${l.orders_upserted} orders`}</div>)}
        {!log.length && <div className="small muted">No syncs yet.</div>}
      </div>
    </div>
  )
}
