import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'

const TYPES = ['swipe_bar', 'swipe_door', 'event', 'volunteer', 'other']

export default function Checkins() {
  const [rows, setRows] = useState([]); const [qr, setQr] = useState({}); const [msg, setMsg] = useState('')
  const base = window.location.origin
  const load = async () => {
    const { data } = await supabase.from('checkin_points').select('*').order('created_at'); setRows(data || [])
    const imgs = {}
    for (const r of data || []) imgs[r.code] = await QRCode.toDataURL(`${base}/me/checkin/${r.code}`, { width: 320, margin: 1, color: { dark: '#1B2F3E' } })
    setQr(imgs)
  }
  useEffect(() => { load() }, [])
  async function add(e) {
    e.preventDefault(); const f = new FormData(e.target)
    const { error } = await supabase.from('checkin_points').insert({ code: f.get('code').trim().toUpperCase(), name: f.get('name'), engagement: f.get('engagement'), points: Number(f.get('points')), valid_from: f.get('valid_from') || null, valid_to: f.get('valid_to') || null })
    setMsg(error ? error.message : 'Added.'); e.target.reset(); load()
  }
  async function toggle(r) { await supabase.from('checkin_points').update({ is_active: !r.is_active }).eq('id', r.id); load() }
  function printPoster(r) {
    const w = window.open('', '_blank'); if (!w) return
    w.document.write(`<html><head><title>${r.name}</title><style>body{font-family:Arial,sans-serif;text-align:center;padding:40px;color:#1B2F3E}h1{font-size:40px;margin:0 0 6px}p{font-size:22px;margin:6px 0}img{width:420px}.code{font-size:34px;letter-spacing:.2em;font-weight:800;margin-top:14px}.small{font-size:16px;color:#666}</style></head><body>
      <img src="/wsfc-logo.png" style="width:140px"><h1>Check in here</h1><p>Scan with your phone camera to earn Status points</p><img src="${qr[r.code]}"><div class="code">${r.code}</div><p class="small">${r.name} · or type the code in the WSFC Members app · ${base}/me</p></body></html>`)
    w.document.close(); w.focus(); setTimeout(() => w.print(), 400)
  }
  return (
    <>
      <div className="page-head"><div><h1>Check-in codes</h1><p>Each code is a QR poster. Members scan it in the app and earn points.</p></div></div>
      {msg && <div className="alert">{msg}</div>}
      <div className="grid cols-2">
        <div>
          {rows.map((r) => (
            <div key={r.id} className="card" style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '1rem', marginBottom: '.75rem', alignItems: 'center', opacity: r.is_active ? 1 : .5 }}>
              {qr[r.code] ? <img src={qr[r.code]} alt="" style={{ width: 120 }} /> : <div />}
              <div>
                <h2>{r.name} <span className="pill">{r.code}</span></h2>
                <div className="small muted">{r.engagement} · {r.points} pts{r.valid_from ? ` · ${r.valid_from} → ${r.valid_to || 'open'}` : ''} · {r.is_active ? 'active' : 'inactive'}</div>
                <div className="small muted">{base}/me/checkin/{r.code}</div>
                <div style={{ marginTop: '.5rem', display: 'flex', gap: '.4rem' }}><button className="btn sm" onClick={() => printPoster(r)}>Print poster</button><button className="btn ghost sm" onClick={() => toggle(r)}>{r.is_active ? 'Deactivate' : 'Activate'}</button></div>
              </div>
            </div>
          ))}
        </div>
        <form className="card" onSubmit={add} style={{ display: 'grid', gap: '.6rem', alignContent: 'start' }}>
          <h2>New code</h2>
          <label className="f">Code (short, printed under the QR)<input name="code" required placeholder="WEIGHIN" /></label>
          <label className="f">Name<input name="name" required placeholder="Tournament weigh-in" /></label>
          <label className="f">Counts as<select name="engagement" defaultValue="event">{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="f">Points<input name="points" type="number" defaultValue={25} /></label>
          <div className="grid cols-2"><label className="f">Valid from<input name="valid_from" type="date" /></label><label className="f">Valid to<input name="valid_to" type="date" /></label></div>
          <button className="btn primary">Add code</button>
          <p className="small muted">Bar and door codes are permanent. Event codes get a date range so they cannot be reused after the night.</p>
        </form>
      </div>
    </>
  )
}
