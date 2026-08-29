-- 0003 · WSFC Status programme (Silver / Gold / Black), member app check-ins, push notifications
-- Run in the Supabase SQL editor.

do $$ begin
  create type status_tier as enum ('silver','gold','black');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Members: tier columns
-- ---------------------------------------------------------------------------
alter table members
  add column if not exists status_tier status_tier,                 -- effective tier (null = not financial)
  add column if not exists tier_computed status_tier,               -- what the engagement rules say
  add column if not exists tier_override status_tier,               -- admin hand-pick (e.g. launch Black list, 777 rejoiners)
  add column if not exists tier_override_reason text,
  add column if not exists tier_override_until date,
  add column if not exists gold_promo_until date,                   -- "one bar transaction before the anniversary = Gold" promo
  add column if not exists tier_grace_until date,                   -- one grace month before dropping from Black
  add column if not exists tier_updated_at timestamptz,
  add column if not exists push_opt_in boolean not null default false,
  add column if not exists details_confirmed_at timestamptz;        -- member confirmed their own details in the app

-- ---------------------------------------------------------------------------
-- Programme settings (single row)
-- ---------------------------------------------------------------------------
create table if not exists programme_settings (
  id int primary key default 1 check (id = 1),
  anniversary_date date not null default '2026-10-31',
  gold_promo_ends date not null default '2026-10-31',   -- a bar check-in before this date earns Gold
  gold_promo_until date not null default '2027-10-31',  -- ...held until this date
  black_per_month numeric not null default 4,
  gold_per_month numeric not null default 2,
  gold_points_per_quarter int not null default 100,
  checkin_max_per_day int not null default 1,
  updated_at timestamptz not null default now()
);
insert into programme_settings (id) values (1) on conflict (id) do nothing;
alter table programme_settings enable row level security;
drop policy if exists settings_read on programme_settings;
create policy settings_read on programme_settings for select to authenticated using (true);
drop policy if exists settings_admin on programme_settings;
create policy settings_admin on programme_settings for all to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- Check-in points: QR posters at the bar / door / events
-- ---------------------------------------------------------------------------
create table if not exists checkin_points (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- short code baked into the QR, e.g. BAR1
  name text not null,                   -- "Main bar", "Front door", "Fishing comp weigh-in"
  engagement engagement_type not null default 'swipe_bar',
  points int not null default 10,
  is_active boolean not null default true,
  valid_from date, valid_to date,       -- optional, for event codes
  created_at timestamptz not null default now()
);
alter table checkin_points enable row level security;
drop policy if exists checkin_points_staff on checkin_points;
create policy checkin_points_staff on checkin_points for all to authenticated using (is_staff()) with check (is_staff());

insert into checkin_points (code, name, engagement, points) values
  ('BAR', 'Main bar', 'swipe_bar', 10),
  ('DOOR', 'Front door', 'swipe_door', 10)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Push notifications
-- ---------------------------------------------------------------------------
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_member_idx on push_subscriptions (member_id);
alter table push_subscriptions enable row level security;
drop policy if exists push_own on push_subscriptions;
create policy push_own on push_subscriptions for all to authenticated
  using (member_id in (select id from members where auth_user_id = auth.uid()))
  with check (member_id in (select id from members where auth_user_id = auth.uid()));
drop policy if exists push_staff_read on push_subscriptions;
create policy push_staff_read on push_subscriptions for select to authenticated using (is_staff());

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  url text,                                  -- where a tap takes the member (default /me)
  audience jsonb not null default '{}'::jsonb, -- {"tier":"black"} | {"member_ids":[...]} | {} = everyone opted in
  status text not null default 'queued',     -- queued | sending | sent | failed
  sent_count int not null default 0,
  failed_count int not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table notifications enable row level security;
drop policy if exists notifications_staff on notifications;
create policy notifications_staff on notifications for all to authenticated using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- Members: what a signed-in member may do to their own row
-- ---------------------------------------------------------------------------
drop policy if exists member_update_self on members;
create policy member_update_self on members for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- Column-level guard: members may only change contact fields, not status/tier/number.
create or replace function guard_member_self_update() returns trigger language plpgsql as $$
begin
  if is_staff() then return new; end if;
  if new.auth_user_id = auth.uid() then
    -- reset anything a member is not allowed to touch
    new.member_number := old.member_number; new.status := old.status; new.category_id := old.category_id;
    new.financial_until := old.financial_until; new.joined_on := old.joined_on; new.lapsed_on := old.lapsed_on;
    new.status_tier := old.status_tier; new.tier_computed := old.tier_computed; new.tier_override := old.tier_override;
    new.tier_override_reason := old.tier_override_reason; new.tier_override_until := old.tier_override_until;
    new.gold_promo_until := old.gold_promo_until; new.tier_grace_until := old.tier_grace_until;
    new.household_id := old.household_id; new.legacy_ids := old.legacy_ids; new.source := old.source;
    new.email_status := old.email_status; new.notes := old.notes; new.auth_user_id := old.auth_user_id;
  end if;
  return new;
end $$;
drop trigger if exists members_guard_self on members;
create trigger members_guard_self before update on members for each row execute function guard_member_self_update();

-- members may read engagements about themselves
drop policy if exists engagements_own on engagements;
create policy engagements_own on engagements for select to authenticated
  using (member_id in (select id from members where auth_user_id = auth.uid()));
drop policy if exists categories_member_read on membership_categories;
create policy categories_member_read on membership_categories for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Member check-in via QR (security definer; enforces 1 per code per day)
-- ---------------------------------------------------------------------------
create or replace function member_checkin(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m members%rowtype; cp checkin_points%rowtype; s programme_settings%rowtype; already int; pts int; promo boolean := false;
begin
  select * into m from members where auth_user_id = auth.uid() limit 1;
  if m.id is null then return jsonb_build_object('ok', false, 'error', 'No member record is linked to this sign-in.'); end if;
  if m.status <> 'active' then return jsonb_build_object('ok', false, 'error', 'Your membership is not current. See the office to renew.'); end if;
  select * into cp from checkin_points where upper(code) = upper(p_code) and is_active
    and (valid_from is null or valid_from <= current_date) and (valid_to is null or valid_to >= current_date);
  if cp.id is null then return jsonb_build_object('ok', false, 'error', 'That code is not active.'); end if;
  select * into s from programme_settings where id = 1;
  select count(*) into already from engagements
    where member_id = m.id and reference = cp.code and occurred_at::date = current_date;
  if already >= s.checkin_max_per_day then
    return jsonb_build_object('ok', true, 'points', 0, 'message', 'Already checked in here today. See you tomorrow!');
  end if;
  pts := case when cp.engagement = 'swipe_gaming' then 0 else cp.points end;
  insert into engagements (member_id, type, occurred_at, points, source, reference)
    values (m.id, cp.engagement, now(), pts, 'app_checkin', cp.code);
  -- launch promo: a bar check-in before the anniversary = Gold for the year
  if cp.engagement = 'swipe_bar' and current_date <= s.gold_promo_ends and m.gold_promo_until is null then
    update members set gold_promo_until = s.gold_promo_until where id = m.id; promo := true;
  end if;
  perform recompute_member_tier(m.id);
  return jsonb_build_object('ok', true, 'points', pts, 'promo', promo, 'message',
    case when promo then 'Checked in. That is your first bar visit before the 60th: you are now a Gold member for the year.' else 'Checked in. +' || pts || ' points.' end);
end $$;

-- ---------------------------------------------------------------------------
-- Tier rules
-- ---------------------------------------------------------------------------
create or replace function recompute_member_tier(p_member uuid) returns status_tier
language plpgsql security definer set search_path = public as $$
declare m members%rowtype; s programme_settings%rowtype; n90 int; pts90 int; per_month numeric; computed status_tier; effective status_tier; ovr status_tier;
begin
  select * into m from members where id = p_member; if m.id is null then return null; end if;
  select * into s from programme_settings where id = 1;
  if m.status <> 'active' then
    update members set status_tier = null, tier_computed = null, tier_updated_at = now() where id = p_member; return null;
  end if;
  select count(*), coalesce(sum(points),0) into n90, pts90 from engagements
    where member_id = p_member and points > 0 and occurred_at > now() - interval '90 days';
  per_month := n90 / 3.0;
  if per_month >= s.black_per_month then computed := 'black';
  elsif per_month >= s.gold_per_month or pts90 >= s.gold_points_per_quarter
        or (m.gold_promo_until is not null and m.gold_promo_until >= current_date) then computed := 'gold';
  else computed := 'silver'; end if;
  -- grace month before dropping out of Black
  if m.status_tier = 'black' and computed <> 'black' and m.tier_override is null then
    if m.tier_grace_until is null then
      update members set tier_grace_until = current_date + interval '1 month' where id = p_member; computed := 'black';
    elsif m.tier_grace_until >= current_date then computed := 'black'; end if;
  elsif computed = 'black' then
    update members set tier_grace_until = null where id = p_member;
  end if;
  ovr := case when m.tier_override is not null and (m.tier_override_until is null or m.tier_override_until >= current_date) then m.tier_override end;
  effective := case
    when ovr = 'black' or computed = 'black' then 'black'
    when ovr = 'gold' or computed = 'gold' then 'gold'
    else 'silver' end;
  update members set tier_computed = computed, status_tier = effective, tier_updated_at = now() where id = p_member;
  -- tier changed: queue a push to that member (the app also recolours itself to the new tier)
  if m.status_tier is distinct from effective and m.status_tier is not null then
    insert into notifications (title, body, url, audience, created_by) values (
      case effective when 'black' then 'Welcome to Black' when 'gold' then 'You are now a Gold member' else 'Your status has changed' end,
      case effective
        when 'black' then 'You are one of the club''s most active members. Black benefits are yours for the season.'
        when 'gold' then 'Thanks for being part of the club. Gold benefits unlocked.'
        else 'Your membership status is now Silver. Check in at the bar or the door to climb back up.' end,
      '/me', jsonb_build_object('member_ids', jsonb_build_array(p_member), 'reason', 'tier_change'), 'system');
  end if;
  return effective;
end $$;

create or replace function recompute_tiers() returns table(tier status_tier, members bigint)
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from members loop perform recompute_member_tier(r.id); end loop;
  return query select status_tier, count(*) from members where status = 'active' group by status_tier order by status_tier;
end $$;

-- first pass: everyone financial starts Silver
select * from recompute_tiers();

-- ---------------------------------------------------------------------------
-- Views for the app and the dashboard
-- ---------------------------------------------------------------------------
create or replace view v_tier_summary as
select status_tier, count(*) as members,
       count(*) filter (where push_opt_in) as push_opted_in,
       count(*) filter (where tier_override is not null) as hand_picked
from members where status = 'active' group by status_tier;
alter view v_tier_summary set (security_invoker = true);
grant select on v_tier_summary to authenticated;

drop view if exists v_member_list;
create view v_member_list as
select m.id, m.member_number, m.first_name, m.last_name, m.full_name, m.email, m.email_status,
       m.mobile, m.phone, m.status, m.status_tier, m.tier_override, m.financial_until, m.joined_on, m.city, m.suburb,
       c.code as category_code, c.name as category_name,
       m.household_id, m.do_not_contact, m.source, m.updated_at, m.push_opt_in,
       (select max(e.occurred_at) from engagements e where e.member_id = m.id) as last_engaged_at,
       (select count(*) from engagements e where e.member_id = m.id and e.occurred_at > now() - interval '90 days') as engagements_90d
from members m
left join membership_categories c on c.id = m.category_id;
alter view v_member_list set (security_invoker = true);
grant select on v_member_list to authenticated;
