import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isDemo, demoPlaceOrder } from '../lib/demo'
import { TIER_RANK, TIER_LABEL, memberPrice } from '../lib/pricing'

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
  const [settings, setSettings] = useState(null)
  const tier = member?.status_tier || null
  const discount = settings ? (tier === 'black' ? Number(settings.discount_black) : tier === 'gold' ? Number(settings.discount_gold) : 0) : 0
  const locked = (p) => p.min_tier && (TIER_RANK[tier] || 0) < (TIER_RANK[p.min_tier] || 0)
  const [params] = useSearchParams()
  const pickerRef = useRef(null)
  const [cartSeen, setCartSeen] = useState(false)

  useEffect(() => {
    supabase.from('shop_products').select('id, title, description, retail_price, options, image_url, is_preorder, preorder_target, lead_time, sort, min_tier, is_limited')
      .eq('is_active', true).not('retail_price', 'is', null).order('sort').then(({ data }) => setProducts(data || []))
    supabase.from('shop_settings').select('discount_gold, discount_black').eq('id', 1).maybeSingle().then(({ data }) => setSettings(data || { discount_gold: 10, discount_black: 25 }))
    if (params.get('cancelled')) setMsg('Payment was cancelled. Your items are still in the cart.')
  }, [])
  useEffect(() => { saveCart(cart) }, [cart])
  useEffect(() => {
    const el = document.getElementById('cart'); if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([e]) => setCartSeen(e.isIntersecting), { threshold: 0.15 }); io.observe(el); return () => io.disconnect()
  }, [products])

  const linePrice = (l) => memberPrice(l.price, discount)
  const listTotal = useMemo(() => cart.reduce((a, l) => a + l.price * l.quantity, 0), [cart])
  const total = useMemo(() => cart.reduce((a, l) => a + linePrice(l) * l.quantity, 0), [cart, discount])
  const count = cart.reduce((a, l) => a + l.quantity, 0)

  function startAdd(p) {
    if (locked(p)) { setOpen(null); setMsg(`${p.title} is for ${TIER_LABEL[p.min_tier]} members. Keep checking in to climb the tiers and unlock it.`); return }
    setOpen(p); setPick({}); setQty(1); setMsg(''); setTimeout(() => pickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }
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
      if (isDemo()) {
        const j = demoPlaceOrder(cart.map((l) => ({ product_id: l.product_id, quantity: l.quantity, options: l.options })), pay)
        if (j.url) { window.location.href = j.url; return }
        setCart([]); window.location.href = `/me/orders?placed=${j.order_id}`; return
      }
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setMsg('Your sign in has expired. Please sign in again.'); setBusy(''); return }
      const r = await fetch('/.netlify/functions/shop-order', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ items: cart.map((l) => ({ product_id: l.product_id, quantity: l.quantity, options: l.options })), pay }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { if (/not switched on/.test(j.error || '')) setStripeOn(false); setMsg(j.error || 'Something went wrong.'); setBusy(''); return }
      if (j.url) { window.location.href = j.url; return }   // cart is cleared on the orders page once payment succeeds
      setCart([])
      window.location.href = `/me/orders?placed=${j.order_id}`
    } catch (e) { setMsg(e.message); setBusy('') }
  }

  return (
    <>
      <Brand sub="60th anniversary merchandise" />
      <div className="me-card">
        <p className="me-muted" style={{ marginTop: 0 }}>Order here, pay with Apple Pay, Google Pay or card, or pay at the bar. Orders go to production every Friday and you collect at the club. Prices include GST.</p>
        {settings && (discount > 0
          ? <p className="shop-perk">{TIER_LABEL[tier]} member: <b>{discount}% off</b> everything in the range{tier === 'gold' ? `, ${Number(settings.discount_black)}% at Black` : ', plus the limited range'}.</p>
          : <p className="shop-perk">Gold members get {Number(settings.discount_gold)}% off, Black members {Number(settings.discount_black)}% off and the limited range. Check in at the bar to climb.</p>)}
      </div>
      {msg && <div className="me-card"><p className="me-ok" style={{ margin: 0 }}>{msg}</p></div>}

      {open && (
        <div ref={pickerRef} className="me-card" style={{ border: '2px solid var(--me-accent)', scrollMarginTop: '.5rem' }}>
          <h2>{open.title} <span className="me-muted" style={{ fontWeight: 400 }}>{discount > 0 ? <><s>{money(open.retail_price)}</s> {money(memberPrice(open.retail_price, discount))}</> : money(open.retail_price)}</span></h2>
          {open.description && <p className="me-muted">{open.description}</p>}
          {Object.entries(open.options || {}).map(([k, vals]) => Array.isArray(vals) && vals.length ? (
            <div key={k} style={{ margin: '.5rem 0' }}>
              <div className="me-muted" style={{ fontSize: '.85rem', marginBottom: '.3rem' }}>{k}</div>
              <div className="shop-chips">{vals.map((v) => <button key={v} type="button" className={`shop-chip ${pick[k] === v ? 'on' : ''}`} onClick={() => setPick({ ...pick, [k]: v })}>{v}</button>)}</div>
            </div>
          ) : null)}
          <div className="me-row" style={{ alignItems: 'center', marginTop: '.5rem', flexWrap: 'wrap' }}>
            <div className="shop-qty"><button type="button" onClick={() => setQty(Math.max(1, qty - 1))}>−</button><span>{qty}</span><button type="button" onClick={() => setQty(Math.min(20, qty + 1))}>+</button></div>
            <button className="me-btn" type="button" onClick={confirmAdd}>Add to cart</button>
            <button className="me-btn ghost" type="button" onClick={() => setOpen(null)}>Cancel</button>
          </div>
        </div>
      )}

      {products === null ? <div className="me-card">Loading the range…</div> : products.length === 0 ? <div className="me-card"><p className="me-muted">The range is being loaded. Check back soon.</p></div> : (
        <div className="shop-grid">
          {products.map((p) => (
            <button key={p.id} type="button" className={`shop-tile ${locked(p) ? 'locked' : ''}`} onClick={() => startAdd(p)} aria-disabled={locked(p)}>
              {p.image_url ? <img src={p.image_url} alt="" /> : <div className="shop-ph">{p.title.slice(0, 1)}</div>}
              {(p.is_limited || p.min_tier) && <span className={`shop-badge ${locked(p) ? 'lock' : ''}`}>{locked(p) ? `${TIER_LABEL[p.min_tier]} only` : p.is_limited ? 'Limited' : `${TIER_LABEL[p.min_tier]} range`}</span>}
              <div className="shop-tile-body">
                <b>{p.title}</b>
                <span>{discount > 0 && !locked(p) ? <><s>{money(p.retail_price)}</s> {money(memberPrice(p.retail_price, discount))}</> : money(p.retail_price)}</span>
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
              {cart.map((l, i) => <li key={i}><span>{l.quantity} × {l.title}{l.variant ? ` (${l.variant})` : ''}</span><span>{money(linePrice(l) * l.quantity)}</span><b><button type="button" className="shop-x" onClick={() => remove(i)} aria-label="Remove">×</button></b></li>)}
            </ul>
            {discount > 0 && <p className="me-muted" style={{ display: 'flex', justifyContent: 'space-between', margin: 0 }}><span>{TIER_LABEL[tier]} member discount ({discount}%)</span><span>−{money(listTotal - total)}</span></p>}
            <p style={{ display: 'flex', justifyContent: 'space-between' }}><b>Total</b><b>{money(total)}</b></p>
            {stripeOn && <button className="me-btn" disabled={!!busy} onClick={() => checkout('stripe')}>{busy === 'stripe' ? 'Opening payment…' : 'Pay now (Apple Pay, Google Pay, card)'}</button>}
            <button className="me-btn ghost" disabled={!!busy} onClick={() => checkout('at_club')} style={{ marginTop: '.4rem' }}>{busy === 'at_club' ? 'Placing order…' : 'Order now, pay at the bar'}</button>
            <p className="me-muted" style={{ fontSize: '.8rem' }}>Pay at the bar orders go into production once paid. {member?.first_name ? `We will hold it under ${member.first_name} ${member.last_name || ''}.` : ''}</p>
          </>
        )}
      </div>
      <div className="me-links"><Link to="/me/orders">My orders</Link><Link to="/me">Back</Link></div>
      {count > 0 && !open && !cartSeen && (<>
        <div className="shop-bar-space" />
        <button type="button" className="shop-bar" onClick={() => document.getElementById('cart')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <span>{count} item{count === 1 ? '' : 's'} in your cart</span><b>{money(total)} · View cart</b>
        </button>
      </>)}
    </>
  )
}
