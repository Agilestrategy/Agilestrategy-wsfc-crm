import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'
import { isDemo, demoSubscribe } from '../lib/demo'
import { priceFor } from '../lib/pricing'

// /me/membership: pay the subscription your way. Weekly, fortnightly and monthly carry a 15% premium, quarterly 10%,
// six monthly 5%, annual is the base fee. Prices shown here are worked out the same way as membership_price() in the database;
// the server prices the Stripe session from the database, never from the phone.

const money = (n) => '$' + Number(n || 0).toFixed(2)
const EVERY = { weekly: 'a week', fortnightly: 'a fortnight', monthly: 'a month', quarterly: 'a quarter', six_monthly: 'every six months', annual: 'a year' }
const STATUS = { incomplete: 'Waiting for the first payment', active: 'Active', past_due: 'Payment overdue', paused: 'Paused', cancelled: 'Cancelled' }

export default function Membership({ member, Brand, reload }) {
  const [cats, setCats] = useState(null); const [freqs, setFreqs] = useState([]); const [subs, setSubs] = useState(null)
  const [cat, setCat] = useState(member.category_id || ''); const [freq, setFreq] = useState('annual')
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState('')
  const [params] = useSearchParams()

  const load = () => Promise.all([
    supabase.from('membership_categories').select('id, name, annual_fee, is_family, sort_order').eq('is_active', true).gt('annual_fee', 0).order('sort_order'),
    supabase.from('billing_frequencies').select('*').eq('is_active', true).order('sort'),
    supabase.from('member_subscriptions').select('*').eq('member_id', member.id).order('created_at', { ascending: false }),
  ]).then(([c, f, s]) => { const list = c.data || []; setCats(list); setFreqs(f.data || []); setSubs(s.data || []); setCat((cur) => (list.some((x) => x.id === cur) ? cur : list[0]?.id || '')) })
  useEffect(() => {
    load()
    if (params.get('subscribed')) { setMsg('Thanks, your membership payments are set up.'); let n = 0; const t = setInterval(() => { load(); reload?.(); if (++n >= 6) clearInterval(t) }, 2500); return () => clearInterval(t) }
    if (params.get('cancelled')) setMsg('No problem, nothing was charged.')
  }, [member.id])

  const category = useMemo(() => (cats || []).find((c) => c.id === cat), [cats, cat])
  const current = (subs || []).find((s) => ['active', 'past_due', 'paused'].includes(s.status))

  async function go() {
    setBusy('checkout'); setMsg('')
    try {
      if (isDemo()) { const j = demoSubscribe(cat, freq); window.location.href = j.url; return }
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setMsg('Your sign in has expired. Please sign in again.'); setBusy(''); return }
      const r = await fetch('/.netlify/functions/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action: 'checkout', category_id: cat, frequency: freq }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(j.error || 'Something went wrong.'); setBusy(''); return }
      window.location.href = j.url
    } catch (e) { setMsg(e.message); setBusy('') }
  }
  async function portal() {
    setBusy('portal')
    if (isDemo()) { setMsg('In the live app this opens the Stripe customer portal: change card or bank account, pause or cancel, download receipts.'); setBusy(''); return }
    const { data: { session } } = await supabase.auth.getSession()
    const r = await fetch('/.netlify/functions/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ action: 'portal' }) })
    const j = await r.json().catch(() => ({})); if (j.url) window.location.href = j.url; else { setMsg(j.error || 'Could not open the portal.'); setBusy('') }
  }

  return (
    <>
      <Brand sub="My membership" />
      <div className="me-card">
        <h2>{member.membership_categories?.name || 'Member'}{member.financial_until ? <span className="me-muted" style={{ fontWeight: 400 }}> · paid to {fmtDate(member.financial_until)}</span> : null}</h2>
        {current ? (
          <>
            <p><b>{STATUS[current.status]}</b> · {money(current.instalment)} {EVERY[current.frequency]}{current.current_period_end ? `, next on ${fmtDate(current.current_period_end)}` : ''}</p>
            {current.status === 'past_due' && <p className="me-err">Your last payment did not go through. Update your card or bank details below.</p>}
            {current.cancel_at_period_end && <p className="me-muted">Set to stop at the end of the current period.</p>}
            <button className="me-btn" disabled={!!busy} onClick={portal}>{busy === 'portal' ? 'Opening…' : 'Manage my subscription'}</button>
            <p className="me-muted" style={{ fontSize: '.8rem' }}>Change your card or bank account, switch how often you pay, pause or cancel, and download receipts.</p>
          </>
        ) : (
          <p className="me-muted" style={{ marginTop: 0 }}>Set up your subscription and it renews itself. Pay the year in one go, or spread it out. Cancel any time.</p>
        )}
        {msg && <p className="me-ok">{msg}</p>}
      </div>

      {!current && cats && (
        <div className="me-card">
          <h2>Pay my way</h2>
          {cats.length > 1 && (
            <>
              <div className="me-muted" style={{ fontSize: '.85rem', marginBottom: '.3rem' }}>Membership type</div>
              <div className="shop-chips" style={{ marginBottom: '.7rem' }}>{cats.map((c) => <button key={c.id} type="button" className={`shop-chip ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(c.id)}>{c.name} · {money(c.annual_fee).replace(/\.00$/, '')}</button>)}</div>
            </>
          )}
          {category ? (
            <div className="plan-list">
              {freqs.map((f) => { const p = priceFor(category.annual_fee, f); const on = freq === f.code; return (
                <button type="button" key={f.code} className={`plan ${on ? 'on' : ''}`} onClick={() => setFreq(f.code)}>
                  <span className="plan-radio" aria-hidden="true" />
                  <span className="plan-name">{f.label}{Number(f.premium_pct) > 0 ? <em>+{Number(f.premium_pct)}%</em> : <em className="base">base fee</em>}</span>
                  <b>{money(p.instalment)}</b>
                  <span className="plan-sub">{f.per_year === 1 ? 'once a year' : `${EVERY[f.code]} · ${money(p.year_total)} a year`}</span>
                </button>
              ) })}
            </div>
          ) : <p className="me-muted">No membership types with a fee yet. Ask the office.</p>}
          {category && (
            <>
              <button className="me-btn" disabled={!!busy} onClick={go} style={{ marginTop: '.8rem' }}>{busy === 'checkout' ? 'Opening payment…' : `Set up ${freqs.find((f) => f.code === freq)?.label.toLowerCase() || ''} payments`}</button>
              <p className="me-muted" style={{ fontSize: '.78rem' }}>Card, Apple Pay or Google Pay. The premium on the spread options covers the extra transaction fees so the club is not out of pocket. Paying annually is the cheapest way to belong.</p>
            </>
          )}
        </div>
      )}

      {subs && subs.length > 0 && (
        <div className="me-card">
          <h2>History</h2>
          <ul className="me-list">{subs.map((s) => <li key={s.id}><span>{freqs.find((f) => f.code === s.frequency)?.label || s.frequency} · {money(s.instalment)}</span><span>{fmtDate(s.started_at || s.created_at)}</span><b style={{ fontSize: '.8rem', fontWeight: 600 }}>{STATUS[s.status]}</b></li>)}</ul>
        </div>
      )}
      <div className="me-links"><Link to="/me">Back</Link></div>
    </>
  )
}
