import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'

const PAGE = 50

export default function Contacts() {
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') || '', status = sp.get('status') || '', matched = sp.get('matched') || ''
  const page = Number(sp.get('page') || 0)
  const [rows, setRows] = useState([]); const [count, setCount] = useState(0); const [msg, setMsg] = useState('')

  const load = () => {
    let query = supabase.from('email_contacts').select('*, members(id, full_name)', { count: 'exact' })
    if (q) query = query.or(`email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
    if (status) query = query.eq('status', status)
    if (matched === 'yes') query = query.not('member_id', 'is', null)
    if (matched === 'no') query = query.is('member_id', null)
    query.order('last_name', { ascending: true, nullsFirst: false }).order('email').range(page * PAGE, page * PAGE + PAGE - 1)
      .then(({ data, count }) => { setRows(data || []); setCount(count || 0) })
  }
  useEffect(load, [q, status, matched, page])
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); setSp(n) }

  async function runMatch() {
    setMsg('Matching…')
    const { data, error } = await supabase.rpc('match_email_contacts')
    setMsg(error ? 'Error: ' + error.message : `Matched ${data?.[0]?.matched_by_email ?? 0} by email and ${data?.[0]?.matched_by_name ?? 0} by name.`)
    load()
  }

  async function promote(c) {
    const { data, error } = await supabase.from('members').insert({
      first_name: c.first_name, last_name: c.last_name, email: c.email, email_status: c.status, source: 'mailchimp',
      status: 'unknown', legacy_ids: { mailchimp_euid: c.mailchimp_euid }, phone: c.phone,
    }).select('id').single()
    if (error) { setMsg('Error: ' + error.message); return }
    await supabase.from('email_contacts').update({ member_id: data.id }).eq('id', c.id)
    load()
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Email contacts</h1><p>The Mailchimp audience as imported. {count.toLocaleString()} shown.</p></div>
        <button className="btn" onClick={runMatch}>Match to members</button>
      </div>
      {msg && <div className="alert">{msg}</div>}
      <div className="toolbar">
        <input type="text" placeholder="Search email or name" value={q} onChange={e => set('q', e.target.value)} style={{ minWidth: 260 }} />
        <select value={status} onChange={e => set('status', e.target.value)}><option value="">Any status</option>{['subscribed', 'unsubscribed', 'cleaned', 'nonsubscribed'].map(s => <option key={s}>{s}</option>)}</select>
        <select value={matched} onChange={e => set('matched', e.target.value)}><option value="">Matched: any</option><option value="yes">Linked to a member</option><option value="no">Not linked</option></select>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Tags</th><th>Opted in</th><th>Member</th></tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td>{c.email}</td>
                <td>{[c.first_name, c.last_name].filter(Boolean).join(' ') || <span className="muted">–</span>}</td>
                <td><span className={`pill ${c.status}`}>{c.status}</span>{c.reason && <div className="small muted">{c.reason}</div>}</td>
                <td className="small">{c.tags?.join(', ')}</td>
                <td>{fmtDate(c.optin_at)}</td>
                <td>{c.members ? <Link to={`/members/${c.members.id}`}>{c.members.full_name || 'open'}</Link> : (c.first_name && c.last_name ? <button className="btn ghost sm" onClick={() => promote(c)}>Create member</button> : <span className="muted small">no name</span>)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">No contacts. Run <code>scripts/import-mailchimp.mjs</code> to load the audience export.</td></tr>}
          </tbody>
        </table>
        <div className="pager">
          <span>Page {page + 1} of {Math.max(1, Math.ceil(count / PAGE))}</span>
          <button className="btn ghost sm" disabled={page === 0} onClick={() => set('page', String(page - 1))}>Prev</button>
          <button className="btn ghost sm" disabled={(page + 1) * PAGE >= count} onClick={() => set('page', String(page + 1))}>Next</button>
        </div>
      </div>
    </>
  )
}
