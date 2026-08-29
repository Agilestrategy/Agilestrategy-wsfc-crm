import { useEffect, useState } from 'react'
import { supabase, fmtDateTime } from '../lib/supabase'
import { useAuth } from '../lib/auth'

export default function Notify() {
  const { staff } = useAuth()
  const [rows, setRows] = useState([]); const [reach, setReach] = useState(null); const [msg, setMsg] = useState('')
  const load = async () => {
    const [{ data: n }, { data: r }] = await Promise.all([
      supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('v_tier_summary').select('*'),
    ])
    setRows(n || []); setReach(r || [])
  }
  useEffect(() => { load() }, [])
  async function send(e) {
    e.preventDefault(); const f = new FormData(e.target)
    const tier = f.get('tier'); const audience = tier ? { tier } : {}
    const { error } = await supabase.from('notifications').insert({ title: f.get('title'), body: f.get('body'), url: f.get('url') || '/me', audience, created_by: staff?.email })
    setMsg(error ? error.message : 'Queued. The sender runs every 5 minutes.'); e.target.reset(); load()
  }
  const optedIn = (reach || []).reduce((a, r) => a + Number(r.push_opted_in || 0), 0)
  return (
    <>
      <div className="page-head"><div><h1>Notifications</h1><p>Push messages to members who have the app installed and notifications on. {reach && <b>{optedIn} opted in</b>}.</p></div></div>
      {msg && <div className="alert">{msg}</div>}
      <div className="grid cols-2">
        <form className="card" onSubmit={send} style={{ display: 'grid', gap: '.6rem', alignContent: 'start' }}>
          <h2>Send a push</h2>
          <label className="f">Title<input name="title" required maxLength={60} placeholder="Friday club night" /></label>
          <label className="f">Message<textarea name="body" required maxLength={200} placeholder="Raffle drawn at 7pm. Check in at the bar for points." /></label>
          <label className="f">Audience<select name="tier"><option value="">Everyone opted in</option>{(reach || []).filter((r) => r.status_tier).map((r) => <option key={r.status_tier} value={r.status_tier}>{r.status_tier} members ({r.push_opted_in} opted in)</option>)}</select></label>
          <label className="f">Opens (optional)<input name="url" placeholder="/me" /></label>
          <button className="btn primary">Queue notification</button>
          <p className="small muted">Bright line: no gaming content. Keep it to club news, events, renewals and the 60th.</p>
        </form>
        <div className="card">
          <h2>History</h2>
          <table><thead><tr><th>When</th><th>Title</th><th>Audience</th><th>Status</th><th>Sent</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><td className="small">{fmtDateTime(r.created_at)}</td><td><b>{r.title}</b><div className="small muted">{r.body}</div></td><td className="small">{r.audience?.tier || (r.audience?.member_ids ? `${r.audience.member_ids.length} member(s)` : 'everyone')}{r.audience?.reason ? ` · ${r.audience.reason}` : ''}</td><td><span className={`pill ${r.status === 'sent' ? 'active' : r.status === 'failed' ? 'lapsed' : 'pending'}`}>{r.status}</span></td><td>{r.sent_count}{r.failed_count ? ` / ${r.failed_count} failed` : ''}</td></tr>)}
              {rows.length === 0 && <tr><td colSpan={5} className="muted">Nothing sent yet.</td></tr>}</tbody></table>
        </div>
      </div>
    </>
  )
}
