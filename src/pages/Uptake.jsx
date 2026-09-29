import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// App uptake: who has opened the member app, who has not, and how to reach the ones who have not.
// Exports a Mailchimp ready CSV (email segment) and an SMS list (mobile only), and can stamp "invited" on the exported members.

function Stat({ n, l, s, tone }) {
  return <div className={`card stat ${tone || ''}`}><div className="n">{n ?? '–'}</div><div className="l">{l}</div>{s && <div className="s">{s}</div>}</div>
}
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
function download(name, rows, cols) {
  const text = [cols.map((c) => c.label).join(','), ...rows.map((r) => cols.map((c) => csvCell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\n')
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export default function Uptake() {
  const nav = useNavigate(); const { staff } = useAuth()
  const [sum, setSum] = useState(null); const [rows, setRows] = useState(null); const [recent, setRecent] = useState([])
  const [channel, setChannel] = useState('email'); const [invited, setInvited] = useState('any'); const [tier, setTier] = useState(''); const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const appUrl = `${window.location.origin}/me`

  const load = async () => {
    const [{ data: s }, { data: r }, { data: rec }] = await Promise.all([
      supabase.from('v_app_uptake').select('*').single(),
      supabase.from('v_app_not_yet').select('*').order('last_name', { nullsFirst: false }).order('first_name').limit(10000),
      supabase.from('members').select('id, full_name, member_number, app_first_seen_at, app_last_seen_at, app_sessions, push_opt_in, status_tier').not('app_first_seen_at', 'is', null).order('app_last_seen_at', { ascending: false }).limit(25),
    ])
    setSum(s || null); setRows(r || []); setRecent(rec || [])
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => (rows || []).filter((r) => {
    if (r.do_not_contact) return false
    if (channel !== 'all' && r.channel !== channel) return false
    if (invited === 'no' && r.app_invited_at) return false
    if (invited === 'yes' && !r.app_invited_at) return false
    if (tier && r.status_tier !== tier) return false
    if (q) { const t = q.toLowerCase(); if (!`${r.first_name || ''} ${r.last_name || ''} ${r.email || ''} ${r.member_number || ''}`.toLowerCase().includes(t)) return false }
    return true
  }), [rows, channel, invited, tier, q])

  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
  const onAppPct = sum ? pct(sum.on_app, sum.active_members) : 0

  async function markInvited() {
    if (!filtered.length) return
    const ids = filtered.map((r) => r.id); const now = new Date().toISOString()
    for (let i = 0; i < ids.length; i += 500) { const { error } = await supabase.from('members').update({ app_invited_at: now }).in('id', ids.slice(i, i + 500)); if (error) { setMsg(error.message); return } }
    // one note per member so the invite shows in their timeline
    const notes = ids.map((id) => ({ member_id: id, kind: channel === 'sms' ? 'sms' : 'email', subject: 'App invite sent', body: `Included in the members app invite list (${channel}).`, created_by: staff?.email || null }))
    for (let i = 0; i < notes.length; i += 500) await supabase.from('interactions').insert(notes.slice(i, i + 500))
    setMsg(`Marked ${ids.length} members as invited today.`); load()
  }
  function exportMailchimp() {
    const cols = [{ label: 'Email Address', key: 'email' }, { label: 'First Name', get: (r) => r.preferred_name || r.first_name }, { label: 'Last Name', key: 'last_name' }, { label: 'Member Number', key: 'member_number' }, { label: 'Category', key: 'category_name' }, { label: 'Tier', key: 'status_tier' }, { label: 'App Link', get: () => appUrl }, { label: 'Tags', get: () => 'app-invite' }]
    download(`wsfc-app-invite-email-${new Date().toISOString().slice(0, 10)}.csv`, filtered.filter((r) => r.email), cols)
  }
  function exportSms() {
    const cols = [{ label: 'Mobile', key: 'mobile' }, { label: 'First Name', get: (r) => r.preferred_name || r.first_name }, { label: 'Last Name', key: 'last_name' }, { label: 'Member Number', key: 'member_number' }, { label: 'Message', get: (r) => `Kia ora ${r.preferred_name || r.first_name || ''}, the WSFC members app is live. Check in for points, tides and bite times, merch and renewals: ${appUrl}`.trim() }]
    download(`wsfc-app-invite-sms-${new Date().toISOString().slice(0, 10)}.csv`, filtered.filter((r) => r.mobile), cols)
  }

  return (
    <>
      <div className="page-head"><div><h1>App uptake</h1><p>Who has the member app, who does not yet, and the lists to bring the rest on board.</p></div></div>
      {msg && <div className="alert">{msg}</div>}
      <div className="grid cols-4" style={{ marginBottom: '1rem' }}>
        <Stat n={sum ? `${onAppPct}%` : null} l="Active members on the app" s={sum ? `${sum.on_app.toLocaleString()} of ${sum.active_members.toLocaleString()}` : ''} tone="navy" />
        <Stat n={sum?.active_30d?.toLocaleString()} l="Opened it in the last 30 days" s={sum ? `${sum.push_on.toLocaleString()} with notifications on` : ''} />
        <Stat n={sum?.reachable_email?.toLocaleString()} l="Not yet on the app, emailable" s={sum ? `${sum.invited_waiting.toLocaleString()} already invited` : ''} tone="gold" />
        <Stat n={sum?.reachable_mobile_only?.toLocaleString()} l="Not yet, mobile only (SMS)" s={sum ? `${sum.unreachable.toLocaleString()} with no email or mobile` : ''} />
      </div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div><h2 style={{ margin: 0 }}>Uptake</h2><p className="small muted" style={{ margin: 0 }}>Counts a member as on the app the first time they sign in. The bar fills as members come on board.</p></div>
          <div className="small muted">Target: everyone financial by the 60th</div>
        </div>
        <div style={{ height: 14, background: 'rgba(0,0,0,.08)', borderRadius: 999, overflow: 'hidden', marginTop: '.7rem' }}><div style={{ width: `${onAppPct}%`, height: '100%', background: 'linear-gradient(90deg,#1B2F3E,#E8863A)', transition: 'width .6s' }} /></div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Not yet on the app <span className="muted small">({filtered.length.toLocaleString()} in this list)</span></h2>
          <div className="toolbar" style={{ padding: 0, marginBottom: '.6rem' }}>
            <select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="email">Reach by email</option><option value="sms">Mobile only (SMS)</option><option value="none">No email or mobile</option><option value="all">All channels</option></select>
            <select value={invited} onChange={(e) => setInvited(e.target.value)}><option value="any">Invited or not</option><option value="no">Not invited yet</option><option value="yes">Invited, no sign in yet</option></select>
            <select value={tier} onChange={(e) => setTier(e.target.value)}><option value="">Any tier</option><option value="silver">Silver</option><option value="gold">Gold</option><option value="black">Black</option></select>
            <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
            {channel !== 'sms' && channel !== 'none' && <button className="btn primary" onClick={exportMailchimp} disabled={!filtered.length}>Export for Mailchimp ({filtered.filter((r) => r.email).length})</button>}
            {channel !== 'email' && channel !== 'none' && <button className="btn" onClick={exportSms} disabled={!filtered.length}>Export SMS list ({filtered.filter((r) => r.mobile).length})</button>}
            <button className="btn ghost" onClick={markInvited} disabled={!filtered.length}>Mark this list as invited</button>
          </div>
          <p className="small muted">Mailchimp: Audience, Import contacts, upload the CSV, and tag them <b>app-invite</b>. Merge field App Link is {appUrl}. Members sign in with the email in this list, so fix any wrong emails on the member record first.</p>
          <div className="table-wrap" style={{ maxHeight: 520, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Name</th><th>Category</th><th>Reach</th><th>Invited</th></tr></thead>
              <tbody>
                {filtered.slice(0, 300).map((r) => (
                  <tr key={r.id} className="row" onClick={() => nav(`/members/${r.id}`)}>
                    <td><b>{[r.first_name, r.last_name].filter(Boolean).join(' ') || <span className="muted">(no name)</span>}</b>{r.member_number && <div className="small muted">#{r.member_number}</div>}</td>
                    <td>{r.category_name || '–'}<div className="small muted">{r.status_tier || ''}</div></td>
                    <td className="small">{r.channel === 'email' ? r.email : r.channel === 'sms' ? r.mobile : <span className="muted">none</span>}</td>
                    <td className="small">{r.app_invited_at ? fmtDate(r.app_invited_at) : <span className="muted">no</span>}</td>
                  </tr>
                ))}
                {rows && filtered.length === 0 && <tr><td colSpan={4} className="muted">Nobody matches. Everyone here is on the app.</td></tr>}
                {filtered.length > 300 && <tr><td colSpan={4} className="muted small">Showing the first 300 of {filtered.length.toLocaleString()}. The export includes everyone in the list.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Latest sign ins</h2>
          <table>
            <thead><tr><th>Member</th><th>First opened</th><th>Last opened</th><th>Opens</th><th>Push</th></tr></thead>
            <tbody>
              {recent.map((r) => <tr key={r.id} className="row" onClick={() => nav(`/members/${r.id}`)}><td><b>{r.full_name}</b>{r.member_number && <div className="small muted">#{r.member_number}</div>}</td><td className="small">{fmtDate(r.app_first_seen_at)}</td><td className="small">{fmtDate(r.app_last_seen_at)}</td><td>{r.app_sessions}</td><td>{r.push_opt_in ? <span className="pill active">on</span> : <span className="muted small">off</span>}</td></tr>)}
              {recent.length === 0 && <tr><td colSpan={5} className="muted">No sign ins recorded yet. Members are counted from their first sign in after this update went live.</td></tr>}
            </tbody>
          </table>
          <h2 style={{ marginTop: '1.2rem' }}>How the drive works</h2>
          <p className="small">1. Export the email list, load it into Mailchimp with the <b>app-invite</b> tag and send the invite with the App Link merge field. 2. Export the SMS list for the mobile only members and send it through the club's SMS tool. 3. Mark the list as invited. 4. Come back in a week: the list shrinks as members sign in, and the "Invited, no sign in yet" filter gives you the follow up list. Members who sign in are linked automatically, so no manual matching.</p>
        </div>
      </div>
    </>
  )
}
