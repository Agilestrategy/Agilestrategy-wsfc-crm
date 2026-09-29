// Shared with the console. Same arithmetic as membership_price() in the database: instalment rounded to the cent.
export const priceFor = (annual, f) => {
  const inst = Math.round((Number(annual) * (1 + Number(f.premium_pct) / 100) / f.per_year) * 100) / 100
  return { instalment: inst, year_total: Math.round(inst * f.per_year * 100) / 100 }
}
