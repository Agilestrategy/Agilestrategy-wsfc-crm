// Whakatāne conditions for the member app: weather, wind, sea state and indicative tides.
// GET /.netlify/functions/conditions  ->  { fetched_at, weather, marine, tides, attribution }
// Source: Open-Meteo (free for non commercial use, attribution shown in the app). One upstream fetch every 30 minutes,
// cached in Supabase (table conditions_cache) when the service key is set, otherwise in the function's memory.
// Bite times, sun and moon are computed on the phone (src/lib/solunar.js), not here.
import { createClient } from '@supabase/supabase-js'

// Spots the app can ask for (?place=). Land point for weather, marine point just offshore for swell and sea level.
const PLACES = {
  whakatane: { name: 'Whakatāne', lat: -37.955, lng: 176.985, mlat: -37.90, mlng: 177.00, tideOffset: 40 },
  ohope:     { name: 'Ōhope',     lat: -37.975, lng: 177.10,  mlat: -37.93, mlng: 177.12, tideOffset: 40 },
  opotiki:   { name: 'Ōpōtiki',   lat: -38.005, lng: 177.287, mlat: -37.95, mlng: 177.30, tideOffset: 35 },
}
const TZ = 'Pacific/Auckland'
const TTL_MS = 30 * 60 * 1000
// The global tide model runs early and relative to mean sea level at the offshore grid point. Two local corrections, tuned against the
// published Whakatāne tables (Sept 2026): times +40 min, heights +1.0 m to approximate chart datum. Override with env if the harbour master says otherwise.
const TIDE_DATUM_M = Number(process.env.TIDE_DATUM_M ?? 1.0)
const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*', ...extra } })

const memory = {}

const forecastUrl = (pl) => `https://api.open-meteo.com/v1/forecast?latitude=${pl.lat}&longitude=${pl.lng}&timezone=${encodeURIComponent(TZ)}&forecast_days=3&wind_speed_unit=kn` +
  '&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day' +
  '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m' +
  '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant'
const marineUrl = (pl) => `https://marine-api.open-meteo.com/v1/marine?latitude=${pl.mlat}&longitude=${pl.mlng}&timezone=${encodeURIComponent(TZ)}&forecast_days=3` +
  '&current=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature' +
  '&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature,sea_level_height_msl'

// Highs and lows from the hourly sea level curve, refined with a parabola through the three points around each turn.
function tidesFrom(times, levels, offsetMin) {
  const out = []
  for (let i = 1; i < levels.length - 1; i++) {
    const a = levels[i - 1], b = levels[i], c = levels[i + 1]
    if (a == null || b == null || c == null) continue
    const isHigh = b >= a && b > c, isLow = b <= a && b < c
    if (!isHigh && !isLow) continue
    const denom = a - 2 * b + c
    const offset = denom === 0 ? 0 : 0.5 * (a - c) / denom      // hours from sample i, in (-1, 1)
    const level = denom === 0 ? b : b - 0.25 * (a - c) * offset
    const t = new Date(times[i] + ':00' + tzSuffix(times[i]))
    t.setMinutes(t.getMinutes() + Math.round(offset * 60) + offsetMin)
    out.push({ type: isHigh ? 'high' : 'low', time: t.toISOString(), height: Math.round((level + TIDE_DATUM_M) * 100) / 100, height_msl: Math.round(level * 100) / 100 })
  }
  return out
}
// Open-Meteo returns local wall clock times without an offset; NZ is +12 or +13 (NZDT late Sep to early Apr).
function tzSuffix(local) {
  const d = new Date(local + ':00Z')
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' }).formatToParts(d)
  const off = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+12'
  const m = off.match(/([+-])(\d{1,2})(?::?(\d{2}))?/)
  return m ? `${m[1]}${m[2].padStart(2, '0')}:${m[3] || '00'}` : '+12:00'
}

async function fetchAll(pl) {
  const [f, m] = await Promise.all([fetch(forecastUrl(pl)), fetch(marineUrl(pl))])
  if (!f.ok) throw new Error('forecast ' + f.status)
  const forecast = await f.json()
  const marine = m.ok ? await m.json() : null
  const tides = marine?.hourly?.sea_level_height_msl ? tidesFrom(marine.hourly.time, marine.hourly.sea_level_height_msl, Number(process.env.TIDE_OFFSET_MIN ?? pl.tideOffset)) : []
  return {
    fetched_at: new Date().toISOString(),
    place: pl.name, lat: pl.lat, lng: pl.lng, tz: TZ,
    weather: { current: forecast.current, hourly: forecast.hourly, daily: forecast.daily, units: { ...forecast.current_units, ...forecast.hourly_units } },
    marine: marine ? { current: marine.current, hourly: marine.hourly, units: { ...marine.current_units, ...marine.hourly_units } } : null,
    tides,
    attribution: `Weather and sea state: Open-Meteo.com. Tides are model estimates for the ${pl.name} coast, not official LINZ tables, not for navigation.`,
  }
}

export default async (req) => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const db = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null
  const fresh = (row) => row && Date.now() - new Date(row.fetched_at).valueOf() < TTL_MS
  const placeKey = (new URL(req.url).searchParams.get('place') || 'whakatane').toLowerCase()
  const pl = PLACES[placeKey] || PLACES.whakatane
  const cacheKey = pl === PLACES.whakatane ? 'whakatane' : placeKey
  try {
    if (fresh(memory[cacheKey])) return json(memory[cacheKey], 200, { 'X-Cache': 'memory' })
    if (db) {
      const { data } = await db.from('conditions_cache').select('payload, fetched_at').eq('key', cacheKey).maybeSingle()
      if (data && fresh(data)) { memory[cacheKey] = data.payload; return json(memory[cacheKey], 200, { 'X-Cache': 'db' }) }
    }
    const payload = await fetchAll(pl)
    memory[cacheKey] = payload
    if (db) await db.from('conditions_cache').upsert({ key: cacheKey, payload, fetched_at: payload.fetched_at })
    return json(payload, 200, { 'X-Cache': 'miss' })
  } catch (e) {
    if (memory[cacheKey]) return json(memory[cacheKey], 200, { 'X-Cache': 'stale' })
    if (db) { const { data } = await db.from('conditions_cache').select('payload').eq('key', cacheKey).maybeSingle(); if (data) return json(data.payload, 200, { 'X-Cache': 'stale-db' }) }
    return json({ error: e.message }, 502)
  }
}

