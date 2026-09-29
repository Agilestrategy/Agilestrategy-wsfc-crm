-- 0004 · Merchandise: Shopify store connected to the club dashboard
-- Shopify runs the shop (products, checkout, payment). The CRM mirrors products and orders,
-- tracks each order through the club's own fulfilment flow, builds the Friday run for Mark,
-- and shows run readiness against the 10 unit minimum.
-- Run in the Supabase SQL editor. Idempotent.

do $$ begin
  create type merch_status as enum ('paid','in_next_run','sent_to_mark','at_club','collected','cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Settings (single row)
-- ---------------------------------------------------------------------------
create table if not exists shop_settings (
  id int primary key default 1 check (id = 1),
  store_domain text,                       -- e.g. wsfc-merch.myshopify.com (public, used for links only)
  store_url text,                          -- public storefront URL shown to members, e.g. https://shop.wsfc.co.nz
  min_run int not null default 10,         -- supplier minimum per item per lot
  run_day int not null default 5,          -- 5 = Friday (ISO)
  last_order_sync_at timestamptz,
  last_product_sync_at timestamptz,
  last_sync_error text,
  updated_at timestamptz not null default now()
);
insert into shop_settings (id) values (1) on conflict (id) do nothing;
alter table shop_settings enable row level security;
drop policy if exists shop_settings_read on shop_settings;
create policy shop_settings_read on shop_settings for select to authenticated using (true);
drop policy if exists shop_settings_admin on shop_settings;
create policy shop_settings_admin on shop_settings for all to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- Products and variants (mirrored from Shopify; club-side cost fields editable here)
-- ---------------------------------------------------------------------------
create table if not exists shop_products (
  id uuid primary key default gen_random_uuid(),
  shopify_product_id bigint unique,
  title text not null,
  handle text,
  product_type text,
  vendor text,
  status text,                             -- active | draft | archived (from Shopify)
  image_url text,
  supplier_code text,                      -- e.g. 104743
  unit_cost numeric(10,2),                 -- supplier unit cost ex GST at the tier the club orders
  setup_cost numeric(10,2) default 0,      -- per lot, ex GST
  min_run int,                             -- overrides shop_settings.min_run when set
  is_preorder boolean not null default false,
  preorder_target int,
  preorder_closes date,
  stock_on_hand int not null default 0,    -- club-held stock (top ups, bar stock)
  updated_at timestamptz not null default now()
);
alter table shop_products enable row level security;
drop policy if exists shop_products_staff on shop_products;
create policy shop_products_staff on shop_products for all to authenticated using (is_staff()) with check (is_staff());
drop policy if exists shop_products_member_read on shop_products;
create policy shop_products_member_read on shop_products for select to authenticated using (status = 'active');

create table if not exists shop_variants (
  id uuid primary key default gen_random_uuid(),
  shopify_variant_id bigint unique,
  product_id uuid not null references shop_products(id) on delete cascade,
  title text,                              -- "M / Black"
  sku text,
  price numeric(10,2),
  inventory_quantity int,
  updated_at timestamptz not null default now()
);
create index if not exists shop_variants_product on shop_variants(product_id);
alter table shop_variants enable row level security;
drop policy if exists shop_variants_staff on shop_variants;
create policy shop_variants_staff on shop_variants for all to authenticated using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- Runs: one consolidated order to Mark, normally each Friday
-- ---------------------------------------------------------------------------
create table if not exists shop_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null default current_date,
  status text not null default 'open',     -- open | sent | received | closed
  sent_at timestamptz,
  sent_by text,
  received_at timestamptz,
  order_count int not null default 0,
  unit_count int not null default 0,
  topup_units int not null default 0,      -- units added to reach the minimum, held as club stock
  lines jsonb not null default '[]'::jsonb, -- snapshot of the export sent to Mark
  notes text,
  created_at timestamptz not null default now()
);
alter table shop_runs enable row level security;
drop policy if exists shop_runs_staff on shop_runs;
create policy shop_runs_staff on shop_runs for all to authenticated using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- Orders and lines (mirrored from Shopify; status is the club's own flow)
-- ---------------------------------------------------------------------------
create table if not exists shop_orders (
  id uuid primary key default gen_random_uuid(),
  shopify_order_id bigint unique,
  order_number text,                       -- "#1001"
  shopify_created_at timestamptz,
  shopify_updated_at timestamptz,
  email text,
  phone text,
  customer_name text,
  member_id uuid references members(id) on delete set null,   -- matched by email when possible
  financial_status text,                   -- paid | pending | refunded | ...
  fulfillment_status text,                 -- Shopify's view (null | fulfilled | partial)
  subtotal numeric(10,2),
  total numeric(10,2),
  currency text default 'NZD',
  status merch_status not null default 'paid',
  run_id uuid references shop_runs(id) on delete set null,
  note text,
  raw jsonb,
  status_updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists shop_orders_status on shop_orders(status);
create index if not exists shop_orders_member on shop_orders(member_id);
create index if not exists shop_orders_email on shop_orders(lower(email));
alter table shop_orders enable row level security;
drop policy if exists shop_orders_staff on shop_orders;
create policy shop_orders_staff on shop_orders for all to authenticated using (is_staff()) with check (is_staff());
drop policy if exists shop_orders_member_read on shop_orders;
create policy shop_orders_member_read on shop_orders for select to authenticated
  using (member_id in (select id from members where auth_user_id = auth.uid())
         or lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));

create table if not exists shop_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references shop_orders(id) on delete cascade,
  shopify_line_id bigint unique,
  product_id uuid references shop_products(id) on delete set null,
  variant_id uuid references shop_variants(id) on delete set null,
  shopify_product_id bigint,
  shopify_variant_id bigint,
  title text not null,
  variant_title text,
  sku text,
  quantity int not null default 1,
  price numeric(10,2)
);
create index if not exists shop_order_items_order on shop_order_items(order_id);
create index if not exists shop_order_items_product on shop_order_items(product_id);
alter table shop_order_items enable row level security;
drop policy if exists shop_order_items_staff on shop_order_items;
create policy shop_order_items_staff on shop_order_items for all to authenticated using (is_staff()) with check (is_staff());
drop policy if exists shop_order_items_member_read on shop_order_items;
create policy shop_order_items_member_read on shop_order_items for select to authenticated
  using (order_id in (select id from shop_orders));   -- shop_orders RLS already limits to own orders

create table if not exists shop_sync_log (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  source text not null default 'schedule',  -- schedule | webhook | manual
  products_upserted int not null default 0,
  orders_upserted int not null default 0,
  error text
);
alter table shop_sync_log enable row level security;
drop policy if exists shop_sync_log_staff on shop_sync_log;
create policy shop_sync_log_staff on shop_sync_log for all to authenticated using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- Match an order to a member by email (household primary first)
-- ---------------------------------------------------------------------------
create or replace function shop_match_member() returns trigger language plpgsql as $$
begin
  if new.member_id is null and new.email is not null then
    select id into new.member_id from members
      where lower(email) = lower(new.email)
      order by is_household_primary desc nulls last, created_at
      limit 1;
  end if;
  return new;
end $$;
drop trigger if exists shop_orders_match on shop_orders;
create trigger shop_orders_match before insert or update of email on shop_orders
  for each row execute function shop_match_member();

-- ---------------------------------------------------------------------------
-- Status changes: stamp the time; "at club" queues a push to the member
-- ---------------------------------------------------------------------------
create or replace function shop_order_status_changed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.status_updated_at := now();
    if new.status = 'at_club' and new.member_id is not null then
      insert into notifications (title, body, url, audience, created_by)
      values ('Your merch is at the club',
              'Order ' || coalesce(new.order_number, '') || ' has arrived. Collect it from the bar next time you are in.',
              '/me/orders', jsonb_build_object('member_ids', jsonb_build_array(new.member_id)), 'merch');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists shop_orders_status on shop_orders;
create trigger shop_orders_status before update on shop_orders
  for each row execute function shop_order_status_changed();

-- ---------------------------------------------------------------------------
-- Run readiness: units waiting per product against the minimum lot
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
  min(o.shopify_created_at) filter (where o.status in ('paid','in_next_run')) as oldest_waiting
from shop_products p
cross join shop_settings s
left join shop_order_items i on i.product_id = p.id
left join shop_orders o on o.id = i.order_id
where coalesce(p.status, 'active') <> 'archived'
group by p.id, s.min_run;

create or replace view v_merch_summary as
select
  (select count(*) from shop_orders where status = 'paid')::int as orders_new,
  (select count(*) from shop_orders where status = 'in_next_run')::int as orders_in_run,
  (select count(*) from shop_orders where status = 'sent_to_mark')::int as orders_with_mark,
  (select count(*) from shop_orders where status = 'at_club')::int as orders_at_club,
  (select coalesce(sum(total), 0) from shop_orders where status <> 'cancelled' and shopify_created_at > now() - interval '30 days')::numeric(10,2) as sales_30d,
  (select coalesce(sum(units_waiting), 0) from v_run_readiness)::int as units_waiting,
  (select last_order_sync_at from shop_settings where id = 1) as last_sync;

-- Build the Friday run: moves every paid / in_next_run order into a new run and snapshots the lines.
create or replace function shop_build_run(p_notes text default null) returns uuid language plpgsql security definer set search_path = public as $$
declare v_run uuid; v_lines jsonb; v_orders int; v_units int; v_topup int;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  insert into shop_runs (notes, sent_by) values (p_notes, auth.jwt() ->> 'email') returning id into v_run;

  -- Every waiting order joins the run, except orders holding a pre order item that has not reached its target yet.
  update shop_orders o set status = 'in_next_run', run_id = v_run
    where o.status in ('paid','in_next_run') and o.run_id is null
      and not exists (
        select 1 from shop_order_items i join v_run_readiness r on r.product_id = i.product_id
        where i.order_id = o.id and r.is_preorder and r.shortfall > 0);

  select jsonb_agg(l order by l->>'title', l->>'variant') into v_lines from (
    select jsonb_build_object(
      'product_id', i.product_id, 'title', i.title, 'variant', i.variant_title, 'sku', i.sku,
      'supplier_code', p.supplier_code, 'is_preorder', coalesce(p.is_preorder, false), 'quantity', sum(i.quantity),
      'orders', jsonb_agg(jsonb_build_object('order', o.order_number, 'name', o.customer_name, 'qty', i.quantity))
    ) as l
    from shop_order_items i join shop_orders o on o.id = i.order_id left join shop_products p on p.id = i.product_id
    where o.run_id = v_run group by i.product_id, i.title, i.variant_title, i.sku, p.supplier_code, p.is_preorder) x;

  select count(distinct o.id), coalesce(sum(i.quantity), 0) into v_orders, v_units
    from shop_orders o left join shop_order_items i on i.order_id = o.id where o.run_id = v_run;

  -- top up per product to the minimum lot (only where the product carries a minimum and is not a pre order)
  select coalesce(sum(greatest(r.min_run - q.qty, 0)), 0) into v_topup
    from (select i.product_id, sum(i.quantity) qty from shop_order_items i join shop_orders o on o.id = i.order_id where o.run_id = v_run group by i.product_id) q
    join v_run_readiness r on r.product_id = q.product_id where not r.is_preorder;

  update shop_runs set lines = coalesce(v_lines, '[]'::jsonb), order_count = v_orders, unit_count = v_units, topup_units = v_topup where id = v_run;
  return v_run;
end $$;

-- Mark a run as sent to Mark: every order in it moves to sent_to_mark.
create or replace function shop_send_run(p_run uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  update shop_orders set status = 'sent_to_mark' where run_id = p_run and status = 'in_next_run';
  update shop_runs set status = 'sent', sent_at = now(), sent_by = auth.jwt() ->> 'email' where id = p_run;
end $$;

-- Run received at the club: every order in it moves to at_club (which queues the member push).
create or replace function shop_receive_run(p_run uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  update shop_orders set status = 'at_club' where run_id = p_run and status = 'sent_to_mark';
  update shop_runs set status = 'received', received_at = now() where id = p_run;
end $$;
