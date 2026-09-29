-- 0006 · App uptake tracking, conditions cache, membership subscriptions by frequency
-- Applied through the Supabase MCP connector (apply_migration).

-- ---------------------------------------------------------------------------
-- A. App uptake: who has actually signed in to the member app
-- ---------------------------------------------------------------------------
alter table members
  add column if not exists app_first_seen_at timestamptz,
  add column if not exists app_last_seen_at timestamptz,
  add column if not exists app_sessions int not null default 0,
  add column if not exists app_invited_at timestamptz;     -- last time we emailed / texted them an invite

-- Called by the app on every load. Links the signed in auth user to their member row (household primary first),
-- stamps first/last seen, and returns the member row. Security definer so a member matched only by email can be linked.
create or replace function app_link_me() returns setof members
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mail text; m members%rowtype;
begin
  if uid is null then return; end if;
  select email into mail from auth.users where id = uid;
  select * into m from members
    where auth_user_id = uid or (mail is not null and lower(email) = lower(mail))
    order by (auth_user_id = uid) desc, is_household_primary desc, created_at
    limit 1;
  if m.id is null then return; end if;
  update members set
    auth_user_id = coalesce(auth_user_id, uid),
    app_first_seen_at = coalesce(app_first_seen_at, now()),
    app_last_seen_at = now(),
    app_sessions = app_sessions + 1
  where id = m.id;
  return query select * from members where id = m.id;
end $$;
grant execute on function app_link_me() to authenticated;

-- Uptake summary for the console
create or replace view v_app_uptake as
select
  count(*) filter (where status = 'active')                                                  as active_members,
  count(*) filter (where status = 'active' and app_first_seen_at is not null)                as on_app,
  count(*) filter (where status = 'active' and app_last_seen_at > now() - interval '30 days') as active_30d,
  count(*) filter (where status = 'active' and push_opt_in)                                  as push_on,
  count(*) filter (where status = 'active' and app_first_seen_at is null and not do_not_contact
                   and email is not null and email_status not in ('cleaned','unsubscribed'))                      as reachable_email,
  count(*) filter (where status = 'active' and app_first_seen_at is null and not do_not_contact
                   and (email is null or email_status in ('cleaned','unsubscribed')) and mobile is not null)   as reachable_mobile_only,
  count(*) filter (where status = 'active' and app_first_seen_at is null and not do_not_contact
                   and (email is null or email_status in ('cleaned','unsubscribed')) and mobile is null)       as unreachable,
  count(*) filter (where status = 'active' and app_first_seen_at is null and app_invited_at is not null) as invited_waiting,
  count(*) filter (where app_first_seen_at is not null)                                      as on_app_all
from members;
alter view v_app_uptake set (security_invoker = true);
grant select on v_app_uptake to authenticated;

-- The marketing segment: active members who have not opened the app yet, with how we can reach them.
create or replace view v_app_not_yet as
select m.id, m.member_number, m.first_name, m.last_name, m.preferred_name, m.email, m.email_status, m.mobile, m.phone,
       m.status, m.status_tier, m.financial_until, c.name as category_name, m.household_id, m.is_household_primary,
       m.app_invited_at, m.do_not_contact,
       case when m.email is not null and m.email_status not in ('cleaned','unsubscribed') then 'email'
            when m.mobile is not null then 'sms' else 'none' end as channel
from members m
left join membership_categories c on c.id = m.category_id
where m.status = 'active' and m.app_first_seen_at is null;
alter view v_app_not_yet set (security_invoker = true);
grant select on v_app_not_yet to authenticated;

-- ---------------------------------------------------------------------------
-- B. Conditions cache (weather / sea / tides payload from the Netlify function)
-- ---------------------------------------------------------------------------
create table if not exists conditions_cache (
  key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table conditions_cache enable row level security;
-- service role only (the function writes and reads it); no policies for authenticated on purpose

-- ---------------------------------------------------------------------------
-- C. Subscriptions by frequency, with the club's premiums
-- ---------------------------------------------------------------------------
create table if not exists billing_frequencies (
  code text primary key,                 -- weekly | fortnightly | monthly | quarterly | six_monthly | annual
  label text not null,
  per_year int not null,                 -- instalments per year
  premium_pct numeric(5,2) not null default 0,
  stripe_interval text not null,         -- week | month | year
  stripe_interval_count int not null default 1,
  sort int not null default 100,
  is_active boolean not null default true
);
insert into billing_frequencies (code, label, per_year, premium_pct, stripe_interval, stripe_interval_count, sort) values
  ('weekly',      'Weekly',       52, 15, 'week',  1, 10),
  ('fortnightly', 'Fortnightly',  26, 15, 'week',  2, 20),
  ('monthly',     'Monthly',      12, 15, 'month', 1, 30),
  ('quarterly',   'Quarterly',     4, 10, 'month', 3, 40),
  ('six_monthly', 'Six monthly',   2,  5, 'month', 6, 50),
  ('annual',      'Annual',        1,  0, 'year',  1, 60)
on conflict (code) do nothing;
alter table billing_frequencies enable row level security;
drop policy if exists billing_frequencies_read on billing_frequencies;
create policy billing_frequencies_read on billing_frequencies for select to authenticated using (true);
drop policy if exists billing_frequencies_staff on billing_frequencies;
create policy billing_frequencies_staff on billing_frequencies for all to authenticated using (is_staff()) with check (is_staff());

-- Price a category at a frequency. Instalment is rounded to the cent; the yearly total is instalments x per_year.
create or replace function membership_price(p_category uuid, p_frequency text)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'category', c.name, 'frequency', f.code, 'label', f.label, 'per_year', f.per_year, 'premium_pct', f.premium_pct,
    'annual_fee', c.annual_fee,
    'instalment', round(c.annual_fee * (1 + f.premium_pct / 100) / f.per_year, 2),
    'year_total', round(c.annual_fee * (1 + f.premium_pct / 100) / f.per_year, 2) * f.per_year,
    'stripe_interval', f.stripe_interval, 'stripe_interval_count', f.stripe_interval_count)
  from membership_categories c, billing_frequencies f
  where c.id = p_category and f.code = p_frequency and f.is_active;
$$;
grant execute on function membership_price(uuid, text) to authenticated;

do $$ begin
  create type sub_status as enum ('incomplete','active','past_due','paused','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists member_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  category_id uuid references membership_categories(id),
  frequency text not null references billing_frequencies(code),
  annual_fee numeric(10,2) not null,
  premium_pct numeric(5,2) not null default 0,
  instalment numeric(10,2) not null,
  status sub_status not null default 'incomplete',
  stripe_customer_id text,
  stripe_subscription_id text unique,
  stripe_checkout_session text,
  current_period_end timestamptz,
  last_invoice_at timestamptz,
  last_invoice_amount numeric(10,2),
  cancel_at_period_end boolean not null default false,
  started_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists member_subscriptions_member_idx on member_subscriptions (member_id);
alter table member_subscriptions enable row level security;
drop policy if exists member_subscriptions_staff on member_subscriptions;
create policy member_subscriptions_staff on member_subscriptions for all to authenticated using (is_staff()) with check (is_staff());
drop policy if exists member_subscriptions_own on member_subscriptions;
create policy member_subscriptions_own on member_subscriptions for select to authenticated
  using (member_id in (select id from members where auth_user_id = auth.uid()));

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists member_subscriptions_touch on member_subscriptions;
create trigger member_subscriptions_touch before update on member_subscriptions for each row execute function touch_updated_at();

-- An active subscription keeps the member financial: when an invoice is paid, push financial_until out to the period end.
create or replace function subscription_paid(p_sub uuid, p_period_end timestamptz, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare s member_subscriptions%rowtype;
begin
  select * into s from member_subscriptions where id = p_sub;
  if s.id is null then return; end if;
  update member_subscriptions set status = 'active', current_period_end = p_period_end, last_invoice_at = now(), last_invoice_amount = p_amount,
    started_at = coalesce(started_at, now()) where id = p_sub;
  update members set status = 'active', financial_until = greatest(coalesce(financial_until, current_date), (p_period_end + interval '7 days')::date),
    category_id = coalesce(s.category_id, category_id) where id = s.member_id;
  perform recompute_member_tier(s.member_id);
end $$;

create or replace view v_subscriptions_summary as
select f.code as frequency, f.label, f.premium_pct, count(s.*) filter (where s.status = 'active') as active,
       count(s.*) filter (where s.status = 'past_due') as past_due,
       coalesce(sum(s.instalment * f.per_year) filter (where s.status = 'active'), 0) as annualised
from billing_frequencies f left join member_subscriptions s on s.frequency = f.code
group by f.code, f.label, f.premium_pct, f.sort order by f.sort;
alter view v_subscriptions_summary set (security_invoker = true);
grant select on v_subscriptions_summary to authenticated;
