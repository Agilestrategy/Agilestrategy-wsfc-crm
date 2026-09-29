-- 0007 · Merch by status tier: Gold and Black discounts, Black only (limited) items, list prices set 25% above base
-- Decision (Paul, 30 Sep 2026): retail on merch sits 25% higher as standard; Gold members get 10% off, Black 25% off;
-- limited items open at Black and show shaded to everyone else.

alter table shop_settings
  add column if not exists discount_gold numeric(5,2) not null default 10,
  add column if not exists discount_black numeric(5,2) not null default 25,
  add column if not exists retail_markup_pct numeric(5,2) not null default 25,   -- list price = base price x (1 + markup)
  add column if not exists repriced_at timestamptz;

alter table shop_products
  add column if not exists min_tier status_tier,                 -- null = everyone; 'gold' or 'black' = that tier and above
  add column if not exists is_limited boolean not null default false,
  add column if not exists base_price numeric(10,2);             -- price before the standard markup, for reference

alter table shop_orders
  add column if not exists member_tier status_tier,
  add column if not exists discount_pct numeric(5,2) not null default 0,
  add column if not exists discount_amount numeric(10,2) not null default 0;

alter table shop_order_items
  add column if not exists list_price numeric(10,2);             -- price before the member discount

-- One off reprice of the club range: keep the old price as base_price, list price = ceil(base x 1.25) whole dollars.
update shop_products
   set base_price = retail_price,
       retail_price = ceil(retail_price * 1.25)
 where source = 'club' and retail_price is not null and base_price is null;
update shop_settings set repriced_at = now() where id = 1 and repriced_at is null;

-- Discount for a tier
create or replace function shop_discount_pct(p_tier status_tier) returns numeric
language sql stable set search_path = public as $$
  select case p_tier when 'black' then discount_black when 'gold' then discount_gold else 0 end from shop_settings where id = 1;
$$;
grant execute on function shop_discount_pct(status_tier) to authenticated;

-- Tier rank helper for gating
create or replace function tier_rank(p_tier status_tier) returns int
language sql immutable as $$ select case p_tier when 'black' then 3 when 'gold' then 2 when 'silver' then 1 else 0 end $$;
