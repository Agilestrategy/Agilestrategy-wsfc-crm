-- WSFC Club Operations CRM · schema v1
-- Run in the Supabase SQL editor (or `supabase db push`). Idempotent where practical.

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type membership_status as enum ('active','lapsed','expired','pending','cancelled','unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type email_status as enum ('subscribed','unsubscribed','cleaned','nonsubscribed','unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type staff_role as enum ('admin','committee','staff','readonly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type engagement_type as enum ('swipe_bar','swipe_door','swipe_gaming','event','volunteer','referral','renewal_on_time','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type interaction_kind as enum ('note','call','email','sms','visit','task');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------------------
-- Staff (who can use the admin console). Linked to auth.users by email.
-- ---------------------------------------------------------------------------
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email text not null unique,
  full_name text,
  role staff_role not null default 'staff',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists staff_updated on staff;
create trigger staff_updated before update on staff for each row execute function set_updated_at();

-- Current caller is active staff?
create or replace function is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff s
    where s.is_active
      and (s.user_id = auth.uid() or lower(s.email) = lower(coalesce(auth.jwt() ->> 'email','')))
  );
$$;

create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff s
    where s.is_active and s.role = 'admin'
      and (s.user_id = auth.uid() or lower(s.email) = lower(coalesce(auth.jwt() ->> 'email','')))
  );
$$;

-- On first magic-link sign in, attach the auth user to the staff row with the same email.
create or replace function handle_new_auth_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update staff set user_id = new.id where lower(email) = lower(new.email) and user_id is null;
  update members set auth_user_id = new.id where lower(email) = lower(new.email) and auth_user_id is null;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table if not exists membership_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  annual_fee numeric(10,2),
  is_family boolean not null default false,
  is_corporate boolean not null default false,
  sort_order int not null default 100,
  is_active boolean not null default true
);

insert into membership_categories (code,name,annual_fee,is_family,is_corporate,sort_order) values
  ('social','Social',null,false,false,10),
  ('fishing','Fishing',null,false,false,20),
  ('family','Family',null,true,false,30),
  ('senior_family','Senior Family',null,true,false,40),
  ('junior_family','Junior Family',null,true,false,50),
  ('junior','Junior',null,false,false,60),
  ('senior','Senior',null,false,false,70),
  ('corporate','Corporate',null,false,true,80),
  ('life','Life',0,false,false,90),
  ('day','Day member',null,false,false,95),
  ('other','Other / unmapped',null,false,false,999)
on conflict (code) do nothing;

create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null,              -- 'mailchimp', 'members_list', 'csv', 'manual'
  filename text,
  row_count int not null default 0,
  inserted int not null default 0,
  updated int not null default 0,
  skipped int not null default 0,
  mapping jsonb,
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Households (family memberships share one)
-- ---------------------------------------------------------------------------
create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text,
  address_line1 text,
  address_line2 text,
  suburb text,
  city text,
  postcode text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists households_updated on households;
create trigger households_updated before update on households for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Members: the core record
-- ---------------------------------------------------------------------------
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  member_number text unique,                 -- club's own number, if any
  auth_user_id uuid references auth.users(id) on delete set null,
  first_name text,
  last_name text,
  preferred_name text,
  email text,
  email_status email_status not null default 'unknown',
  phone text,
  mobile text,
  date_of_birth date,
  gender text,
  address_line1 text,
  address_line2 text,
  suburb text,
  city text,
  postcode text,
  household_id uuid references households(id) on delete set null,
  is_household_primary boolean not null default false,
  category_id uuid references membership_categories(id),
  status membership_status not null default 'unknown',
  joined_on date,
  financial_until date,                      -- paid-up to
  lapsed_on date,
  boat_name text,
  occupation text,
  employer text,
  source text,                               -- where this record came from
  legacy_ids jsonb not null default '{}'::jsonb,  -- e.g. {"mailchimp_euid":"..","legacy_member_no":".."}
  raw jsonb,                                 -- last imported raw row, for forensics
  import_batch_id uuid references import_batches(id) on delete set null,
  do_not_contact boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text generated always as (btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))) stored
);
drop trigger if exists members_updated on members;
create trigger members_updated before update on members for each row execute function set_updated_at();

create unique index if not exists members_email_unique on members (lower(email)) where email is not null and email <> '';
create index if not exists members_last_name_idx on members (lower(last_name));
create index if not exists members_status_idx on members (status);
create index if not exists members_category_idx on members (category_id);
create index if not exists members_household_idx on members (household_id);
create index if not exists members_fullname_trgm on members using gin (full_name gin_trgm_ops);
create index if not exists members_email_trgm on members using gin (email gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Subscriptions: one row per member per season (renewal history)
-- ---------------------------------------------------------------------------
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  season text not null,                      -- e.g. '2025-26'
  category_id uuid references membership_categories(id),
  amount numeric(10,2),
  paid_on date,
  starts_on date,
  expires_on date,
  status text not null default 'paid',       -- paid | due | overdue | waived
  payment_ref text,
  created_at timestamptz not null default now(),
  unique (member_id, season)
);
create index if not exists subscriptions_member_idx on subscriptions (member_id);

-- ---------------------------------------------------------------------------
-- Cards: membership cards (swipe at bar / door / gaming)
-- ---------------------------------------------------------------------------
create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  card_number text not null unique,
  issued_on date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists cards_member_idx on cards (member_id);

-- ---------------------------------------------------------------------------
-- Engagements: every card swipe / event / volunteer shift. Feeds status tiers.
-- Bright line: gaming-floor activity is recorded but earns NO points.
-- ---------------------------------------------------------------------------
create table if not exists engagements (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  type engagement_type not null,
  occurred_at timestamptz not null default now(),
  points int not null default 0,
  source text,                               -- 'pos', 'door', 'manual', 'import'
  reference text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists engagements_member_time_idx on engagements (member_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------
create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  colour text
);
create table if not exists member_tags (
  member_id uuid not null references members(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- Interactions: notes, calls, emails, tasks against a member
-- ---------------------------------------------------------------------------
create table if not exists interactions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  kind interaction_kind not null default 'note',
  subject text,
  body text,
  due_on date,
  done boolean not null default false,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists interactions_member_idx on interactions (member_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Email list contacts: the Mailchimp audience as imported (raw truth).
-- Matched to members when a name/email lines up; unmatched rows stay here.
-- ---------------------------------------------------------------------------
create table if not exists email_contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  first_name text,
  last_name text,
  status email_status not null default 'unknown',
  tags text[] not null default '{}',
  phone text,
  birthday text,
  optin_at timestamptz,
  status_changed_at timestamptz,             -- unsub / clean / last changed time
  reason text,                               -- unsub reason or clean campaign
  source text,                               -- mailchimp SOURCE column
  mailchimp_leid text,
  mailchimp_euid text,
  member_id uuid references members(id) on delete set null,
  import_batch_id uuid references import_batches(id) on delete set null,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists email_contacts_updated on email_contacts;
create trigger email_contacts_updated before update on email_contacts for each row execute function set_updated_at();
create index if not exists email_contacts_status_idx on email_contacts (status);
create index if not exists email_contacts_name_idx on email_contacts (lower(last_name), lower(first_name));

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
drop view if exists v_member_list;
create view v_member_list as
select m.id, m.member_number, m.first_name, m.last_name, m.full_name, m.email, m.email_status,
       m.mobile, m.phone, m.status, m.financial_until, m.joined_on, m.city, m.suburb,
       c.code as category_code, c.name as category_name,
       m.household_id, m.do_not_contact, m.source, m.updated_at,
       (select max(e.occurred_at) from engagements e where e.member_id = m.id) as last_engaged_at,
       (select count(*) from engagements e where e.member_id = m.id and e.occurred_at > now() - interval '90 days') as engagements_90d
from members m
left join membership_categories c on c.id = m.category_id;

create or replace view v_dashboard as
select
  (select count(*) from members) as members_total,
  (select count(*) from members where status = 'active') as members_active,
  (select count(*) from members where status = 'lapsed') as members_lapsed,
  (select count(*) from members where status = 'unknown') as members_unknown,
  (select count(*) from members where email is not null and email <> '') as members_with_email,
  (select count(*) from members where email_status = 'subscribed') as members_subscribed,
  (select count(*) from members where coalesce(mobile,phone) is not null) as members_with_phone,
  (select count(*) from email_contacts) as contacts_total,
  (select count(*) from email_contacts where status = 'subscribed') as contacts_subscribed,
  (select count(*) from email_contacts where status = 'unsubscribed') as contacts_unsubscribed,
  (select count(*) from email_contacts where status = 'cleaned') as contacts_cleaned,
  (select count(*) from email_contacts where member_id is not null) as contacts_matched;

alter view v_member_list set (security_invoker = true);
alter view v_dashboard set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- Match email contacts to members by email, then by exact name (case-insensitive)
-- ---------------------------------------------------------------------------
create or replace function match_email_contacts() returns table(matched_by_email int, matched_by_name int)
language plpgsql security definer set search_path = public as $$
declare a int; b int;
begin
  update email_contacts ec set member_id = m.id
  from members m
  where ec.member_id is null and m.email is not null and lower(m.email) = lower(ec.email);
  get diagnostics a = row_count;

  update email_contacts ec set member_id = m.id
  from members m
  where ec.member_id is null
    and ec.first_name is not null and ec.last_name is not null
    and lower(m.first_name) = lower(ec.first_name) and lower(m.last_name) = lower(ec.last_name)
    and (select count(*) from members m2 where lower(m2.first_name) = lower(ec.first_name) and lower(m2.last_name) = lower(ec.last_name)) = 1;
  get diagnostics b = row_count;

  -- fill member email where blank, from the matched subscribed contact
  update members m set email = ec.email, email_status = ec.status
  from email_contacts ec
  where ec.member_id = m.id and (m.email is null or m.email = '') and ec.status = 'subscribed';

  return query select a, b;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table staff enable row level security;
alter table membership_categories enable row level security;
alter table import_batches enable row level security;
alter table households enable row level security;
alter table members enable row level security;
alter table subscriptions enable row level security;
alter table cards enable row level security;
alter table engagements enable row level security;
alter table tags enable row level security;
alter table member_tags enable row level security;
alter table interactions enable row level security;
alter table email_contacts enable row level security;

-- staff: full access to everything; admins manage staff
do $$
declare t text;
begin
  foreach t in array array['membership_categories','import_batches','households','members','subscriptions','cards','engagements','tags','member_tags','interactions','email_contacts'] loop
    execute format('drop policy if exists staff_all on %I', t);
    execute format('create policy staff_all on %I for all to authenticated using (is_staff()) with check (is_staff())', t);
  end loop;
end $$;

drop policy if exists staff_read_self on staff;
create policy staff_read_self on staff for select to authenticated using (is_staff());
drop policy if exists staff_admin_write on staff;
create policy staff_admin_write on staff for all to authenticated using (is_admin()) with check (is_admin());

-- members: a signed-in member can read their own record (member portal, later)
drop policy if exists member_read_self on members;
create policy member_read_self on members for select to authenticated
  using (auth_user_id = auth.uid() or lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));

grant usage on schema public to anon, authenticated;
grant select on v_member_list, v_dashboard to authenticated;
