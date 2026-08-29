import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'

const PAGE = 50
const STATUSES = ['', 'active', 'lapsed', 'expired', 'pending', 'cancelled', 'unknown']

export default function Members() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') || ''
  const status = sp.get('status') || ''
  const cat = sp.get('cat') || ''
  const email = sp.get('email') || ''
  const page = Number(sp.get('page') || 0)
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [cats, setCats] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => { supabase.from('membership_categories').select('code,name').order('sort_order').then(({ data }) => setCats(data || [])) }, [])

  useEffect(() => {
    setBusy(true)
    let query = supabase.from('v_member_list').select('*', { count: 'exact' })
    if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,member_number.ilike.%${q}%,mobile.ilike.%${q}%`)
    if (status) query = query.eq('status', status)
    if (cat) query = query.eq('category_code', cat)
    if (email === 'yes') query = query.not('email', 'is', null)
    if (email === 'no') query = query.is('email', null)
    query.order('last_name', { ascending: true, nullsFirst: false }).order('first_name').range(page * PAGE, page * PAGE + PAGE - 1)
      .then(({ data, count }) => { setRows(data || []); setCount(count || 0); setBusy(false) })
  }, [q, status, cat, email, page])

  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); setSp(n) }

  async function addMember() {
    const { data, error } = await supabase.from('members').insert({ source: 'manual', status: 'pending' }).select('id').single()
    if (!error) nav(`/members/${data.id}`)
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Members</h1><p>{count.toLocaleString()} {count === 1 ? 'record' : 'records'}{busy ? ' · loading…' : ''}</p></div>
        <button className="btn primary" onClick={addMember}>Add member</button>
      </div>
      <div className="toolbar">
        <input type="text" placeholder="Search name, email, number, mobile" value={q} onChange={e => set('q', e.target.value)} style={{ minWidth: 280 }} />
        <select value={status} onChange={e => set('status', e.target.value)}>{STATUSES.map(s => <option key={s} value={s}>{s ? s[0].toUpperCase() + s.slice(1) : 'Any status'}</option>)}</select>
        <select value={cat} onChange={e => set('cat', e.target.value)}><option value="">Any category</option>{cats.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
        <select value={email} onChange={e => set('email', e.target.value)}><option value="">Email: any</option><option value="yes">Has email</option><option value="no">No email</option></select>
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Email</th><th>Mobile</th><th>Financial until</th><th>Last engaged</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="row" onClick={() => nav(`/members/${r.id}`)}>
                <td><b>{r.full_name || <span className="muted">(no name)</span>}</b>{r.member_number && <div className="small muted">#{r.member_number}</div>}</td>
                <td>{r.category_name || <span className="muted">–</span>}</td>
                <td><span className={`pill ${r.status}`}>{r.status}</span></td>
                <td>{r.email || <span className="muted">none</span>}{r.email && r.email_status !== 'unknown' && <div className="small"><span className={`pill ${r.email_status}`}>{r.email_status}</span></div>}</td>
                <td>{r.mobile || r.phone || ''}</td>
                <td>{fmtDate(r.financial_until)}</td>
                <td>{fmtDate(r.last_engaged_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && !busy && <tr><td colSpan={7} className="muted">No members match. Import a members list from the Import page.</td></tr>}
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
