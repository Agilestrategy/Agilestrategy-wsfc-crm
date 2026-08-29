import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { supabase, fmtDate, fmtDateTime } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const FIELDS = [
  ['member_number', 'Member no.'], ['first_name', 'First name'], ['last_name', 'Last name'], ['preferred_name', 'Preferred name'],
  ['email', 'Email', 'email'], ['mobile', 'Mobile', 'tel'], ['phone', 'Phone', 'tel'], ['date_of_birth', 'Date of birth', 'date'],
  ['address_line1', 'Address'], ['address_line2', 'Address 2'], ['suburb', 'Suburb'], ['city', 'City'], ['postcode', 'Postcode'],
  ['joined_on', 'Joined', 'date'], ['financial_until', 'Financial until', 'date'], ['lapsed_on', 'Lapsed on', 'date'],
  ['boat_name', 'Boat'], ['occupation', 'Occupation'], ['employer', 'Employer'],
]
const STATUSES = ['active', 'lapsed', 'expired', 'pending', 'cancelled', 'unknown']
const ESTATUS = ['unknown', 'subscribed', 'unsubscribed', 'cleaned', 'nonsubscribed']
const ETYPES = ['swipe_bar', 'swipe_door', 'swipe_gaming', 'event', 'volunteer', 'referral', 'renewal_on_time', 'other']
const POINTS = { swipe_bar: 10, swipe_door: 10, swipe_gaming: 0, event: 25, volunteer: 50, referral: 200, renewal_on_time: 50, other: 0 }

export default function MemberDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { staff } = useAuth()
  const [m, setM] = useState(null)
  const [cats, setCats] = useState([])
  const [tab, setTab] = useState('profile')
  const [msg, setMsg] = useState('')
  const [notes, setNotes] = useState([])
  const [eng, setEng] = useState([])
  const [subs, setSubs] = useState([])
  const [tags, setTags] = useState([]); const [allTags, setAllTags] = useState([])
  const [contacts, setContacts] = useState([])

  const load = async () => {
    const { data } = await supabase.from('members').select('*').eq('id', id).single()
    setM(data)
    const [n, e, s, t, at, c] = await Promise.all([
      supabase.from('interactions').select('*').eq('member_id', id).order('created_at', { ascending: false }),
      supabase.from('engagements').select('*').eq('member_id', id).order('occurred_at', { ascending: false }).limit(100),
      supabase.from('subscriptions').select('*, membership_categories(name)').eq('member_id', id).order('season', { ascending: false }),
      supabase.from('member_tags').select('tag_id, tags(id,name,colour)').eq('member_id', id),
      supabase.from('tags').select('*').order('name'),
      supabase.from('email_contacts').select('*').eq('member_id', id),
    ])
    setNotes(n.data || []); setEng(e.data || []); setSubs(s.data || []); setTags((t.data || []).map(r => r.tags)); setAllTags(at.data || []); setContacts(c.data || [])
  }
  useEffect(() => { load(); supabase.from('membership_categories').select('id,name').order('sort_order').then(({ data }) => setCats(data || [])) }, [id])

  const upd = (k, v) => setM(x => ({ ...x, [k]: v === '' ? null : v }))

  async function save() {
    const { full_name, created_at, updated_at, ...rest } = m
    const { error } = await supabase.from('members').update(rest).eq('id', id)
    setMsg(error ? 'Error: ' + error.message : 'Saved.'); setTimeout(() => setMsg(''), 2500)
  }
  async function remove() {
    if (!confirm('Delete this member record? This cannot be undone.')) return
    await supabase.from('members').delete().eq('id', id); nav('/members')
  }
  async function addNote(e) {
    e.preventDefault(); const f = new FormData(e.target)
    await supabase.from('interactions').insert({ member_id: id, kind: f.get('kind'), body: f.get('body'), created_by: staff?.email })
    e.target.reset(); load()
  }
  async function addEng(e) {
    e.preventDefault(); const f = new FormData(e.target); const type = f.get('type')
    await supabase.from('engagements').insert({ member_id: id, type, occurred_at: f.get('when') || new Date().toISOString(), points: POINTS[type], source: 'manual', reference: f.get('ref') || null })
    e.target.reset(); load()
  }
  async function addSub(e) {
    e.preventDefault(); const f = new FormData(e.target)
    const { error } = await supabase.from('subscriptions').upsert({ member_id: id, season: f.get('season'), category_id: f.get('category_id') || null, amount: f.get('amount') || null, paid_on: f.get('paid_on') || null, expires_on: f.get('expires_on') || null, status: 'paid' }, { onConflict: 'member_id,season' })
    if (!error && f.get('expires_on')) { await supabase.from('members').update({ financial_until: f.get('expires_on'), status: 'active' }).eq('id', id) }
    e.target.reset(); load()
  }
  async function toggleTag(t) {
    const has = tags.some(x => x.id === t.id)
    if (has) await supabase.from('member_tags').delete().match({ member_id: id, tag_id: t.id })
    else await supabase.from('member_tags').insert({ member_id: id, tag_id: t.id })
    load()
  }

  if (!m) return <p className="muted">Loading…</p>
  const points90 = eng.filter(e => new Date(e.occurred_at) > Date.now() - 90 * 864e5).reduce((a, e) => a + e.points, 0)

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small"><Link to="/members">← Members</Link></div>
          <h1>{m.full_name || '(no name)'} <span className={`pill ${m.status}`}>{m.status}</span></h1>
          <p>{cats.find(c => c.id === m.category_id)?.name || 'No category'} · {m.email || 'no email'} · source: {m.source || '–'}</p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          {msg && <span className={msg.startsWith('Error') ? 'muted' : 'muted'}>{msg}</span>}
          <button className="btn ghost" onClick={remove}>Delete</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      </div>

      <div className="tabs">
        {[['profile', 'Profile'], ['subs', `Subscriptions (${subs.length})`], ['eng', `Engagement (${eng.length})`], ['notes', `Notes (${notes.length})`], ['data', 'Data']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="grid cols-2">
          <div className="card">
            <h2>Details</h2>
            <div className="grid cols-2">
              {FIELDS.map(([k, l, t]) => (
                <label className="f" key={k}>{l}<input type={t || 'text'} value={m[k] ?? ''} onChange={e => upd(k, e.target.value)} /></label>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gap: '1rem', alignContent: 'start' }}>
            <div className="card">
              <h2>Membership</h2>
              <div className="grid cols-2">
                <label className="f">Status<select value={m.status} onChange={e => upd('status', e.target.value)}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
                <label className="f">Category<select value={m.category_id ?? ''} onChange={e => upd('category_id', e.target.value)}><option value="">–</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label className="f">Email status<select value={m.email_status} onChange={e => upd('email_status', e.target.value)}>{ESTATUS.map(s => <option key={s}>{s}</option>)}</select></label>
                <label className="f">Do not contact<select value={m.do_not_contact ? '1' : ''} onChange={e => setM(x => ({ ...x, do_not_contact: e.target.value === '1' }))}><option value="">No</option><option value="1">Yes</option></select></label>
              </div>
              <label className="f" style={{ marginTop: '.75rem' }}>Notes<textarea value={m.notes ?? ''} onChange={e => upd('notes', e.target.value)} /></label>
            </div>
            <div className="card">
              <h2>Tags</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
                {allTags.map(t => { const on = tags.some(x => x.id === t.id); return <button key={t.id} className="pill" onClick={() => toggleTag(t)} style={{ cursor: 'pointer', border: '1px solid ' + (t.colour || '#ccc'), background: on ? (t.colour || '#333') : '#fff', color: on ? '#fff' : (t.colour || '#333') }}>{t.name}</button> })}
              </div>
            </div>
            <div className="card">
              <h2>Status programme</h2>
              <div className="kv"><dt>Points, last 90 days</dt><dd><b>{points90}</b></dd><dt>Engagements, 90 days</dt><dd>{eng.filter(e => new Date(e.occurred_at) > Date.now() - 90 * 864e5).length}</dd></div>
              <p className="small muted">Black / Gold / Silver tiering lands once card feeds are connected.</p>
            </div>
          </div>
        </div>
      )}

      {tab === 'subs' && (
        <div className="grid cols-2">
          <div className="card">
            <h2>Renewal history</h2>
            <table><thead><tr><th>Season</th><th>Category</th><th>Amount</th><th>Paid</th><th>Expires</th><th>Status</th></tr></thead>
              <tbody>{subs.map(s => <tr key={s.id}><td>{s.season}</td><td>{s.membership_categories?.name}</td><td>{s.amount}</td><td>{fmtDate(s.paid_on)}</td><td>{fmtDate(s.expires_on)}</td><td>{s.status}</td></tr>)}
                {subs.length === 0 && <tr><td colSpan={6} className="muted">No subscriptions recorded.</td></tr>}</tbody></table>
          </div>
          <form className="card" onSubmit={addSub} style={{ display: 'grid', gap: '.6rem', alignContent: 'start' }}>
            <h2>Record a renewal</h2>
            <label className="f">Season<input name="season" required placeholder="2026-27" /></label>
            <label className="f">Category<select name="category_id" defaultValue={m.category_id ?? ''}><option value="">–</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="f">Amount<input name="amount" type="number" step="0.01" /></label>
            <label className="f">Paid on<input name="paid_on" type="date" /></label>
            <label className="f">Expires on<input name="expires_on" type="date" /></label>
            <button className="btn">Save renewal (sets member active)</button>
          </form>
        </div>
      )}

      {tab === 'eng' && (
        <div className="grid cols-2">
          <div className="card">
            <h2>Engagement log</h2>
            <table><thead><tr><th>When</th><th>Type</th><th>Points</th><th>Source</th></tr></thead>
              <tbody>{eng.map(e => <tr key={e.id}><td>{fmtDateTime(e.occurred_at)}</td><td>{e.type}</td><td>{e.points}</td><td>{e.source}{e.reference ? ` · ${e.reference}` : ''}</td></tr>)}
                {eng.length === 0 && <tr><td colSpan={4} className="muted">No engagements yet.</td></tr>}</tbody></table>
          </div>
          <form className="card" onSubmit={addEng} style={{ display: 'grid', gap: '.6rem', alignContent: 'start' }}>
            <h2>Log an engagement</h2>
            <label className="f">Type<select name="type">{ETYPES.map(t => <option key={t} value={t}>{t} ({POINTS[t]} pts)</option>)}</select></label>
            <label className="f">When<input name="when" type="datetime-local" /></label>
            <label className="f">Reference<input name="ref" placeholder="event name, receipt, etc." /></label>
            <button className="btn">Add</button>
            <p className="small muted">Gaming-floor swipes are recorded for the audit trail but earn no points.</p>
          </form>
        </div>
      )}

      {tab === 'notes' && (
        <div className="grid cols-2">
          <div className="card">
            <h2>Notes and contact</h2>
            <ul className="timeline">{notes.map(n => <li key={n.id}><span className="pill">{n.kind}</span> <span className="small muted">{fmtDateTime(n.created_at)} · {n.created_by}</span><div>{n.body}</div></li>)}
              {notes.length === 0 && <li className="muted">Nothing logged.</li>}</ul>
          </div>
          <form className="card" onSubmit={addNote} style={{ display: 'grid', gap: '.6rem', alignContent: 'start' }}>
            <h2>Add</h2>
            <label className="f">Kind<select name="kind">{['note', 'call', 'email', 'sms', 'visit', 'task'].map(k => <option key={k}>{k}</option>)}</select></label>
            <label className="f">Text<textarea name="body" required /></label>
            <button className="btn">Save note</button>
          </form>
        </div>
      )}

      {tab === 'data' && (
        <div className="grid cols-2">
          <div className="card">
            <h2>Linked email contacts</h2>
            {contacts.length === 0 ? <p className="muted">No Mailchimp contact linked.</p> : contacts.map(c => <div key={c.id} className="kv"><dt>Email</dt><dd>{c.email} <span className={`pill ${c.status}`}>{c.status}</span></dd><dt>Tags</dt><dd>{c.tags?.join(', ')}</dd><dt>Opted in</dt><dd>{fmtDate(c.optin_at)}</dd></div>)}
          </div>
          <div className="card">
            <h2>Legacy IDs and raw import</h2>
            <pre className="small" style={{ whiteSpace: 'pre-wrap', background: '#faf9f6', padding: '.6rem', borderRadius: 6 }}>{JSON.stringify({ legacy_ids: m.legacy_ids, raw: m.raw }, null, 2)}</pre>
            <p className="small muted">Created {fmtDateTime(m.created_at)} · updated {fmtDateTime(m.updated_at)}</p>
          </div>
        </div>
      )}
    </>
  )
}
