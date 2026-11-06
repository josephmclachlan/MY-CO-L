-- MY/CO/L database, eleventh version (6 Nov 2026): PRODUCTION RECORDS (build G4).
-- Run this AFTER 0010. Paste the whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run twice. Local mode needs nothing.
--
-- 1. block_lots gets: cart (which cart the blocks sit on), room, knocked_by (initials), parent_lot_id (set when a
--    lot is split), trial_id (strain trial), dry_kg_per_block (overrides the 4 lb dry recipe used for BE%).
-- 2. strain_trials: side-by-side strain trials; lots join one with block_lots.trial_id.
-- 3. flush_log: the day pins showed for each flush of a lot (days to pin). Picks stay in harvests.
-- 4. photos: pictures of cultures, grain, lots (resized in the app, kept as text so they back up with everything).

alter table public.block_lots add column if not exists cart text;
alter table public.block_lots add column if not exists room text;
alter table public.block_lots add column if not exists knocked_by text;
alter table public.block_lots add column if not exists parent_lot_id uuid references public.block_lots (id) on delete set null;
alter table public.block_lots add column if not exists trial_id uuid;
alter table public.block_lots add column if not exists dry_kg_per_block numeric;
create index if not exists block_lots_cart on public.block_lots (cart);

create table if not exists public.strain_trials (
  id uuid primary key,
  name text not null,
  species_key text not null,
  status text not null default 'running' check (status in ('running', 'done')),
  started_on date not null,
  ended_on date,
  question text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flush_log (
  id uuid primary key,
  block_lot_id uuid not null references public.block_lots (id) on delete cascade,
  flush smallint not null check (flush between 1 and 9),
  pinned_on date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists flush_log_lot on public.flush_log (block_lot_id, flush);

create table if not exists public.photos (
  id uuid primary key,
  table_name text not null,
  row_id text not null,
  taken_at timestamptz not null,
  caption text,
  mime text not null default 'image/jpeg',
  w integer,
  h integer,
  bytes integer,
  data_url text not null,
  created_at timestamptz not null default now()
);
create index if not exists photos_row on public.photos (table_name, row_id);

select public.owner_only('public.strain_trials');
select public.owner_only('public.flush_log');
select public.owner_only('public.photos');
