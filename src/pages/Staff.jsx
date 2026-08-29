import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

export default function Staff() {
  const { staff: me } = useAuth()
  const [rows, setRows] = useState([]); const [msg, setMsg] = useState('')
  const load = () => supabase.from('staff').select('*').order('created_at').then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [])
  const admin = me?.role === 'admin'

  async function add(e) {
    e.preventDefault(); const f = new FormData(e.target)
    const { error } = await supabase.from('staff').insert({ email: f.get('email').trim().toLowerCase(), full_name: f.get('full_name'), role: f.get('role') })
    setMsg(error ? 'Error: ' + error.message : 'Added. They can now sign in with a magic link.'); e.target.reset(); load()
  }
  async function toggle(s) { await supabase.from('staff').update({ is_active: !s.is_active }).eq('id', s.id); load() }
  async function setRole(s, role) { await supabase.from('staff').update({ role }).eq('id', s.id); load() }

  return (
    <>
      <div className="page-head"><div><h1>Staff</h1><p>Who can open this console. Admins manage this list.</p></div></div>
      {msg && <div className="alert">{msg}</div>}
      <div className="grid cols-2">
        <div className="card">
          <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Signed in</th></tr></thead>
            <tbody>{rows.map(s => <tr key={s.id}>
              <td>{s.full_name}</td><td>{s.email}</td>
              <td>{admin ? <select value={s.role} onChange={e => setRole(s, e.target.value)}>{['admin', 'committee', 'staff', 'readonly'].map(r => <option key={r}>{r}</option>)}</select> : s.role}</td>
              <td>{admin ? <button className="btn ghost sm" onClick={() => toggle(s)}>{s.is_active ? 'Yes · deactivate' : 'No · activate'}</button> : (s.is_active ? 'Yes' : 'No')}</td>
              <td>{s.user_id ? 'Yes' : 'Not yet'}</td>
            </tr>)}</tbody></table>
        </div>
        {admin && (
          <form className="card" onSubmit={add} style={{ display: 'grid', gap: '.6rem', alignContent: 'start' }}>
            <h2>Add staff</h2>
            <label className="f">Full name<input name="full_name" required /></label>
            <label className="f">Email<input name="email" type="email" required /></label>
            <label className="f">Role<select name="role" defaultValue="staff">{['admin', 'committee', 'staff', 'readonly'].map(r => <option key={r}>{r}</option>)}</select></label>
            <button className="btn primary">Add</button>
            <p className="small muted">Roles are informational for now; every active staff member has full access. Read-only enforcement comes with the member portal phase.</p>
          </form>
        )}
      </div>
    </>
  )
}
