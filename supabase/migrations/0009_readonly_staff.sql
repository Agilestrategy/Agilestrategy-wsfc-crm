-- 0009 · Enforce the readonly staff role. Readonly staff can see everything in the console but cannot insert, update or delete.
-- Every "for all ... using (is_staff())" policy is split into a select policy (is_staff) and write policies (staff_can_write).
-- Member facing policies and security definer functions (check in, app link, subscription_paid) are untouched.

create or replace function staff_can_write() returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff s
    where s.is_active and s.role <> 'readonly'
      and (s.user_id = auth.uid() or lower(s.email) = lower(coalesce(auth.jwt() ->> 'email','')))
  );
$$;
grant execute on function staff_can_write() to authenticated;

do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and cmd = 'ALL' and qual = 'is_staff()'
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    execute format('create policy %I on %I.%I for select to authenticated using (is_staff())', p.policyname, p.schemaname, p.tablename);
    execute format('create policy %I on %I.%I for insert to authenticated with check (staff_can_write())', p.policyname || '_ins', p.schemaname, p.tablename);
    execute format('create policy %I on %I.%I for update to authenticated using (staff_can_write()) with check (staff_can_write())', p.policyname || '_upd', p.schemaname, p.tablename);
    execute format('create policy %I on %I.%I for delete to authenticated using (staff_can_write())', p.policyname || '_del', p.schemaname, p.tablename);
  end loop;
end $$;

-- Console RPCs that write: swap the is_staff() guard for staff_can_write(), and add a guard where there was none.
do $$
declare f record; src text;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('shop_build_run','shop_send_run','shop_receive_run','recompute_tiers','match_email_contacts') loop
    src := pg_get_functiondef(f.oid);
    if position('if not is_staff() then raise exception' in src) > 0 then
      src := replace(src, 'if not is_staff() then raise exception ''staff only''; end if;', 'if not staff_can_write() then raise exception ''read only access''; end if;');
    else
      src := regexp_replace(src, '(\nbegin\n)', E'\\1  if not staff_can_write() then raise exception ''read only access''; end if;\n', 'i');
    end if;
    execute src;
  end loop;
end $$;
-- recompute_member_tier is called from the console on a single member and from the check in / subscription functions (which run as definer),
-- so it stays callable; a readonly user recomputing a tier changes nothing they could not trigger anyway.
