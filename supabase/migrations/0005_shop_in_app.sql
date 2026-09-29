-- 0005 · Merchandise sold inside the member app (Stripe Checkout or pay at the club)
-- Part 1 must run on its own before part 2 (enum values cannot be used in the transaction that adds them).
-- Part 1:
--   alter type merch_status add value if not exists 'awaiting_payment' before 'paid';
-- Part 2 (this file, run after part 1). Idempotent.

-- ---------------------------------------------------------------------------
-- Products: club managed catalogue (Shopify mirror stays optional)
-- ---------------------------------------------------------------------------
alter table shop_products
  add column if not exists source text not null default 'club',           -- club | shopify
  add column if not exists retail_price numeric(10,2),                     -- inc GST, what the member pays
  add column if not exists description text,
  add column if not exists options jsonb not null default '{}'::jsonb,     -- {"Size":["S","M","L"],"Colour":["Black","White"]}
  add column if not exists is_active boolean not null default true,
  add column if not exists sort int not null default 100,
  add column if not exists lead_time text;                                 -- e.g. "Made to order, allow 3 to 4 weeks"

drop policy if exists shop_products_member_read on shop_products;
create policy shop_products_member_read on shop_products for select to authenticated
  using (is_active and coalesce(status, 'active') = 'active');

-- ---------------------------------------------------------------------------
-- Orders: payment fields
-- ---------------------------------------------------------------------------
alter table shop_orders
  add column if not exists payment_method text,                            -- stripe | at_club | shopify
  add column if not exists stripe_session_id text unique,
  add column if not exists stripe_payment_intent text,
  add column if not exists paid_at timestamptz,
  add column if not exists collection_note text;

-- order_number for club orders: WSFC-1001, WSFC-1002 ...
create sequence if not exists shop_order_seq start 1001;
create or replace function shop_next_order_number() returns text language sql as $$
  select 'WSFC-' || nextval('shop_order_seq')::text $$;

-- Items may carry the chosen options as text ("L / Black") in variant_title. Nothing else changes.

-- ---------------------------------------------------------------------------
-- Readiness and runs: only paid orders count
-- ---------------------------------------------------------------------------
create or replace view v_run_readiness as
select
  p.id as product_id,
  p.title,
  p.supplier_code,
  p.is_preorder,
  p.preorder_target,
  p.preorder_closes,
  coalesce(p.min_run, s.min_run) as min_run,
  p.stock_on_hand,
  coalesce(sum(i.quantity) filter (where o.status in ('paid','in_next_run')), 0)::int as units_waiting,
  count(distinct o.id) filter (where o.status in ('paid','in_next_run'))::int as orders_waiting,
  greatest(coalesce(case when p.is_preorder then p.preorder_target else coalesce(p.min_run, s.min_run) end, 0)
           - coalesce(sum(i.quantity) filter (where o.status in ('paid','in_next_run')), 0), 0)::int as shortfall,
  min(o.shopify_created_at) filter (where o.status in ('paid','in_next_run')) as oldest_waiting,
  coalesce(sum(i.quantity) filter (where o.status = 'awaiting_payment'), 0)::int as units_unpaid
from shop_products p
cross join shop_settings s
left join shop_order_items i on i.product_id = p.id
left join shop_orders o on o.id = i.order_id
where coalesce(p.status, 'active') <> 'archived' and p.is_active
group by p.id, s.min_run;

drop view if exists v_merch_summary;
create view v_merch_summary as
select
  (select count(*) from shop_orders where status = 'paid')::int as orders_new,
  (select count(*) from shop_orders where status = 'awaiting_payment')::int as orders_unpaid,
  (select count(*) from shop_orders where status = 'in_next_run')::int as orders_in_run,
  (select count(*) from shop_orders where status = 'sent_to_mark')::int as orders_with_mark,
  (select count(*) from shop_orders where status = 'at_club')::int as orders_at_club,
  (select coalesce(sum(total), 0) from shop_orders where status not in ('cancelled','awaiting_payment') and shopify_created_at > now() - interval '30 days')::numeric(10,2) as sales_30d,
  (select coalesce(sum(units_waiting), 0) from v_run_readiness)::int as units_waiting,
  (select last_order_sync_at from shop_settings where id = 1) as last_sync;

-- Paid stamp: when an order moves out of awaiting_payment, record paid_at.
create or replace function shop_order_status_changed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.status_updated_at := now();
    if old.status = 'awaiting_payment' and new.status <> 'cancelled' and new.paid_at is null then
      new.paid_at := now(); new.financial_status := 'paid';
    end if;
    if new.status = 'at_club' and new.member_id is not null then
      insert into notifications (title, body, url, audience, created_by)
      values ('Your merch is at the club',
              'Order ' || coalesce(new.order_number, '') || ' has arrived. Collect it from the bar next time you are in.',
              '/me/orders', jsonb_build_object('member_ids', jsonb_build_array(new.member_id)), 'merch');
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Seed the 60th anniversary range (prices inc GST from the pricing one pager, 28 Sep 2026).
-- Re-runnable: matched on supplier_code + title, only inserts what is missing.
-- ---------------------------------------------------------------------------
insert into shop_products (title, source, retail_price, supplier_code, unit_cost, setup_cost, min_run, options, description, sort, is_preorder, preorder_target, lead_time)
select * from (values
 ('Staple tee', 'club', 55.00, '5001', 23.95, 65.00, 10, '{"Size":["S","M","L","XL","2XL","3XL"],"Colour":["Black","White"]}'::jsonb, 'AS Colour Staple tee with the 60th anniversary badge on the left chest.', 10, false, null::int, null::text),
 ('Staple long sleeve tee', 'club', 65.00, '5020', 28.95, 65.00, 10, '{"Size":["S","M","L","XL","2XL","3XL"],"Colour":["Black","White"]}'::jsonb, 'AS Colour Staple long sleeve with the 60th badge on the left chest.', 20, false, null, null),
 ('Low Down singlet', 'club', 50.00, '5007', 23.95, 65.00, 10, '{"Size":["S","M","L","XL","2XL"],"Colour":["Black","White"]}'::jsonb, 'AS Colour Low Down singlet with the 60th badge on the left chest.', 30, false, null, null),
 ('Dual Tech performance tee', 'club', 110.00, 'DUALTECH', 47.95, 65.00, 10, '{"Size":["S","M","L","XL","2XL","3XL"]}'::jsonb, 'Quick dry performance tee for the boat, 60th badge on the left chest.', 40, false, null, null),
 ('Custom fishing polo', 'club', 130.00, '125987', 56.95, 0, 10, '{"Size":["S","M","L","XL","2XL","3XL"]}'::jsonb, 'Full colour sublimated fishing polo in black and white. Pre order: the run goes to print when 50 are ordered, allow 7 weeks.', 50, true, 50, 'Pre order, allow 7 weeks after the run closes'),
 ('UFlex cap', 'club', 55.00, 'UFLEX', 27.95, 65.00, 10, '{"Colour":["Black","Navy","Camo"]}'::jsonb, 'UFlex cap with the 60th badge on the front.', 60, false, null, null),
 ('UFlex 5 panel snapback', 'club', 65.00, 'U15518', 29.95, 65.00, 10, '{"Colour":["Black","Navy"]}'::jsonb, 'Pro style 5 panel snapback with a woven 60th badge.', 70, false, null, null),
 ('Fisherman knit beanie', 'club', 55.00, 'U20900', 25.95, 65.00, 10, '{"Colour":["Black","Navy","Camo"]}'::jsonb, 'UFlex fisherman beanie with a woven 60th badge.', 80, false, null, null),
 ('60th badge patch', 'club', 20.00, 'PATCH', 9.95, 65.00, 10, '{}'::jsonb, 'Woven 50 x 50 mm patch on black felt. Sew it on anything.', 90, false, null, null),
 ('Can cooler', 'club', 18.00, '104743', 7.50, 0, 50, '{}'::jsonb, 'Neoprene can cooler, full colour 60th wrap.', 100, false, null, null),
 ('Frontier dry bag', 'club', 20.00, '123084', 7.50, 0, 50, '{}'::jsonb, 'Lightweight black dry bag with the 60th badge.', 110, false, null, null),
 ('Speed bottle opener', 'club', 10.00, '129108', 4.50, 0, 50, '{}'::jsonb, 'Bramberg speed opener, full colour both sides.', 120, false, null, null),
 ('Floating key ring', 'club', 10.00, '100300', 3.75, 0, 100, '{}'::jsonb, 'Floating key ring so the boat keys come back.', 130, false, null, null),
 ('Dishcloth', 'club', 10.00, '123144', 4.95, 0, 100, '{}'::jsonb, '60th anniversary dishcloth, one colour print.', 140, false, null, null),
 ('Sticker', 'club', 5.00, '100114', 1.70, 0, 100, '{}'::jsonb, '60 mm round full colour sticker. Three for $10 at the bar.', 150, false, null, null),
 ('Bar runner', 'club', 60.00, '114090', 25.95, 0, 10, '{}'::jsonb, 'Full colour sublimated bar runner, the one from the club bar.', 160, false, null, null)
) as v(title, source, retail_price, supplier_code, unit_cost, setup_cost, min_run, options, description, sort, is_preorder, preorder_target, lead_time)
where not exists (select 1 from shop_products p where p.supplier_code = v.supplier_code and p.title = v.title);
