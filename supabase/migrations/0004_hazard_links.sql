-- MY/CO/L database, fourth version (build 8, 5 Nov 2026): HAZARD INDEX.
-- Run this AFTER 0003. Paste the whole file into Supabase > SQL Editor > New query, then press Run.
--
-- The contaminant library itself lives in the app (src/data/hazards), not in the
-- database, so each entry has a short text id such as 'neurospora'. This file
-- only adds the places where you LOG a loss against one of those ids:
-- 1. lot_losses gets hazard_key (block losses pick from the library).
-- 2. hazard_logs is new: contamination logged on a culture or a grain run.
--    source_id is text because the app's own ids may come from either mode.

alter table public.lot_losses add column if not exists hazard_key text;
create index if not exists lot_losses_hazard_idx on public.lot_losses (hazard_key);

create table if not exists public.hazard_logs (
  id uuid primary key default gen_random_uuid(),
  hazard_key text, -- library id, or null when you do not know what it was
  source_kind text not null check (source_kind in ('culture', 'grain', 'lot')),
  source_id text,
  strain_id text,
  bag_count integer not null default 1 check (bag_count >= 0),
  noted_on date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists hazard_logs_hazard_idx on public.hazard_logs (hazard_key);

select public.owner_only('public.hazard_logs');
