-- 0008 · Membership fees from the club's join form and boat details (Paul, 30 Sep 2026)
update membership_categories set annual_fee = 98 where name = 'Senior';
update membership_categories set annual_fee = 31 where name = 'Junior';
update membership_categories set annual_fee = 186 where name = 'Family';
update membership_categories set annual_fee = 57 where name = 'Social';
insert into membership_categories (code, name, annual_fee, is_family, sort_order, is_active)
select 'STU', 'Student', 67, false, 15, true where not exists (select 1 from membership_categories where name = 'Student');

alter table members
  add column if not exists boat_call_sign text,
  add column if not exists boat_length text,
  add column if not exists boat_make text;
