-- MY/CO/L database, second version (build 4, 5 Nov 2026): CARGO and an owner-only lock.
-- Run this AFTER 0001, and after you have made your own login (Authentication > Users).
-- Paste the whole file into Supabase > SQL Editor > New query, then press Run.
--
-- Two things happen here.
--
-- 1. CARGO. The stock count is no longer typed into the item. It is always the
--    sum of that item's stock_moves (+ deliveries, - uses, +/- counts), so the
--    count and the history can never disagree. Items gain a short code, a
--    category, a room and an optional manual weekly-use figure.
--
-- 2. Owner-only security. 0001 let ANY signed-in user read and write. That is
--    fine while sign-up is switched off, but the site is public, so this makes
--    it explicit: only users listed in public.allowed_users can touch any table.
--    Everyone who exists when you run this file is added to that list, so make
--    your login first. To add someone later:
--        insert into public.allowed_users (user_id)
--        select id from auth.users where email = 'someone@example.com';
--    To lock a table you add in a later migration, finish that migration with:
--        select public.owner_only('public.your_new_table');

-- ---------- CARGO ----------

alter table public.items drop column on_hand;

alter table public.items
  add column code text unique,        -- stable key the app uses, e.g. SAWDUST
  add column category text,           -- SUBSTRATE, GRAIN AND SPAWN, ...
  add column room text,               -- DECK PLAN room id: lab, packing, boiling, incubation, fruiting
  add column use_per_week numeric check (use_per_week is null or use_per_week >= 0); -- manual override

alter table public.items
  add constraint items_reorder_nonneg check (reorder_point is null or reorder_point >= 0),
  add constraint items_lead_nonneg check (lead_time_days is null or lead_time_days >= 0);

alter table public.stock_moves
  add column run_ref text,            -- set when SEQUENCE books a whole run, e.g. RUN-20261105-1
  add constraint stock_moves_qty_nonzero check (qty <> 0 or reason = 'count'); -- a count of zero is still a count

create index on public.stock_moves (run_ref) where run_ref is not null;

-- ---------- owner-only security ----------

create table public.allowed_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Nobody reaches this table through the public API: no policies, and no grants.
alter table public.allowed_users enable row level security;
revoke all on public.allowed_users from anon, authenticated;

-- Everyone who has a login right now (that should be only you).
insert into public.allowed_users (user_id) select id from auth.users on conflict do nothing;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.allowed_users where user_id = auth.uid())
$$;

revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated;

-- Replace every policy on a table with owner-only read and write.
create or replace function public.owner_only(tbl regclass)
returns void
language plpgsql
as $$
declare
  p record;
  sch text;
  rel text;
begin
  select n.nspname, c.relname into sch, rel
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = tbl;
  execute format('alter table %I.%I enable row level security', sch, rel);
  for p in select policyname from pg_policies where schemaname = sch and tablename = rel
  loop
    execute format('drop policy %I on %I.%I', p.policyname, sch, rel);
  end loop;
  execute format('create policy "owner can read" on %I.%I for select to authenticated using (public.is_owner())', sch, rel);
  execute format('create policy "owner can write" on %I.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', sch, rel);
end $$;

revoke all on function public.owner_only(regclass) from public;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'allowed_users'
  loop
    perform public.owner_only(format('public.%I', t)::regclass);
  end loop;
end $$;
