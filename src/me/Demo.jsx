import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isDemo, startDemo, endDemo, resetDemo, checkPin, demoMarkPaid, demoSetTier } from '../lib/demo'
import { fmtDate } from '../lib/supabase'
import './me.css'

// /demo: PIN gate, then the member app runs on sample data.
export default function DemoGate() {
  const [pin, setPin] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  useEffect(() => { document.documentElement.dataset.tier = 'none' }, [])
  async function go(e) {
    e.preventDefault(); setBusy(true); setErr('')
    if (await checkPin(pin)) { resetDemo(); startDemo(); window.location.href = '/me' }
    else { setErr('That PIN is not right.'); setBusy(false) }
  }
  return (
    <div className="me">
      <div className="me-card" style={{ marginTop: '2rem' }}>
        <div className="me-brand"><img src="/wsfc-logo-256.png" alt="" /><div><strong>WSFC Members</strong><span>Demo</span></div></div>
        <p>A walk through of the member app with sample data. Nothing here is real: no real members, no real payments.</p>
        <form onSubmit={go} className="me-form">
          <input type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" placeholder="Demo PIN" value={pin} onChange={(e) => setPin(e.target.value)} required autoFocus />
          {err && <p className="me-err">{err}</p>}
          <button className="me-btn" disabled={busy}>{busy ? 'Opening…' : 'Open the demo'}</button>
        </form>
        <p className="me-muted">You will be signed in as Sam Rangi, a Gold member. Try the check in codes BAR and DOOR, buy some 60th merch, and switch the tier in the bar at the top to see the card change colour.</p>
        <p className="me-muted" style={{ fontSize: '.75rem' }}>Whakatāne Sportfishing Club · built by Agile Strategy</p>
        {isDemo() && <button type="button" className="me-btn ghost" onClick={() => nav('/me')}>Back into the demo</button>}
      </div>
    </div>
  )
}

// Slim bar at the top of every member app page while the demo is running.
export function DemoBanner({ member }) {
  const tier = member?.status_tier || 'silver'
  return (
    <div className="demo-bar">
      <span><b>Demo</b> · sample data</span>
      <span className="demo-tiers">{['silver', 'gold', 'black'].map((t) => <button key={t} type="button" className={tier === t ? 'on' : ''} onClick={() => demoSetTier(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</span>
      <button type="button" className="demo-exit" onClick={() => { endDemo(); window.location.href = '/demo' }}>Exit</button>
    </div>
  )
}

// Stand in for the hosted payment page. Looks the part, charges nothing.
export function DemoPay() {
  const q = new URLSearchParams(window.location.search); const orderId = q.get('order')
  const [order, setOrder] = useState(null); const [busy, setBusy] = useState(false)
  useEffect(() => { try { const db = JSON.parse(localStorage.getItem('wsfc-demo-db') || '{}'); const o = (db.shop_orders || []).find((x) => x.id === orderId); if (o) o.items = (db.shop_order_items || []).filter((i) => i.order_id === o.id); setOrder(o || null) } catch { setOrder(null) } }, [orderId])
  function pay() { setBusy(true); setTimeout(() => { demoMarkPaid(orderId); window.location.href = `/me/orders?paid=${orderId}` }, 1100) }
  if (!order) return <div className="me-card">Order not found. <a href="/me/shop">Back to the shop</a></div>
  return (
    <div className="demo-pay">
      <div className="me-card">
        <div className="demo-pay-head"><span>Whakatāne Sportfishing Club</span><b>Secure payment · demo</b></div>
        <h2 style={{ marginTop: '.6rem' }}>Pay ${Number(order.total).toFixed(2)}</h2>
        <ul className="me-list">{order.items.map((i) => <li key={i.id}><span>{i.quantity} × {i.title}{i.variant_title ? ` (${i.variant_title})` : ''}</span><span>${(i.price * i.quantity).toFixed(2)}</span><b></b></li>)}</ul>
        <button type="button" className="demo-wallet" disabled={busy} onClick={pay}>{busy ? 'Processing…' : 'Pay with wallet'}</button>
        <div className="demo-or">or pay with card</div>
        <div className="me-form">
          <input value="4242 4242 4242 4242" readOnly /><div className="me-grid"><input value="12 / 29" readOnly /><input value="123" readOnly /></div>
          <input value={order.email} readOnly />
          <button type="button" className="me-btn" disabled={busy} onClick={pay}>{busy ? 'Processing…' : `Pay $${Number(order.total).toFixed(2)}`}</button>
          <a className="me-btn ghost" href={`/me/shop?cancelled=${orderId}`}>Cancel and go back</a>
        </div>
        <p className="me-muted" style={{ fontSize: '.75rem' }}>Demo only. In the live app this step is Stripe Checkout with Apple Pay, Google Pay and card. Order {order.order_number} · {fmtDate(order.shopify_created_at)}</p>
      </div>
    </div>
  )
}
