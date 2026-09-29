// Sun, moon and solunar bite times, computed on the phone. No API, no cost.
// Standard low precision formulae (Meeus / Montenbruck), good to a minute or two, which is all a bite table needs.
// Bite times follow the usual solunar rule: the two MAJOR periods sit on the moon's upper and lower transit
// (moon overhead and moon underfoot), the two MINOR periods sit on moonrise and moonset.

const rad = Math.PI / 180
const dayMs = 864e5
const J1970 = 2440588, J2000 = 2451545
const e = rad * 23.4397 // obliquity of the ecliptic

const toJulian = (date) => date.valueOf() / dayMs - 0.5 + J1970
const toDays = (date) => toJulian(date) - J2000

const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l))
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l))
const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw
const altitude = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))

function sunCoords(d) {
  const M = rad * (357.5291 + 0.98560028 * d)
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  const L = M + C + rad * 102.9372 + Math.PI
  return { dec: declination(L, 0), ra: rightAscension(L, 0) }
}

function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d)   // ecliptic longitude
  const M = rad * (134.963 + 13.064993 * d)   // mean anomaly
  const F = rad * (93.272 + 13.229350 * d)    // argument of latitude
  const l = L + rad * 6.289 * Math.sin(M)
  const b = rad * 5.128 * Math.sin(F)
  const dt = 385001 - 20905 * Math.cos(M)     // distance km
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt }
}

function moonAltitude(date, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date)
  const c = moonCoords(d)
  const H = siderealTime(d, lw) - c.ra
  const h = altitude(H, phi, c.dec)
  return h + rad * 0.017 / Math.tan(h + rad * 10.26 / (h + rad * 5.10)) // refraction
}

function sunAltitude(date, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date)
  const c = sunCoords(d)
  return altitude(siderealTime(d, lw) - c.ra, phi, c.dec)
}

// Local hour angle of the moon, normalised to (-180, 180]. 0 = upper transit, ±180 = lower transit.
function moonHourAngle(date, lng) {
  const d = toDays(date); const c = moonCoords(d)
  let H = (siderealTime(d, rad * -lng) - c.ra) / rad
  H = ((H % 360) + 540) % 360 - 180
  return H
}

export function moonPhase(date = new Date()) {
  const d = toDays(date); const s = sunCoords(d); const m = moonCoords(d)
  const sdist = 149598000
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra))
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi))
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra))
  const fraction = (1 + Math.cos(inc)) / 2
  const phase = 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent']
  const idx = Math.round(phase * 8) % 8
  return { phase, fraction, name: names[idx], illumination: Math.round(fraction * 100) }
}

// Scan a local day for events: rise/set (altitude crossing) and transits (hour angle crossing).
function scanDay(dayStart, lat, lng) {
  const step = 2 * 60 * 1000 // 2 minutes, then refined by bisection
  const events = { moonrise: [], moonset: [], upper: [], lower: [], sunrise: [], sunset: [] }
  const moonHorizon = rad * 0.125 // moon's apparent rise/set altitude (parallax + semi diameter + refraction)
  const sunHorizon = rad * -0.833
  const refine = (f, a, b) => { for (let i = 0; i < 20; i++) { const m = (a + b) / 2; if (f(a) * f(m) <= 0) b = m; else a = m } return new Date((a + b) / 2) }
  let t = dayStart.valueOf(); const end = t + dayMs
  let mPrev = moonAltitude(new Date(t), lat, lng) - moonHorizon
  let sPrev = sunAltitude(new Date(t), lat, lng) - sunHorizon
  let hPrev = moonHourAngle(new Date(t), lng)
  for (t += step; t <= end; t += step) {
    const dt = new Date(t)
    const m = moonAltitude(dt, lat, lng) - moonHorizon
    if (mPrev < 0 && m >= 0) events.moonrise.push(refine((x) => moonAltitude(new Date(x), lat, lng) - moonHorizon, t - step, t))
    if (mPrev >= 0 && m < 0) events.moonset.push(refine((x) => moonAltitude(new Date(x), lat, lng) - moonHorizon, t - step, t))
    mPrev = m
    const s = sunAltitude(dt, lat, lng) - sunHorizon
    if (sPrev < 0 && s >= 0) events.sunrise.push(refine((x) => sunAltitude(new Date(x), lat, lng) - sunHorizon, t - step, t))
    if (sPrev >= 0 && s < 0) events.sunset.push(refine((x) => sunAltitude(new Date(x), lat, lng) - sunHorizon, t - step, t))
    sPrev = s
    const h = moonHourAngle(dt, lng)
    // upper transit: hour angle passes through 0 going up; lower transit: wraps from +180 to -180
    if (hPrev < 0 && h >= 0 && h - hPrev < 180) events.upper.push(refine((x) => moonHourAngle(new Date(x), lng), t - step, t))
    if (hPrev > 90 && h < -90) events.lower.push(refine((x) => { const v = moonHourAngle(new Date(x), lng); return v > 0 ? v - 360 : v }, t - step, t)) // continuous across the wrap
    hPrev = h
  }
  return events
}

// Local midnight for a calendar day in a given IANA zone (falls back to the device zone).
export function localDayStart(date = new Date(), tz = 'Pacific/Auckland') {
  try {
    const parts = new Intl.DateTimeFormat('en-NZ', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(date)
    const g = (k) => Number(parts.find((p) => p.type === k)?.value)
    const asUTC = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'))
    const offset = asUTC - Math.floor(date.valueOf() / 1000) * 1000
    const midnightLocalAsUTC = Date.UTC(g('year'), g('month') - 1, g('day'))
    return new Date(midnightLocalAsUTC - offset)
  } catch { const d = new Date(date); d.setHours(0, 0, 0, 0); return d }
}

/**
 * Bite times for one local day.
 * @returns {{ majors: [{start,end,peak,kind}], minors: [...], sun: {rise,set}, moon: {rise,set,upper,lower,phase}, rating: 1..5 }}
 */
export function solunar(date = new Date(), { lat = -37.955, lng = 176.985, tz = 'Pacific/Auckland' } = {}) {
  const start = localDayStart(date, tz)
  const ev = scanDay(start, lat, lng)
  const window = (t, mins, kind) => ({ start: new Date(t.valueOf() - mins * 30000), end: new Date(t.valueOf() + mins * 30000), peak: t, kind })
  const majors = [...ev.upper.map((t) => window(t, 120, 'Moon overhead')), ...ev.lower.map((t) => window(t, 120, 'Moon underfoot'))].sort((a, b) => a.peak - b.peak)
  const minors = [...ev.moonrise.map((t) => window(t, 60, 'Moonrise')), ...ev.moonset.map((t) => window(t, 60, 'Moonset'))].sort((a, b) => a.peak - b.peak)
  const phase = moonPhase(new Date(start.valueOf() + dayMs / 2))
  // Day rating: new and full moons are the strong days; a major that overlaps dawn or dusk adds to it.
  const cyc = Math.min(phase.phase, 1 - phase.phase) // 0 at new, .5 at full
  const nearNew = cyc < 0.08, nearFull = Math.abs(phase.phase - 0.5) < 0.08, quarter = Math.abs(cyc - 0.25) < 0.06
  let rating = nearNew || nearFull ? 4 : quarter ? 2 : 3
  const twilight = [...ev.sunrise, ...ev.sunset]
  if (majors.some((m) => twilight.some((t) => t >= m.start && t <= m.end))) rating += 1
  rating = Math.max(1, Math.min(5, rating))
  return {
    day: start, majors, minors,
    sun: { rise: ev.sunrise[0] || null, set: ev.sunset[0] || null },
    moon: { rise: ev.moonrise[0] || null, set: ev.moonset[0] || null, upper: ev.upper[0] || null, lower: ev.lower[0] || null, ...phase },
    rating,
  }
}

export const fmtTime = (d, tz = 'Pacific/Auckland') => (d ? new Date(d).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(/\s?([ap])\.?m\.?/i, '$1m').toLowerCase() : '–')
