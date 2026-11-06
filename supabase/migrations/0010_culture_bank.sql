-- MY/CO/L database, tenth version (6 Nov 2026): CULTURE BANK (build G3).
-- Run this AFTER 0009. Paste the whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run twice. Local mode needs nothing.
--
-- No cryo freezer on this farm: the bank is agar slants and sterile-water tubes only (textbook t08 "Our farm").
-- 1. cultures.bank_batch groups the tubes cut from one plate; cultures.offsite marks the off-site copy.
-- 2. bank_tests: the test-and-expand line from one tube (dish T tested, dish E held until T passes).
-- 3. viability_checks: the viability log, one line per tube check.
-- Practice defaults (contamination target, spare blocks, small-line route, 75X capacity, bank sizes and due
-- dates) live in app_settings row 'practice' (table from 0007).

alter table public.cultures add column if not exists bank_batch uuid;
alter table public.cultures add column if not exists offsite boolean not null default false;
create index if not exists cultures_bank_batch on public.cultures (bank_batch);

create table if not exists public.bank_tests (
  id uuid primary key,
  strain_id uuid not null references public.strains (id) on delete cascade,
  source_culture_id uuid not null references public.cultures (id) on delete cascade,
  t_plate_id uuid references public.cultures (id) on delete set null,
  e_plate_id uuid references public.cultures (id) on delete set null,
  reason text not null default 'intake' check (reason in ('intake', 'refresh', 'old_tube', 'watch', 'other')),
  started_on date not null,
  result text not null default 'pending' check (result in ('pending', 'pass', 'fail')),
  decided_on date,
  days_to_colonize numeric,
  days_to_pin numeric,
  kg_per_block numeric,
  form text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.viability_checks (
  id uuid primary key,
  culture_id uuid not null references public.cultures (id) on delete cascade,
  strain_id uuid not null references public.strains (id) on delete cascade,
  checked_on date not null,
  days_to_cover numeric,
  appearance text,
  contamination text,
  result text not null check (result in ('pass', 'watch', 'fail')),
  notes text,
  initials text,
  created_at timestamptz not null default now()
);

create index if not exists viability_checks_culture on public.viability_checks (culture_id, checked_on);

select public.owner_only('public.bank_tests');
select public.owner_only('public.viability_checks');
