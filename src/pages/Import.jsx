import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { TARGETS, guessMapping, parseFile, isMailchimp, buildMember, upsertMembers, upsertMailchimp } from '../lib/importer'

export default function ImportPage() {
  const { staff } = useAuth()
  const [file, setFile] = useState(null)
  const [headers, setHeaders] = useState([]); const [rows, setRows] = useState([])
  const [mapping, setMapping] = useState({}); const [mode, setMode] = useState('members')
  const [keyMode, setKeyMode] = useState('member_number'); const [label, setLabel] = useState('members_list')
  const [cats, setCats] = useState([]); const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false); const [result, setResult] = useState(null); const [err, setErr] = useState('')

  useEffect(() => { supabase.from('membership_categories').select('*').order('sort_order').then(({ data }) => setCats(data || [])) }, [])

  async function pick(e) {
    const f = e.target.files?.[0]; if (!f) return
    setFile(f); setResult(null); setErr(''); setProgress(0)
    const r = await parseFile(f)
    const h = r.meta.fields || []
    setHeaders(h); setRows(r.data)
    if (isMailchimp(h)) { setMode('mailchimp') } else { setMode('members'); setMapping(guessMapping(h)); if (h.some(x => /member.*(no|num|id)/i.test(x))) setKeyMode('member_number'); else if (h.some(x => /mail/i.test(x))) setKeyMode('email'); else setKeyMode('name') }
  }

  const preview = mode === 'members' ? rows.slice(0, 5).map(r => buildMember(r, mapping, cats, null, label).member) : []

  async function run() {
    setBusy(true); setErr(''); setProgress(0)
    try {
      const { data: batch, error } = await supabase.from('import_batches').insert({ source: mode === 'mailchimp' ? 'mailchimp' : label, filename: file.name, row_count: rows.length, mapping: mode === 'members' ? mapping : null, created_by: staff?.email }).select().single()
      if (error) throw error
      let res
      if (mode === 'mailchimp') res = await upsertMailchimp(rows, file.name, batch.id, setProgress)
      else res = await upsertMembers(rows.map(r => buildMember(r, mapping, cats, batch.id, label)), keyMode, setProgress)
      await supabase.from('import_batches').update({ inserted: res.inserted, updated: res.updated, skipped: res.skipped }).eq('id', batch.id)
      const { data: m } = await supabase.rpc('match_email_contacts')
      setResult({ ...res, match: m?.[0] })
    } catch (e) { setErr(e.message || String(e)) }
    setBusy(false)
  }

  return (
    <>
      <div className="page-head"><div><h1>Import</h1><p>Load a members list from the old system, or a Mailchimp audience export. Nothing is deleted; existing records are updated in place.</p></div></div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="toolbar">
          <input type="file" accept=".csv,text/csv" onChange={pick} />
          {file && <span className="muted small">{file.name} · {rows.length.toLocaleString()} rows · detected: <b>{mode === 'mailchimp' ? 'Mailchimp audience' : 'members list'}</b></span>}
        </div>
        {mode === 'members' && file && (
          <div className="toolbar">
            <label className="f">Source label<input type="text" value={label} onChange={e => setLabel(e.target.value)} /></label>
            <label className="f">Match existing members by<select value={keyMode} onChange={e => setKeyMode(e.target.value)}><option value="member_number">Member number</option><option value="email">Email</option><option value="name">First + last name</option></select></label>
          </div>
        )}
      </div>

      {mode === 'members' && headers.length > 0 && (
        <div className="grid cols-2" style={{ marginBottom: '1rem' }}>
          <div className="card">
            <h2>Map columns</h2>
            <table><thead><tr><th>CSV column</th><th>Sample</th><th>Goes to</th></tr></thead>
              <tbody>{headers.map(h => (
                <tr key={h}><td><b>{h}</b></td><td className="small muted">{rows[0]?.[h]}</td>
                  <td><select value={mapping[h] || ''} onChange={e => setMapping({ ...mapping, [h]: e.target.value })}>{TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td></tr>
              ))}</tbody></table>
          </div>
          <div className="card">
            <h2>Preview (first 5)</h2>
            <table><thead><tr><th>Name</th><th>Email</th><th>Category</th><th>Status</th><th>Financial until</th></tr></thead>
              <tbody>{preview.map((p, i) => <tr key={i}><td>{[p.first_name, p.last_name].filter(Boolean).join(' ')}{p.member_number && <div className="small muted">#{p.member_number}</div>}</td><td>{p.email}</td><td>{cats.find(c => c.id === p.category_id)?.name}</td><td><span className={`pill ${p.status}`}>{p.status}</span></td><td>{p.financial_until}</td></tr>)}</tbody></table>
            <p className="small muted" style={{ marginTop: '.75rem' }}>Category text is mapped to the club's categories by keyword (family, senior, junior, corporate, social, fishing, life). Status comes from a status column if there is one, otherwise from the financial-until date. Unmapped rows land as "Other / unmapped" and "unknown" so nothing is lost.</p>
          </div>
        </div>
      )}

      {file && (
        <div className="card">
          <div className="toolbar">
            <button className="btn primary" disabled={busy} onClick={run}>{busy ? `Importing… ${progress}/${rows.length}` : `Import ${rows.length.toLocaleString()} rows`}</button>
            {result && <span className="alert ok" style={{ margin: 0 }}>Done. {result.inserted} new, {result.updated} updated, {result.skipped} skipped{result.status ? ` (${result.status})` : ''}. Contacts matched: {result.match?.matched_by_email ?? 0} by email, {result.match?.matched_by_name ?? 0} by name.</span>}
            {err && <span className="alert err" style={{ margin: 0 }}>{err}</span>}
          </div>
        </div>
      )}
    </>
  )
}
