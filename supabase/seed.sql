-- First staff logins. Magic-link sign in with one of these emails unlocks the console.
insert into staff (email, full_name, role) values
  ('paul.newton@agilestrategy.co.nz', 'Paul Newton', 'admin')
on conflict (email) do update set role = excluded.role, is_active = true;

-- Add Jacqui, Heyden and Rochelle when ready, e.g.
-- insert into staff (email, full_name, role) values ('president@wsfc.co.nz','Heyden','committee');

insert into tags (name, colour) values
  ('Mailchimp: Member','#2A6168'),
  ('Mailchimp: Customer','#1B2F3E'),
  ('23-24 season','#E8863A'),
  ('777 win-back','#B3261E'),
  ('Committee','#9A7A0C'),
  ('Volunteer','#1E7B34')
on conflict (name) do nothing;
