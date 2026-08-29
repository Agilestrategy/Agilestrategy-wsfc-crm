-- 0002 · prepare for the first real data load
-- Couples and families share one email address in the club's records, so email is no longer unique on members.
drop index if exists members_email_unique;
create index if not exists members_email_idx on members (lower(email)) where email is not null;

-- Record how a Mailchimp contact was linked to a member (email / email_shared / name / initial_surname / manual)
alter table email_contacts add column if not exists match_method text;

-- Import batches for the 29 Aug 2026 load
insert into import_batches (id, source, filename, notes, created_by) values
  ('a0000000-0000-4000-8000-000000000001', 'members_list', 'Membership list.xlsx (25 May 2026 export, 5,793 rows)', 'Cleaned + matched offline (pipeline.py), loaded via CSV import', 'claude'),
  ('a0000000-0000-4000-8000-000000000002', 'mailchimp', 'audience_export_ba13ce8c4d (subscribed/unsubscribed/cleaned/nonsubscribed)', '3,898 unique emails; matched to members by email, shared email, unique name, initial+surname', 'claude')
on conflict (id) do nothing;

-- The legacy system reused member numbers 100 and 994 for two different people each, so the number cannot be unique yet.
alter table members drop constraint if exists members_member_number_key;
create index if not exists members_member_number_idx on members (member_number);
