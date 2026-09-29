import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const money = (n) => '$' + Number(n || 0).toFixed(2).replace(/\.00$/, '')
const CART_KEY = 'wsfc-cart'
const loadCart = () => { try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]') } catch { return [] } }
const saveCart = (c) => { try { localStorage.setItem(CART_KEY, JSON.stringify(c)) } catch { /* private mode */ } }

export default function Shop({ member, Brand }) {
  const [products, setProducts] = useState(null)
  const [cart, setCart] = useState(loadCart)
  const [open, setOpen] = useState(null)      // product being configured
  const [pick, setPick] = useState({})        // chosen options for `open`
  const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [stripeOn, setStripeOn] = useState(true)
  const [params] = useSearchParams()

  useEffect(() => {
    supabase.from('shop_products').select('id, title, description, retail_price, options, image_url, is_preorder, preorder_target, lead_time, sort')
      .eq('is_active', true).not('retail_price', 'is', null).order('sort').then(({ data }) => setProducts(data || []))
    supabase.from('shop_settings').select('store_url').eq('id', 1).maybeSingle().then(() => {})
    if (params.get('cancelled')) setMsg('Payment was cancelled. Your items are still in the cart.')
  }, [])
  useEffect(() => { saveCart(cart) }, [cart])

  const total = useMemo(() => cart.reduce((a, l) => a + l.price * l.quantity, 0), [cart])
  const count = cart.reduce((a, l) => a + l.quantity, 0)

  function startAdd(p) { setOpen(p); setPick({}); setQty(1); setMsg('') }
  function confirmAdd() {
    const p = open; const opts = p.options || {}
    for (const k of Object.keys(opts)) if (Array.isArray(opts[k]) && opts[k].length && !pick[k]) { setMsg(`Choose a ${k.toLowerCase()}.`); return }
    const variant = Object.keys(opts).map((k) => pick[k]).filter(Boolean).join(' / ')
    setCart((c) => {
      const i = c.findIndex((l) => l.product_id === p.id && l.variant === variant)
      if (i >= 0) { const n = [...c]; n[i] = { ...n[i], quantity: Math.min(20, n[i].quantity + qty) }; return n }
      return [...c, { product_id: p.id, title: p.title, variant, options: pick, price: Number(p.retail_price), quantity: qty }]
    })
    setOpen(null); setMsg(`${p.title} added.`)
  }
  function remove(i) { setCart((c) => c.filter((_, j) => j !== i)) }

  async function checkout(pay) {
    setBusy(pay); setMsg('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/.netlify/functions/shop-order', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ items: cart.map((l) => ({ product_id: l.product_id, quantity: l.quantity, options: l.options })), pay }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { if (/not switched on/.test(j.error || '')) setStripeOn(false); setMsg(j.error || 'Something went wrong.'); setBusy(''); return }
      setCart([])
      if (j.url) { window.location.href = j.url; return }
      window.location.href = `/me/orders?placed=${j.order_id}`
    } catch (e) { setMsg(e.message); setBusy('') }
  }

  return (
    <>
      <Brand sub="60th anniversary merchandise" />
      <div className="me-card">
        <p className="me-muted" style={{ marginTop: 0 }}>Order here, pay with Apple Pay, Google Pay or card, or pay at the bar. Orders go to production every Friday and you collect at the club. Prices include GST.</p>
      </div>
      {msg && <div className="me-card"><p className="me-ok" style={{ margin: 0 }}>{msg}</p></div>}

      {open && (
        <div className="me-card" style={{ border: '2px solid var(--me-accent)' }}>
          <h2>{open.title} <span className="me-muted" style={{ fontWeight: 400 }}>{money(open.retail_price)}</span></h2>
          {open.description && <p className="me-muted">{open.description}</p>}
          {Object.entries(open.options || {}).map(([k, vals]) => Array.isArray(vals) && vals.length ? (
            <div key={k} style={{ margin: '.5rem 0' }}>
              <div className="me-muted" style={{ fontSize: '.85rem', marginBottom: '.3rem' }}>{k}</div>
              <div className="shop-chips">{vals.map((v) => <button key={v} type="button" className={`shop-chip ${pick[k] === v ? 'on' : ''}`} onClick={() => setPick({ ...pick, [k]: v })}>{v}</button>)}</div>
            </div>
          ) : null)}
          <div className="me-row" style={{ alignItems: 'center', marginTop: '.5rem' }}>
            <div className="shop-qty"><button type="button" onClick={() => setQty(Math.max(1, qty - 1))}>−</button><span>{qty}</span><button type="button" onClick={() => setQty(Math.min(20, qty + 1))}>+</button></div>
            <button className="me-btn" type="button" onClick={confirmAdd}>Add to cart</button>
            <button className="me-btn ghost" type="button" onClick={() => setOpen(null)}>Cancel</button>
          </div>
        </div>
      )}

      {products === null ? <div className="me-card">Loading the range…</div> : products.length === 0 ? <div className="me-card"><p className="me-muted">The range is being loaded. Check back soon.</p></div> : (
        <div className="shop-grid">
          {products.map((p) => (
            <button key={p.id} type="button" className="shop-tile" onClick={() => startAdd(p)}>
              {p.image_url ? <img src={p.image_url} alt="" /> : <div className="shop-ph">{p.title.slice(0, 1)}</div>}
              <div className="shop-tile-body">
                <b>{p.title}</b>
                <span>{money(p.retail_price)}</span>
                {p.is_preorder && <em>Pre order</em>}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="me-card" id="cart">
        <h2>Your cart {count ? <span className="me-muted" style={{ fontWeight: 400 }}>({count} item{count === 1 ? '' : 's'})</span> : null}</h2>
        {cart.length === 0 ? <p className="me-muted">Nothing yet. Tap an item above.</p> : (
          <>
            <ul className="me-list">
              {cart.map((l, i) => <li key={i}><span>{l.quantity} × {l.title}{l.variant ? ` (${l.variant})` : ''}</span><span>{money(l.price * l.quantity)}</span><b><button type="button" className="shop-x" onClick={() => remove(i)} aria-label="Remove">×</button></b></li>)}
            </ul>
            <p style={{ display: 'flex', justifyContent: 'space-between' }}><b>Total</b><b>{money(total)}</b></p>
            {stripeOn && <button className="me-btn" disabled={!!busy} onClick={() => checkout('stripe')}>{busy === 'stripe' ? 'Opening payment…' : 'Pay now (Apple Pay, Google Pay, card)'}</button>}
            <button className="me-btn ghost" disabled={!!busy} onClick={() => checkout('at_club')} style={{ marginTop: '.4rem' }}>{busy === 'at_club' ? 'Placing order…' : 'Order now, pay at the bar'}</button>
            <p className="me-muted" style={{ fontSize: '.8rem' }}>Pay at the bar orders go into production once paid. {member?.first_name ? `We will hold it under ${member.first_name} ${member.last_name || ''}.` : ''}</p>
          </>
        )}
      </div>
      <div className="me-links"><Link to="/me/orders">My orders</Link><Link to="/me">Back</Link></div>
    </>
  )
}
