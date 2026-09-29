import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { solunar, fmtTime } from '../lib/solunar'

// "Whakatāne today": wind, sea, tides, bite times, sun and moon. Bite times are computed on the phone;
// weather, sea state and tides come from /.netlify/functions/conditions (Open-Meteo, cached 30 min).

const TZ = 'Pacific/Auckland'
const WMO = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail' }
const compass = (deg) => deg == null ? '' : ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]
const r1 = (n) => (n == null ? '–' : Math.round(Number(n) * 10) / 10)
const r0 = (n) => (n == null ? '–' : Math.round(Number(n)))
const dayKey = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ })   // YYYY-MM-DD in NZ

// Spots members fish from. Bite times are computed for each spot's own coordinates; weather and tides come per spot from the function.
export const PLACES = {
  whakatane: { name: 'Whakatāne', lat: -37.955, lng: 176.985 },
  ohope: { name: 'Ōhope', lat: -37.975, lng: 177.10 },
  opotiki: { name: 'Ōpōtiki', lat: -38.005, lng: 177.287 },
}
const PLACE_KEY = 'wsfc-place'
const loadPlace = () => { try { const k = localStorage.getItem(PLACE_KEY); return PLACES[k] ? k : 'whakatane' } catch { return 'whakatane' } }
const savePlace = (k) => { try { localStorage.setItem(PLACE_KEY, k) } catch { /* ignore */ } }

const cache = {}
export async function loadConditions(place = 'whakatane') {
  const c = cache[place]
  if (c && Date.now() - c.at < 10 * 60 * 1000) return c.data
  const r = await fetch(`/.netlify/functions/conditions?place=${encodeURIComponent(place)}`, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error('conditions ' + r.status)
  const data = await r.json(); cache[place] = { at: Date.now(), data }; return data
}

// Sample payload for the demo or when the function is unreachable (offline, local dev without netlify).
function sample() {
  const now = new Date(); const k = dayKey(now)
  const t = (h) => { const d = new Date(now); d.setHours(h, 0, 0, 0); return d.toISOString() }
  return {
    fetched_at: now.toISOString(), sample: true,
    weather: { current: { temperature_2m: 17.4, apparent_temperature: 16.1, weather_code: 2, wind_speed_10m: 9, wind_gusts_10m: 14, wind_direction_10m: 225, is_day: 1 },
      daily: { time: [k], weather_code: [2], temperature_2m_max: [19], temperature_2m_min: [11], precipitation_probability_max: [15], wind_speed_10m_max: [13], wind_gusts_10m_max: [20], wind_direction_10m_dominant: [230] } },
    marine: { current: { wave_height: 0.9, wave_period: 7.5, wave_direction: 40, swell_wave_height: 0.7, swell_wave_period: 9, swell_wave_direction: 35, sea_surface_temperature: 15.5 } },
    tides: [{ type: 'low', time: t(3), height: 0.3 }, { type: 'high', time: t(9), height: 1.8 }, { type: 'low', time: t(15), height: 0.3 }, { type: 'high', time: t(21), height: 1.8 }],
    attribution: 'Sample conditions for the demo. Live app: Open-Meteo weather and sea state, model tide estimates (not for navigation).',
  }
}

export default function Conditions({ compact = false }) {
  const [data, setData] = useState(null); const [err, setErr] = useState(false); const [day, setDay] = useState(0)
  const [place, setPlace] = useState(loadPlace)
  useEffect(() => { setData(null); loadConditions(place).then(setData).catch(() => { setErr(true); setData(sample()) }) }, [place])
  const dates = useMemo(() => [0, 1].map((n) => new Date(Date.now() + n * 864e5)), [])
  const sol = useMemo(() => solunar(dates[day], PLACES[place]), [dates, day, place])
  const pickPlace = (k) => { setPlace(k); savePlace(k) }
  const now = new Date()
  const cur = data?.weather?.current, sea = data?.marine?.current
  const key = dayKey(dates[day])
  const di = data?.weather?.daily?.time?.indexOf(key) ?? -1
  const daily = di >= 0 ? Object.fromEntries(Object.entries(data.weather.daily).map(([k, v]) => [k, Array.isArray(v) ? v[di] : v])) : null
  const tides = (data?.tides || []).filter((t) => dayKey(t.time) === key)
  const inWindow = (w) => day === 0 && now >= w.start && now <= w.end
  const nextTide = (data?.tides || []).find((t) => new Date(t.time) > now)

  return (
    <div className="me-card cond">
      <div className="cond-head">
        <h2>{PLACES[place].name} {day === 0 ? 'today' : 'tomorrow'}</h2>
        <div className="cond-tabs"><button type="button" className={day === 0 ? 'on' : ''} onClick={() => setDay(0)}>Today</button><button type="button" className={day === 1 ? 'on' : ''} onClick={() => setDay(1)}>Tomorrow</button></div>
      </div>

      <div className="cond-places">{Object.entries(PLACES).map(([k, v]) => <button key={k} type="button" className={place === k ? 'on' : ''} onClick={() => pickPlace(k)}>{v.name}</button>)}</div>

      {day === 0 && cur && (
        <div className="cond-now">
          <div className="cond-big">{r0(cur.temperature_2m)}°<span>{WMO[cur.weather_code] || ''}</span></div>
          <div className="cond-grid">
            <div><b>{r0(cur.wind_speed_10m)} kn</b><span>{compass(cur.wind_direction_10m)} wind, gusts {r0(cur.wind_gusts_10m)}</span></div>
            {sea && <div><b>{r1(sea.swell_wave_height ?? sea.wave_height)} m</b><span>{compass(sea.swell_wave_direction ?? sea.wave_direction)} swell, {r0(sea.swell_wave_period ?? sea.wave_period)} s</span></div>}
            {sea && <div><b>{r1(sea.sea_surface_temperature)}°</b><span>sea temp</span></div>}
            {nextTide && <div><b>{fmtTime(nextTide.time)}</b><span>next {nextTide.type} tide{nextTide.height != null ? `, ${r1(nextTide.height)} m` : ''}</span></div>}
          </div>
        </div>
      )}
      {day === 1 && daily && (
        <div className="cond-now">
          <div className="cond-big">{r0(daily.temperature_2m_max)}°<span>{WMO[daily.weather_code] || ''} · low {r0(daily.temperature_2m_min)}°</span></div>
          <div className="cond-grid">
            <div><b>{r0(daily.wind_speed_10m_max)} kn</b><span>{compass(daily.wind_direction_10m_dominant)} wind, gusts to {r0(daily.wind_gusts_10m_max)}</span></div>
            <div><b>{r0(daily.precipitation_probability_max)}%</b><span>chance of rain</span></div>
          </div>
        </div>
      )}

      <div className="cond-sec">
        <div className="cond-title">Bite times <span className="cond-rating" title={`${sol.rating} of 5`}>{[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= sol.rating ? 'on' : ''} />)}<em>{['', 'Slow', 'Fair', 'Good', 'Very good', 'Best'][sol.rating]}</em></span></div>
        <ul className="cond-bites">
          {[...sol.majors.map((w) => ({ ...w, major: true })), ...sol.minors].sort((a, b) => a.peak - b.peak).map((w, i) => (
            <li key={i} className={`${w.major ? 'major' : 'minor'} ${inWindow(w) ? 'now' : ''}`}>
              <span className="cond-kind">{w.major ? 'Major' : 'Minor'}</span>
              <b>{fmtTime(w.start)} to {fmtTime(w.end)}</b>
              <span className="cond-why">{w.kind}{inWindow(w) ? ' · now' : ''}</span>
            </li>
          ))}
        </ul>
      </div>

      {!compact && (
        <>
          <div className="cond-sec">
            <div className="cond-title">Tides</div>
            {tides.length ? <div className="cond-tides">{tides.map((t, i) => <div key={i} className={t.type}><span>{t.type === 'high' ? 'High' : 'Low'}</span><b>{fmtTime(t.time)}</b>{t.height != null && <em>{r1(t.height)} m</em>}</div>)}</div> : <p className="me-muted">Tide estimates are loading.</p>}
          </div>
          <div className="cond-sec cond-sunmoon">
            <div><span>Sunrise</span><b>{fmtTime(sol.sun.rise)}</b></div>
            <div><span>Sunset</span><b>{fmtTime(sol.sun.set)}</b></div>
            <div><span>Moonrise</span><b>{fmtTime(sol.moon.rise)}</b></div>
            <div><span>Moonset</span><b>{fmtTime(sol.moon.set)}</b></div>
            <div className="wide"><span>Moon</span><b>{sol.moon.name}, {sol.moon.illumination}%</b></div>
          </div>
        </>
      )}
      {compact && <Link to="/me/conditions" className="cond-more">All tides, sun and moon</Link>}
      <p className="cond-foot">{data?.attribution || 'Loading conditions…'}{err && !data?.sample ? ' (offline, showing sample)' : ''} Bite times: solunar calculation for {PLACES[place].name}.</p>
    </div>
  )
}
