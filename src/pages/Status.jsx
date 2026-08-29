import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const TIERS = ['black', 'gold', 'silver']

export default function Status() {
  const { staff } = useAuth()
  const [sum, setSum] = useState([]); const [settings, setSettings] = useState(null); const [picked, setPicked] = useState([])
  const [q, setQ] = useState(''); const [hits, setHits] = useState([]); const [msg, setMsg] = useState('')
  const load = async () => {
    const [{ data: s }, { data: st }, { data: p }] = await Promise.all([
      supabase.from('v_tier_summary').select('*'), supabase.from('programme_settings').select('*').eq('id', 1).single(),
      supabase.from('v_member_list').select('id, full_name, member_number, status_tier, tier_override, city').not('tier_override', 'is', null).order('last_name').limit(500),
    ])
    setSum(s || []); setSettings(st); setPicked(p || [])
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (q.length < 2) { setHits([]); return }
    supabase.from('v_member_list').select('id, full_name, member_number, city, status, status_tier, tier_override').or(`full_name.ilike.%${q}%,member_number.eq.${q}`).limit(12).then(({ data }) => setHits(data || []))
  }, [q])

  async function setOverride(id, tier, reason) {
    await supabase.from('members').update({ tier_override: tier, tier_override_reason: reason || null, tier_override_until: tier ? (settings?.gold_promo_until || null) : null }).eq('id', id)
    await supabase.rpc('recompute_member_tier', { p_member: id }); load(); setQ('')
  }
  async function recompute() { setMsg('Recomputing…'); const { data, error } = await supabase.rpc('recompute_tiers'); setMsg(error ? error.message : 'Done: ' + (data || []).map((r) => `${r.tier || 'none'} ${r.members}`).join(' · ')); load() }
  async function saveSettings(e) {
    e.preventDefault(); const f = new FormData(e.target)
    const patch = Object.fromEntries(['anniversary_date', 'gold_promo_ends', 'gold_promo_until', 'black_per_month', 'gold_per_month', 'gold_points_per_quarter', 'checkin_max_per_day'].map((k) => [k, f.get(k)]))
    const { error } = await supabase.from('programme_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1); setMsg(error ? error.message : 'Settings saved.'); load()
  }
  const n = (t) => sum.find((r) => r.status_tier === t)
  return (
    <>
      <div className="page-head"><div><h1>Status programme</h1><p>Silver for every financial member, Gold and Black earned by showing up. Admin can hand-pick.</p></div><button className="btn" onClick={recompute}>Recompute all tiers</button></div>
      {msg && <div className="alert">{msg}</div>}
      <div className="grid cols-3" style={{ marginBottom: '1rem' }}>
        {TIERS.map((t) => <div key={t} className={`card stat tier-card-${t}`}><div className="n">{n(t)?.members ?? 0}</div><div className="l">{t[0].toUpperCase() + t.slice(1)} members</div><div className="s">{n(t)?.hand_picked ?? 0} hand-picked · {n(t)?.push_opted_in ?? 0} with notifications on</div></div>)}
      </div>
      <div className="grid cols-2">
        <div className="card">
          <h2>Hand-pick a member</h2>
          <p className="small muted">Launch Black list, 777 rejoiners, life members. Override holds until the date in settings (Gold promo end) unless cleared.</p>
          <input type="text" placeholder="Search name or member number" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }} />
          {hits.length > 0 && <table style={{ marginTop: '.5rem' }}><tbody>{hits.map((h) => <tr key={h.id}><td><b>{h.full_name}</b> <span className="small muted">#{h.member_number} · {h.city} · {h.status}</span></td>
            <td style={{ whiteSpace: 'nowrap' }}>{TIERS.map((t) => <button key={t} className={`btn sm ${h.tier_override === t ? 'primary' : 'ghost'}`} style={{ marginLeft: 4 }} onClick={() => setOverride(h.id, t, 'Hand-picked by ' + staff?.email)}>{t}</button>)}</td></tr>)}</tbody></table>}
          <h3 style={{ marginTop: '1rem' }}>Currently hand-picked ({picked.length})</h3>
          <table><tbody>{picked.map((p) => <tr key={p.id}><td><Link to={`/members/${p.id}`}>{p.full_name}</Link> <span className="small muted">#{p.member_number}</span></td><td><span className={`pill tier-${p.tier_override}`}>{p.tier_override}</span></td><td><button className="btn ghost sm" onClick={() => setOverride(p.id, null)}>Clear</button></td></tr>)}
            {picked.length === 0 && <tr><td className="muted">Nobody yet.</td></tr>}</tbody></table>
        </div>
        <div className="card">
          <h2>Rules</h2>
          {settings && <form onSubmit={saveSettings} style={{ display: 'grid', gap: '.5rem' }}>
            <div className="grid cols-2">
              <label className="f">Anniversary date<input name="anniversary_date" type="date" defaultValue={settings.anniversary_date} /></label>
              <label className="f">Gold promo: bar check-in before<input name="gold_promo_ends" type="date" defaultValue={settings.gold_promo_ends} /></label>
              <label className="f">…earns Gold until<input name="gold_promo_until" type="date" defaultValue={settings.gold_promo_until} /></label>
              <label className="f">Check-ins per code per day<input name="checkin_max_per_day" type="number" defaultValue={settings.checkin_max_per_day} /></label>
              <label className="f">Black: check-ins per month (rolling 3 mo)<input name="black_per_month" type="number" step="0.5" defaultValue={settings.black_per_month} /></label>
              <label className="f">Gold: check-ins per month<input name="gold_per_month" type="number" step="0.5" defaultValue={settings.gold_per_month} /></label>
              <label className="f">Gold: or points per quarter<input name="gold_points_per_quarter" type="number" defaultValue={settings.gold_points_per_quarter} /></label>
            </div>
            <button className="btn" disabled={staff?.role !== 'admin'}>Save rules</button>
          </form>}
          <p className="small muted" style={{ marginTop: '.75rem' }}>Points: check-in 10 (max 1 per code per day), event 25, volunteering 50, referral 200, on-time renewal 50. Gaming-floor activity never earns points. A member dropping out of Black gets one grace month. Tier changes queue a push notification to that member and recolour their app.</p>
        </div>
      </div>
    </>
  )
}
