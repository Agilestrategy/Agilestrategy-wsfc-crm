import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'
import { priceFor } from '../lib/pricing'

// Subscriptions console: the fee table members see in the app (annual fee per category, premium per frequency),
// what each option costs, and the live Stripe subscriptions.

const money = (n) => (n == null ? '–' : '$' + Number(n).toFixed(2))
const STATUS = { incomplete: 'pending', active: 'active', past_due: 'lapsed', paused: 'pending', cancelled: 'cancelled' }

export default function Subscriptions() {
  const nav = useNavigate()
  const [cats, setCats] = useState([]); const [freqs, setFreqs] = useState([]); const [subs, setSubs] = useState([]); const [sum, setSum] = useState([])
  const [msg, setMsg] = useState(''); const [tab, setTab] = useState('live')
  const load = async () => {
    const [c, f, s, m] = await Promise.all([
      supabase.from('membership_categories').select('*').order('sort_order'),
      supabase.from('billing_frequencies').select('*').order('sort'),
      supabase.from('member_subscriptions').select('*, members(full_name, member_number, email), membership_categories(name)').order('created_at', { ascending: false }).limit(500),
      supabase.from('v_subscriptions_summary').select('*'),
    ])
    setCats(c.data || []); setFreqs(f.data || []); setSubs(s.data || []); setSum(m.data || [])
  }
  useEffect(() => { load() }, [])

  async function saveFee(id, v) { const { error } = await supabase.from('membership_categories').update({ annual_fee: v === '' ? null : Number(v) }).eq('id', id); setMsg(error ? error.message : 'Fee saved.'); load() }
  async function savePremium(code, v) { const { error } = await supabase.from('billing_frequencies').update({ premium_pct: Number(v) || 0 }).eq('code', code); setMsg(error ? error.message : 'Premium saved.'); load() }
  async function toggleFreq(code, on) { await supabase.from('billing_frequencies').update({ is_active: on }).eq('code', code); load() }

  const active = subs.filter((s) => s.status === 'active'); const pastDue = subs.filter((s) => s.status === 'past_due')
  const annualised = sum.reduce((a, r) => a + Number(r.annualised || 0), 0)

  return (
    <>
      <div className="page-head"><div><h1>Subscriptions</h1><p>Members pay their way in the app: weekly, fortnightly and monthly at +15%, quarterly +10%, six monthly +5%, annual at the base fee.</p></div></div>
      {msg && <div className="alert">{msg}</div>}
      <div className="grid cols-4" style={{ marginBottom: '1rem' }}>
        <div className="card stat navy"><div className="n">{active.length}</div><div className="l">Active subscriptions</div></div>
        <div className="card stat"><div className="n">{money(annualised).replace(/\.00$/, '')}</div><div className="l">Annualised subscription income</div></div>
        <div className="card stat gold"><div className="n">{pastDue.length}</div><div className="l">Payment overdue</div><div className="s">Stripe retries, the member is told in the app</div></div>
        <div className="card stat"><div className="n">{subs.filter((s) => s.status === 'incomplete').length}</div><div className="l">Started, not paid</div><div className="s">abandoned checkouts</div></div>
      </div>
      <div className="tabs">{[['live', 'Live subscriptions'], ['fees', 'Fees and premiums'], ['setup', 'Stripe set up']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === 'live' && (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Member</th><th>Category</th><th>Frequency</th><th>Instalment</th><th>Status</th><th>Next payment</th><th>Started</th></tr></thead>
            <tbody>
              {subs.map((s) => <tr key={s.id} className="row" onClick={() => nav(`/members/${s.member_id}`)}>
                <td><b>{s.members?.full_name || '–'}</b>{s.members?.member_number && <div className="small muted">#{s.members.member_number}</div>}</td>
                <td>{s.membership_categories?.name || '–'}</td><td>{freqs.find((f) => f.code === s.frequency)?.label || s.frequency}<div className="small muted">+{Number(s.premium_pct)}%</div></td>
                <td>{money(s.instalment)}</td><td><span className={`pill ${STATUS[s.status]}`}>{s.status.replace('_', ' ')}</span>{s.cancel_at_period_end && <div className="small muted">ends at period end</div>}</td>
                <td className="small">{fmtDate(s.current_period_end)}</td><td className="small">{fmtDate(s.started_at || s.created_at)}</td>
              </tr>)}
              {subs.length === 0 && <tr><td colSpan={7} className="muted">No subscriptions yet. Members set them up from My membership in the app.</td></tr>}
            </tbody>
          </table>
          <div style={{ marginTop: '.8rem' }}>
            {sum.length > 0 && <table><thead><tr><th>Frequency</th><th>Premium</th><th>Active</th><th>Overdue</th><th>Annualised</th></tr></thead><tbody>{sum.map((r) => <tr key={r.frequency}><td>{r.label}</td><td>+{Number(r.premium_pct)}%</td><td>{r.active}</td><td>{r.past_due}</td><td>{money(r.annualised)}</td></tr>)}</tbody></table>}
          </div>
        </div>
      )}

      {tab === 'fees' && (
        <div className="grid cols-2">
          <div className="card">
            <h2>Annual fee by category</h2>
            <p className="small muted">The base fee members see for the annual option. Categories without a fee do not show in the app.</p>
            <table><thead><tr><th>Category</th><th>Code</th><th>Annual fee</th><th>In app</th></tr></thead>
              <tbody>{cats.map((c) => <tr key={c.id}><td><b>{c.name}</b></td><td className="small muted">{c.code}</td>
                <td><input type="number" step="1" min="0" defaultValue={c.annual_fee ?? ''} style={{ width: 90 }} onBlur={(e) => { if (String(c.annual_fee ?? '') !== e.target.value) saveFee(c.id, e.target.value) }} /></td>
                <td>{c.annual_fee != null && c.is_active ? <span className="pill active">yes</span> : <span className="muted small">no fee</span>}</td></tr>)}</tbody></table>
          </div>
          <div className="card">
            <h2>Premium by frequency</h2>
            <p className="small muted">The premium covers the extra Stripe fees on small, frequent payments so the club is never worse off than the annual fee.</p>
            <table><thead><tr><th>Frequency</th><th>Payments a year</th><th>Premium %</th><th>Offered</th></tr></thead>
              <tbody>{freqs.map((f) => <tr key={f.code}><td><b>{f.label}</b></td><td>{f.per_year}</td>
                <td><input type="number" step="0.5" min="0" max="50" defaultValue={f.premium_pct} style={{ width: 80 }} onBlur={(e) => { if (String(f.premium_pct) !== e.target.value) savePremium(f.code, e.target.value) }} /></td>
                <td><input type="checkbox" checked={f.is_active} onChange={(e) => toggleFreq(f.code, e.target.checked)} /></td></tr>)}</tbody></table>
            <h2 style={{ marginTop: '1.2rem' }}>What members see</h2>
            <div className="table-wrap"><table><thead><tr><th>Category</th>{freqs.filter((f) => f.is_active).map((f) => <th key={f.code}>{f.label}</th>)}</tr></thead>
              <tbody>{cats.filter((c) => c.annual_fee != null).map((c) => <tr key={c.id}><td><b>{c.name}</b></td>{freqs.filter((f) => f.is_active).map((f) => { const p = priceFor(c.annual_fee, f); return <td key={f.code}>{money(p.instalment)}<div className="small muted">{money(p.year_total)}/yr</div></td> })}</tr>)}</tbody></table></div>
          </div>
        </div>
      )}

      {tab === 'setup' && (
        <div className="card">
          <h2>Stripe set up for subscriptions</h2>
          <ol className="small" style={{ lineHeight: 1.7 }}>
            <li>Same Stripe account as the shop. Netlify env: <code>STRIPE_SECRET_KEY</code>, <code>STRIPE_WEBHOOK_SECRET</code>, <code>SUPABASE_URL</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>.</li>
            <li>Webhook <code>/.netlify/functions/stripe-webhook</code> also needs these events: <code>invoice.paid</code>, <code>invoice.payment_failed</code>, <code>customer.subscription.updated</code>, <code>customer.subscription.deleted</code> (plus the two checkout events already there).</li>
            <li>Turn on the Customer Portal in Stripe (Settings, Billing, Customer portal) so Manage my subscription works: allow updating payment method, cancelling, and viewing invoices. Switching plans is done by cancelling and setting up again in the app.</li>
            <li>Bank account debit (1% capped at $4, better than cards for annual): enable NZ bank account in Stripe payment methods, then set Netlify env <code>STRIPE_PAYMENT_METHODS=card,nz_bank_account</code>.</li>
            <li>Every paid invoice extends the member's financial until date to the end of the period paid, so renewals from the app need no manual entry. Xero picks the payouts up from the Stripe feed.</li>
          </ol>
        </div>
      )}
    </>
  )
}
