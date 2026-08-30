import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Link, useNavigate, useParams, Navigate } from 'react-router-dom'
import { supabase, configured, fmtDate } from '../lib/supabase'
import { enablePush, disablePush, currentPushState, pushSupported, isIOS, isStandalone, registerSW } from '../lib/push'
import './me.css'

const TIER = {
  black: { label: 'Black', blurb: 'Our most active members. Thank you.' },
  gold: { label: 'Gold', blurb: 'A regular at the club. Nice.' },
  silver: { label: 'Silver', blurb: 'Financial member. Check in to climb.' },
}

export default function MemberApp() {
  const [session, setSession] = useState(undefined)
  const [member, setMember] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { registerSW() }, [])
  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const loadMember = async () => {
    if (!session) { setMember(null); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('members').select('*, membership_categories(name)')
      .or(`auth_user_id.eq.${session.user.id},email.ilike.${session.user.email}`).order('is_household_primary', { ascending: false }).limit(1).maybeSingle()
    setMember(data || null); setLoading(false)
  }
  useEffect(() => { if (session !== undefined) loadMember() }, [session])

  useEffect(() => { document.documentElement.dataset.tier = member?.status_tier || 'none'; return () => { delete document.documentElement.dataset.tier } }, [member?.status_tier])

  if (!configured) return <div className="me"><div className="me-card">App not configured.</div></div>
  if (session === undefined || loading) return <div className="me"><div className="me-splash"><img src="/wsfc-logo-256.png" alt="" /></div></div>
  if (!session) return <MeLogin />
  if (!member) return <NoRecord email={session.user.email} />
  return (
    <div className="me">
      <Routes>
        <Route path="/" element={<Home member={member} reload={loadMember} />} />
        <Route path="/checkin/:code" element={<Checkin member={member} reload={loadMember} />} />
        <Route path="/details" element={<Details member={member} reload={loadMember} />} />
        <Route path="/activity" element={<Activity member={member} />} />
        <Route path="*" element={<Navigate to="/me" replace />} />
      </Routes>
    </div>
  )
}

function Brand({ sub }) {
  return <div className="me-brand"><img src="/wsfc-logo-256.png" alt="Whakatāne Sportfishing Club" /><div><strong>WSFC Members</strong><span>{sub}</span></div></div>
}

function MeLogin() {
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin + '/me' } })
    setBusy(false); if (error) setErr(error.message); else setSent(true)
  }
  return (
    <div className="me">
      <div className="me-card">
        <Brand sub="Whakatāne Sportfishing Club" />
        {sent ? <p className="me-ok">Check your email for a sign-in link. It opens this app.</p> : (
          <form onSubmit={submit} className="me-form">
            <p>Sign in with the email the club has for you. No password.</p>
            <input type="email" required placeholder="you@example.co.nz" value={email} onChange={(e) => setEmail(e.target.value)} />
            {err && <p className="me-err">{err}</p>}
            <button className="me-btn" disabled={busy}>{busy ? 'Sending…' : 'Send me a link'}</button>
            <p className="me-muted">Not sure which email? Ask at the bar or the office and we will update it.</p>
          </form>
        )}
      </div>
    </div>
  )
}

function NoRecord({ email }) {
  return (
    <div className="me"><div className="me-card">
      <Brand sub="Whakatāne Sportfishing Club" />
      <p>We could not find a membership for <b>{email}</b>.</p>
      <p className="me-muted">If you are a member, the club may have a different email for you. Ask at the office to update it, or join at the bar.</p>
      <button className="me-btn ghost" onClick={() => supabase.auth.signOut()}>Try another email</button>
    </div></div>
  )
}

function Home({ member, reload }) {
  const tier = member.status_tier; const t = TIER[tier]
  const [pts, setPts] = useState(null); const [push, setPush] = useState('off'); const [msg, setMsg] = useState('')
  const [code, setCode] = useState(''); const nav = useNavigate()
  useEffect(() => {
    supabase.from('engagements').select('points, occurred_at').eq('member_id', member.id).gt('occurred_at', new Date(Date.now() - 90 * 864e5).toISOString())
      .then(({ data }) => setPts({ points: (data || []).reduce((a, e) => a + e.points, 0), visits: (data || []).length }))
    currentPushState().then(setPush)
  }, [member.id])

  async function togglePush() {
    setMsg('')
    try { if (push === 'on') { await disablePush(member.id); setPush('off') } else { await enablePush(member.id); setPush('on'); setMsg('Notifications on.') } }
    catch (e) { setMsg(e.message) }
  }
  const active = member.status === 'active'
  return (
    <>
      <Brand sub={`${member.first_name || ''} ${member.last_name || ''}`.trim()} />
      <div className={`me-tier tier-${tier || 'none'}`}>
        <div className="me-tier-label">{active ? `${t?.label || 'Member'} member` : 'Membership not current'}</div>
        <div className="me-tier-name">{member.first_name} {member.last_name}</div>
        <div className="me-tier-meta">{member.member_number ? `#${member.member_number}` : ''}{member.membership_categories?.name ? ` · ${member.membership_categories.name}` : ''}{member.financial_until ? ` · paid to ${fmtDate(member.financial_until)}` : ''}</div>
        <div className="me-tier-blurb">{active ? t?.blurb : 'See the office to renew and get back on the water with us.'}</div>
        {pts && <div className="me-tier-stats"><span><b>{pts.visits}</b> check-ins</span><span><b>{pts.points}</b> points</span><span>last 90 days</span></div>}
      </div>

      <div className="me-card">
        <h2>Check in</h2>
        <p className="me-muted">Scan the QR at the bar or the door with your camera, or type the code on the poster.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) nav(`/me/checkin/${code.trim().toUpperCase()}`) }} className="me-row">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code, e.g. BAR" />
          <button className="me-btn">Check in</button>
        </form>
      </div>

      <div className="me-card">
        <h2>Club news on your phone</h2>
        {push === 'unsupported' && isIOS() && !isStandalone() ? (
          <p className="me-muted">On iPhone, tap Share then <b>Add to Home Screen</b>, then open the app from there to turn notifications on.</p>
        ) : push === 'denied' ? <p className="me-muted">Notifications are blocked in your phone settings for this site.</p> : (
          <button className={`me-btn ${push === 'on' ? 'ghost' : ''}`} onClick={togglePush}>{push === 'on' ? 'Turn notifications off' : 'Turn notifications on'}</button>
        )}
        {msg && <p className="me-muted">{msg}</p>}
      </div>

      <div className="me-links">
        <Link to="/me/details">My details</Link>
        <Link to="/me/activity">My activity</Link>
        <a href="#" onClick={(e) => { e.preventDefault(); supabase.auth.signOut() }}>Sign out</a>
      </div>
      <p className="me-foot">Whakatāne Sportfishing Club · 60 years on the water</p>
    </>
  )
}

function Checkin({ member, reload }) {
  const { code } = useParams(); const [res, setRes] = useState(null); const nav = useNavigate()
  useEffect(() => { supabase.rpc('member_checkin', { p_code: code }).then(({ data, error }) => { setRes(error ? { ok: false, error: error.message } : data); if (data?.ok) reload() }) }, [code])
  return (
    <>
      <Brand sub="Check in" />
      <div className={`me-card me-checkin ${res ? (res.ok ? 'ok' : 'bad') : ''}`}>
        {!res ? <p>Checking you in…</p> : res.ok ? (<><div className="me-big">{res.points > 0 ? `+${res.points}` : '✓'}</div><p>{res.message}</p></>) : (<><div className="me-big">✕</div><p>{res.error}</p></>)}
        <button className="me-btn" onClick={() => nav('/me')}>Back to my card</button>
      </div>
    </>
  )
}

function Field({ label, type = 'text', value, onChange, ...rest }) {
  return <label>{label}<input type={type} value={value} onChange={onChange} autoComplete="off" {...rest} /></label>
}

function Details({ member, reload }) {
  const [f, setF] = useState({ first_name: member.first_name || '', last_name: member.last_name || '', preferred_name: member.preferred_name || '', mobile: member.mobile || '', phone: member.phone || '',
    email: member.email || '', date_of_birth: member.date_of_birth || '', address_line1: member.address_line1 || '', suburb: member.suburb || '', city: member.city || '', postcode: member.postcode || '', boat_name: member.boat_name || '' })
  const [msg, setMsg] = useState(''); const nav = useNavigate()
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function save(e) {
    e.preventDefault()
    const patch = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]))
    const { error } = await supabase.from('members').update({ ...patch, details_confirmed_at: new Date().toISOString() }).eq('id', member.id)
    setMsg(error ? error.message : 'Saved. Thanks for keeping us up to date.'); if (!error) reload()
  }
  return (
    <>
      <Brand sub="My details" />
      <form className="me-card me-form" onSubmit={save}>
        <div className="me-grid"><Field label="First name" value={f.first_name} onChange={set('first_name')} /><Field label="Last name" value={f.last_name} onChange={set('last_name')} /></div>
        <Field label="What we should call you" value={f.preferred_name} onChange={set('preferred_name')} />
        <Field label="Mobile" type="tel" value={f.mobile} onChange={set('mobile')} /><Field label="Email" type="email" value={f.email} onChange={set('email')} />
        <Field label="Date of birth" type="date" value={f.date_of_birth} onChange={set('date_of_birth')} />
        <AddressField value={f.address_line1} onChange={set('address_line1')} onPlace={(a) => setF((cur) => ({ ...cur, ...a }))} />
        <div className="me-grid"><Field label="Suburb" value={f.suburb} onChange={set('suburb')} /><Field label="Town / city" value={f.city} onChange={set('city')} /></div>
        <Field label="Postcode" value={f.postcode} onChange={set('postcode')} /><Field label="Boat name (if you have one)" value={f.boat_name} onChange={set('boat_name')} />
        {msg && <p className="me-ok">{msg}</p>}
        <button className="me-btn">Save my details</button>
        <button type="button" className="me-btn ghost" onClick={() => nav('/me')}>Back</button>
      </form>
    </>
  )
}

// Google Places autocomplete (NZ only). Works as a plain text box if no key is configured.
const GKEY = import.meta.env.VITE_GOOGLE_MAPS_KEY
let gmapsPromise
function loadGoogle() {
  if (!GKEY) return Promise.resolve(null)
  if (window.google?.maps?.places) return Promise.resolve(window.google)
  if (!gmapsPromise) gmapsPromise = new Promise((res) => {
    const s = document.createElement('script'); s.src = `https://maps.googleapis.com/maps/api/js?key=${GKEY}&libraries=places&region=NZ&loading=async`
    s.async = true; s.onload = () => res(window.google); s.onerror = () => res(null); document.head.appendChild(s)
  })
  return gmapsPromise
}
function AddressField({ value, onChange, onPlace }) {
  const ref = useRef(null)
  useEffect(() => {
    let ac
    loadGoogle().then((g) => {
      if (!g || !ref.current) return
      ac = new g.maps.places.Autocomplete(ref.current, { componentRestrictions: { country: 'nz' }, fields: ['address_components'], types: ['address'] })
      ac.addListener('place_changed', () => {
        const comps = ac.getPlace()?.address_components || []
        const get = (t) => comps.find((c) => c.types.includes(t))?.long_name || ''
        const street = [get('street_number'), get('route')].filter(Boolean).join(' ')
        onPlace({ address_line1: street || ref.current.value, suburb: get('sublocality_level_1') || get('sublocality') || get('neighborhood') || '', city: get('locality') || get('administrative_area_level_2') || '', postcode: get('postal_code') || '' })
      })
    })
    return () => { if (ac && window.google) window.google.maps.event.clearInstanceListeners(ac) }
  }, [])
  return <label>Street address<input ref={ref} type="text" value={value} onChange={onChange} placeholder={GKEY ? 'Start typing your address' : ''} autoComplete="off" /></label>
}

function Activity({ member }) {
  const [rows, setRows] = useState([])
  useEffect(() => { supabase.from('engagements').select('*').eq('member_id', member.id).order('occurred_at', { ascending: false }).limit(50).then(({ data }) => setRows(data || [])) }, [member.id])
  const label = { swipe_bar: 'Bar check-in', swipe_door: 'Door check-in', swipe_gaming: 'Gaming floor', event: 'Event', volunteer: 'Volunteering', referral: 'Referral', renewal_on_time: 'On-time renewal', other: 'Other' }
  return (
    <>
      <Brand sub="My activity" />
      <div className="me-card">
        {rows.length === 0 ? <p className="me-muted">No check-ins yet. Scan the QR at the bar next time you are in.</p> : (
          <ul className="me-list">{rows.map((r) => <li key={r.id}><span>{label[r.type] || r.type}{r.reference ? ` · ${r.reference}` : ''}</span><span>{new Date(r.occurred_at).toLocaleDateString('en-NZ')}</span><b>{r.points > 0 ? `+${r.points}` : ''}</b></li>)}</ul>
        )}
        <Link className="me-btn ghost" to="/me">Back</Link>
      </div>
    </>
  )
}
