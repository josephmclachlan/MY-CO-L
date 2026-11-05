-- MY/CO/L database, third version (build 6, 5 Nov 2026): XENOGENETICS.
-- Run this AFTER 0002. Paste the whole file into Supabase > SQL Editor > New query, then press Run.
--
-- What changes:
-- 1. Strains and block lots name their species by the app's species key
--    (lions-mane, blue-oyster ...), the same key the SPECIMEN FILES use.
--    The old species uuid column stays but is no longer required.
-- 2. Cultures: P0 is the master (the stored original). Water tubes and
--    cryovials are kinds of their own. cold_since records when something went
--    into the fridge, so the app can warn about cold-storage age.
-- 3. Grain runs get a status, cold_since, a location, a printed label, bags
--    lost to contamination, and how many masters a G2 run used.
-- 4. Block lots record how many G2 bags they used. One lot code can now come
--    from more than one G2 run, so the lot code is no longer unique per day.
-- No new tables, so the owner-only lock from 0002 still covers everything.

-- ---------- strains ----------

alter table public.strains
  add column species_key text,
  alter column species_id drop not null;

-- Fill the key for any rows made before this (the five species 0001 seeded).
update public.strains s set species_key = case sp.letter when 'B' then 'blue-oyster' when 'L' then 'lions-mane' when 'C' then 'comb-tooth'
    when 'G' then 'golden-oyster' when 'P' then 'phoenix-oyster' end
  from public.species sp where sp.id = s.species_id and s.species_key is null;

-- ---------- cultures ----------

alter table public.cultures drop constraint if exists cultures_kind_check;
alter table public.cultures add constraint cultures_kind_check
  check (kind in ('plate', 'slant', 'liquid', 'water', 'cryo', 'spore_print', 'other'));

alter table public.cultures drop constraint if exists cultures_p_level_check;
alter table public.cultures add constraint cultures_p_level_check
  check (p_level between 0 and 99); -- 0 = master, 1-4 working plates

alter table public.cultures add column cold_since date;

-- ---------- grain runs ----------

alter table public.grain_runs
  add column status text not null default 'incubating'
    check (status in ('incubating', 'ready', 'cold_storage', 'used_up', 'contaminated', 'discarded')),
  add column cold_since date,
  add column location text,
  add column label text,
  add column bags_lost integer not null default 0 check (bags_lost >= 0),
  add column parent_bags_used numeric check (parent_bags_used is null or parent_bags_used >= 0);

create index if not exists grain_runs_strain_idx on public.grain_runs (strain_id);
create index if not exists grain_runs_parent_idx on public.grain_runs (parent_grain_run_id);

-- ---------- block lots ----------

alter table public.block_lots
  add column species_key text,
  add column g2_bags_used numeric check (g2_bags_used is null or g2_bags_used >= 0),
  alter column species_id drop not null;

update public.block_lots b set species_key = case sp.letter when 'B' then 'blue-oyster' when 'L' then 'lions-mane' when 'C' then 'comb-tooth'
    when 'G' then 'golden-oyster' when 'P' then 'phoenix-oyster' end
  from public.species sp where sp.id = b.species_id and b.species_key is null;

alter table public.block_lots drop constraint if exists block_lots_lot_code_knock_date_key;
create index if not exists block_lots_code_idx on public.block_lots (lot_code, knock_date);
create index if not exists block_lots_grain_idx on public.block_lots (grain_run_id);
