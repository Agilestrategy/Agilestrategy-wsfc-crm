import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function Stat({ n, l, s, tone }) {
  return <div className={`card stat ${tone || ''}`}><div className="n">{n ?? '–'}</div><div className="l">{l}</div>{s && <div className="s">{s}</div>}</div>
}

export default function Dashboard() {
  const [d, setD] = useState(null)
  const [cats, setCats] = useState([])
  const [batches, setBatches] = useState([])
  const [merch, setMerch] = useState(null)
  const [uptake, setUptake] = useState(null)
  const [subs, setSubs] = useState(null)

  useEffect(() => {
    supabase.from('v_dashboard').select('*').single().then(({ data }) => setD(data))
    supabase.from('v_member_list').select('category_name, status').then(({ data }) => {
      const m = {}
      for (const r of data || []) {
        const k = r.category_name || 'Unmapped'
        m[k] ??= { name: k, total: 0, active: 0 }
        m[k].total++; if (r.status === 'active') m[k].active++
      }
      setCats(Object.values(m).sort((a, b) => b.total - a.total))
    })
    supabase.from('v_merch_summary').select('*').single().then(({ data }) => setMerch(data))
    supabase.from('v_app_uptake').select('*').single().then(({ data }) => setUptake(data))
    supabase.from('v_subscriptions_summary').select('*').then(({ data }) => setSubs(data || []))
    supabase.from('import_batches').select('*').order('created_at', { ascending: false }).limit(5).then(({ data }) => setBatches(data || []))
  }, [])

  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '')

  return (
    <>
      <div className="page-head">
        <div><h1>Dashboard</h1><p>Where the club's member base stands right now.</p></div>
        <Link to="/import" className="btn primary">Import data</Link>
      </div>

      <div className="grid cols-4" style={{ marginBottom: '1rem' }}>
        <Stat n={d?.members_total} l="Members on file" s="all statuses" tone="navy" />
        <Stat n={d?.members_active} l="Active (financial)" s={d && pct(d.members_active, d.members_total) + ' of file'} />
        <Stat n={d?.members_lapsed} l="Lapsed" s="win-back pool" tone="warn" />
        <Stat n={d?.members_unknown} l="Status unknown" s="needs a renewal date" tone="orange" />
      </div>
      <div className="grid cols-4" style={{ marginBottom: '1.25rem' }}>
        <Stat n={d?.members_with_email} l="Members with an email" s={d && pct(d.members_with_email, d.members_total) + ' coverage'} />
        <Stat n={d?.members_with_phone} l="Members with a phone" s={d && pct(d.members_with_phone, d.members_total) + ' coverage'} />
        <Stat n={d?.contacts_subscribed} l="Subscribed email contacts" s={d && `${d.contacts_total} in list · ${d.contacts_unsubscribed} unsub · ${d.contacts_cleaned} bounced`} tone="orange" />
        <Stat n={d?.contacts_matched} l="Contacts matched to a member" s={d && pct(d.contacts_matched, d.contacts_total) + ' of list'} />
      </div>
      {uptake && (
        <div className="grid cols-4" style={{ marginBottom: '1.25rem' }}>
          <Link to="/uptake" style={{ textDecoration: 'none' }}><Stat n={pct(uptake.on_app, uptake.active_members) || '0%'} l="Active members on the app" s={`${uptake.on_app} of ${uptake.active_members}`} tone="navy" /></Link>
          <Link to="/uptake" style={{ textDecoration: 'none' }}><Stat n={uptake.reachable_email + uptake.reachable_mobile_only} l="Not yet on the app, reachable" s={`${uptake.reachable_email} by email · ${uptake.reachable_mobile_only} SMS only`} tone="orange" /></Link>
          <Link to="/uptake" style={{ textDecoration: 'none' }}><Stat n={uptake.push_on} l="Notifications on" s={`${uptake.active_30d} opened the app in 30 days`} /></Link>
          <Link to="/subscriptions" style={{ textDecoration: 'none' }}><Stat n={(subs || []).reduce((a, r) => a + Number(r.active || 0), 0)} l="Paying by subscription" s={'$' + (subs || []).reduce((a, r) => a + Number(r.annualised || 0), 0).toFixed(0) + ' a year'} /></Link>
        </div>
      )}
      {merch && (
        <div className="grid cols-4" style={{ marginBottom: '1.25rem' }}>
          <Link to="/merch" style={{ textDecoration: 'none' }}><Stat n={merch.orders_new} l="Merch orders waiting" s="for the Friday run" tone="orange" /></Link>
          <Link to="/merch" style={{ textDecoration: 'none' }}><Stat n={merch.units_waiting} l="Merch units waiting" s="against the 10 minimum" /></Link>
          <Link to="/merch" style={{ textDecoration: 'none' }}><Stat n={merch.orders_at_club} l="Merch at the club" s="ready to collect" /></Link>
          <Link to="/merch" style={{ textDecoration: 'none' }}><Stat n={'$' + Number(merch.sales_30d || 0).toFixed(0)} l="Merch sales, 30 days" s={merch.last_sync ? 'synced from Shopify' : 'Shopify not connected'} tone="navy" /></Link>
        </div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <h2>By category</h2>
          {cats.length === 0 ? <p className="muted">No members yet. Import the members list to populate this.</p> : (
            <table><thead><tr><th>Category</th><th>Total</th><th>Active</th></tr></thead>
              <tbody>{cats.map(c => <tr key={c.name}><td>{c.name}</td><td>{c.total}</td><td>{c.active}</td></tr>)}</tbody></table>
          )}
        </div>
        <div className="card">
          <h2>Recent imports</h2>
          {batches.length === 0 ? <p className="muted">Nothing imported yet.</p> : (
            <table><thead><tr><th>When</th><th>Source</th><th>Rows</th><th>New</th><th>Updated</th></tr></thead>
              <tbody>{batches.map(b => <tr key={b.id}><td>{new Date(b.created_at).toLocaleDateString('en-NZ')}</td><td>{b.source}<div className="small muted">{b.filename}</div></td><td>{b.row_count}</td><td>{b.inserted}</td><td>{b.updated}</td></tr>)}</tbody></table>
          )}
        </div>
      </div>
    </>
  )
}
