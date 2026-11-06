-- MY/CO/L database, sixteenth version (6 Nov 2026): STAFF LOGINS.
-- Run this AFTER 0015 (and after 0002, which made the owner-only lock). Paste the whole file into
-- Supabase > SQL Editor > New query, then press Run. Safe to run twice.
--
-- Until now only the owner could touch the database. This adds a second kind of login, STAFF:
--   * STAFF can read and add the farm work: lots, harvests, cooks, losses, stock moves, facility logs,
--     climate readings, culture bank and so on, and can change what they have saved.
--   * STAFF can NOT read or write the money: sales, prices, power bills, labour pay, standing orders,
--     cash, budget, waste cost, exchange rates, or the 'money' and 'rates' settings rows.
--   * STAFF can NOT read the edit history (it holds old prices); they can only add to it, so what
--     they change is still recorded under their name.
--   * STAFF can delete only log lines (harvests, losses, readings, checklists...), so UNDO works for
--     their own entries. They cannot delete strains, lots, cultures, rooms, items and the like.
--   * Nothing here lets STAFF touch allowed_users, staff_members or any other login.
--
-- To make a staff login:
--   1. Supabase > Authentication > Users > Add user (email + password, tick "auto confirm").
--   2. Run:
--        insert into public.staff_members (user_id)
--        select id from auth.users where email = 'worker@example.com';
--      To take it away again:
--        delete from public.staff_members where user_id = (select id from auth.users where email = 'worker@example.com');
--   The same person must not be in allowed_users: the owner list wins and would give them everything.
--
-- When a LATER migration adds a table and calls owner_only() on it, run  select public.staff_apply();
-- afterwards (it is safe to run any time) if staff should reach that table. owner_only() removes every
-- other policy on the table, staff ones included.

create table if not exists public.staff_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Nobody reaches this table through the public API: no policies, and no grants (same as allowed_users).
alter table public.staff_members enable row level security;
revoke all on public.staff_members from anon, authenticated;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_members where user_id = auth.uid())
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

-- Give STAFF read / add / change (and, when can_delete, delete) on one table. The owner policies stay.
create or replace function public.staff_work(tbl regclass, can_delete boolean)
returns void
language plpgsql
as $$
declare
  sch text;
  rel text;
begin
  select n.nspname, c.relname into sch, rel
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = tbl;
  execute format('alter table %I.%I enable row level security', sch, rel);
  execute format('drop policy if exists "staff can read" on %I.%I', sch, rel);
  execute format('drop policy if exists "staff can add" on %I.%I', sch, rel);
  execute format('drop policy if exists "staff can change" on %I.%I', sch, rel);
  execute format('drop policy if exists "staff can delete" on %I.%I', sch, rel);
  execute format('create policy "staff can read" on %I.%I for select to authenticated using (public.is_staff())', sch, rel);
  execute format('create policy "staff can add" on %I.%I for insert to authenticated with check (public.is_staff())', sch, rel);
  execute format('create policy "staff can change" on %I.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', sch, rel);
  if can_delete then
    execute format('create policy "staff can delete" on %I.%I for delete to authenticated using (public.is_staff())', sch, rel);
  end if;
end $$;

revoke all on function public.staff_work(regclass, boolean) from public;

-- Apply the staff rules to every work table that exists. Money tables get NO staff policy at all, so
-- with row level security on and no policy, staff read nothing and write nothing there.
create or replace function public.staff_apply()
returns void
language plpgsql
as $$
declare
  t text;
begin
  -- Records staff may add and change, not delete.
  foreach t in array array[
    'species', 'strains', 'rooms', 'circuits', 'equipment', 'contaminants', 'reference_entries',
    'items', 'maint_items', 'sensors', 'cultures', 'grain_runs', 'block_lots', 'cook_runs'
  ] loop
    if to_regclass('public.' || t) is not null then perform public.staff_work(('public.' || t)::regclass, false); end if;
  end loop;

  -- Log lines staff may also delete (so UNDO of their own entry works).
  foreach t in array array[
    'harvests', 'lot_losses', 'stock_moves', 'cook_readings', 'hazard_logs', 'flush_log', 'power_cuts',
    'water_tests', 'maint_log', 'clean_log', 'checklist_runs', 'reminders', 'photos', 'ac_log',
    'sensor_readings', 'bank_tests', 'viability_checks', 'strain_trials'
  ] loop
    if to_regclass('public.' || t) is not null then perform public.staff_work(('public.' || t)::regclass, true); end if;
  end loop;

  -- Settings: practice, facility and sensor rows yes; the 'money' and 'rates' rows never.
  if to_regclass('public.app_settings') is not null then
    drop policy if exists "staff can read" on public.app_settings;
    drop policy if exists "staff can add" on public.app_settings;
    drop policy if exists "staff can change" on public.app_settings;
    create policy "staff can read" on public.app_settings for select to authenticated
      using (public.is_staff() and id not in ('money', 'rates'));
    create policy "staff can add" on public.app_settings for insert to authenticated
      with check (public.is_staff() and id not in ('money', 'rates'));
    create policy "staff can change" on public.app_settings for update to authenticated
      using (public.is_staff() and id not in ('money', 'rates'))
      with check (public.is_staff() and id not in ('money', 'rates'));
  end if;

  -- History: add only. No read (old prices live in it), no change, no delete.
  if to_regclass('public.edit_log') is not null then
    drop policy if exists "staff can add" on public.edit_log;
    create policy "staff can add" on public.edit_log for insert to authenticated with check (public.is_staff());
  end if;
end $$;

revoke all on function public.staff_apply() from public;

select public.staff_apply();
