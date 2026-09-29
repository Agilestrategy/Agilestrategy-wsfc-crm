// Shared with the console. Same arithmetic as membership_price() in the database: instalment rounded to the cent.
export const priceFor = (annual, f) => {
  const inst = Math.round((Number(annual) * (1 + Number(f.premium_pct) / 100) / f.per_year) * 100) / 100
  return { instalment: inst, year_total: Math.round(inst * f.per_year * 100) / 100 }
}

// Merch: tier gating and member discounts (same rules as shop-order.mjs on the server)
export const TIER_RANK = { silver: 1, gold: 2, black: 3 }
export const TIER_LABEL = { silver: 'Silver', gold: 'Gold', black: 'Black' }
export const memberPrice = (list, pct) => Math.round(Number(list) * (1 - Number(pct || 0) / 100) * 100) / 100
