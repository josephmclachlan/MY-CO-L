-- MY/CO/L database, first version (build 1, 5 Nov 2026).
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run.
-- It is safe to run on a brand-new project only.
--
-- One lot code ties the farm together: species letter + knock date MMDD
-- (e.g. B1020), Catawba style. A sale traces back to its harvests, block lot,
-- steam run and grain run.
--
-- Security: every table has row level security on. Only signed-in users can
-- read or write. Public sign-up is switched off in the dashboard, so the only
-- users are the ones Joseph adds by hand.

create extension if not exists pgcrypto;

-- ---------- helpers ----------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- living things ----------

create table public.species (
  id uuid primary key default gen_random_uuid(),
  letter text not null unique check (letter ~ '^[A-Z]$'), -- lot code letter
  common_name text not null,
  latin_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.strains (
  id uuid primary key default gen_random_uuid(),
  species_id uuid not null references public.species(id),
  code text not null unique, -- e.g. LM-03
  name text,
  source text, -- where the strain came from
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cultures (
  id uuid primary key default gen_random_uuid(),
  strain_id uuid not null references public.strains(id),
  parent_culture_id uuid references public.cultures(id),
  kind text not null check (kind in ('plate', 'slant', 'liquid', 'spore_print', 'other')),
  p_level smallint check (p_level between 1 and 4), -- P1 to P4
  made_on date not null default current_date,
  status text not null default 'clean'
    check (status in ('clean', 'contaminated', 'used_up', 'cold_storage', 'discarded')),
  location text,
  label text, -- printed label / QR text
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.cultures (strain_id);
create index on public.cultures (parent_culture_id);

-- ---------- rooms, equipment and power ----------

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, -- e.g. LAB, FRUIT
  name text not null,
  kind text, -- lab, incubation, fruiting, packing, boiler, other
  temp_min_c numeric,
  temp_max_c numeric,
  rh_min numeric,
  rh_max numeric,
  co2_max_ppm integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.circuits (
  id uuid primary key default gen_random_uuid(),
  breaker_tag text not null unique, -- e.g. S17
  name text not null,
  leg text not null check (leg in ('L1', 'L2', 'L1L2')),
  volts integer not null check (volts in (120, 240)),
  breaker_amps integer,
  watts integer,
  emergency boolean not null default false, -- on the generator list
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  room_id uuid references public.rooms(id),
  circuit_id uuid references public.circuits(id),
  watts integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- cooking (steam box, MegaChef, 75X) ----------

create table public.cook_runs (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid references public.equipment(id),
  kind text not null check (kind in ('steam_box', 'megachef', 'pressure_75x', 'other')),
  purpose text check (purpose in ('substrate', 'grain', 'agar', 'other')),
  load_desc text,
  bag_count integer,
  started_at timestamptz,
  ended_at timestamptz,
  come_up_minutes integer,
  -- Hold minutes above each threshold from Joseph's substrate temperature log.
  hold_min_190f integer,
  hold_min_198f integer,
  hold_min_200f integer,
  kwh numeric,
  cost_crc numeric,
  result text not null default 'pending' check (result in ('pending', 'pass', 'fail')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cook_readings (
  id uuid primary key default gen_random_uuid(),
  cook_run_id uuid not null references public.cook_runs(id) on delete cascade,
  taken_at timestamptz not null,
  zone text not null, -- probe position, e.g. TOP, MID, CORE
  temp_f numeric not null, -- stored in °F to match the log sheet thresholds
  created_at timestamptz not null default now()
);
create index on public.cook_readings (cook_run_id, taken_at);

-- ---------- grain, blocks, harvest ----------

create table public.grain_runs (
  id uuid primary key default gen_random_uuid(),
  generation text not null check (generation in ('G1', 'G2')),
  strain_id uuid not null references public.strains(id),
  parent_culture_id uuid references public.cultures(id),
  parent_grain_run_id uuid references public.grain_runs(id),
  cook_run_id uuid references public.cook_runs(id),
  bag_count integer not null check (bag_count >= 0),
  inoculated_on date not null default current_date,
  result text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_culture_id is not null or parent_grain_run_id is not null)
);

create table public.block_lots (
  id uuid primary key default gen_random_uuid(),
  lot_code text not null, -- species letter + knock MMDD, e.g. B1020
  species_id uuid not null references public.species(id),
  strain_id uuid references public.strains(id),
  grain_run_id uuid references public.grain_runs(id),
  cook_run_id uuid references public.cook_runs(id),
  bag_count integer not null check (bag_count >= 0),
  knock_date date not null,
  to_fruiting_on date,
  status text not null default 'incubating'
    check (status in ('incubating', 'fruiting', 'spent', 'lost')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The code repeats each year, so it is unique together with the date.
  unique (lot_code, knock_date)
);

create table public.contaminants (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text check (kind in ('mould', 'bacteria', 'yeast', 'pest', 'disease', 'other')),
  stages text[], -- which stages it hits
  how_to_spot text,
  look_alikes text,
  cause text,
  treatment text,
  prevention text,
  sources jsonb not null default '[]', -- [{ "source": "...", "time": "..." }]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lot_losses (
  id uuid primary key default gen_random_uuid(),
  block_lot_id uuid not null references public.block_lots(id) on delete cascade,
  bag_count integer not null check (bag_count > 0),
  contaminant_id uuid references public.contaminants(id),
  cause text,
  noted_on date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

create table public.harvests (
  id uuid primary key default gen_random_uuid(),
  block_lot_id uuid not null references public.block_lots(id),
  harvested_on date not null default current_date,
  flush smallint not null default 1 check (flush between 1 and 9),
  kg numeric not null check (kg >= 0),
  grade text,
  initials text,
  notes text,
  created_at timestamptz not null default now()
);
create index on public.harvests (block_lot_id);

-- ---------- sales ----------

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  sold_on date not null default current_date,
  buyer text,
  channel text check (channel in ('market', 'restaurant', 'shop', 'direct', 'other')),
  species_id uuid references public.species(id),
  form text check (form in ('fresh', 'dried', 'other')),
  grade text,
  kg numeric not null check (kg >= 0),
  amount_crc numeric not null check (amount_crc >= 0), -- colones first
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sale_lots (
  sale_id uuid not null references public.sales(id) on delete cascade,
  block_lot_id uuid not null references public.block_lots(id),
  primary key (sale_id, block_lot_id)
);

-- ---------- stock (manifest) ----------

create table public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null, -- sack, bag, box, L, kg...
  on_hand numeric not null default 0,
  reorder_point numeric,
  lead_time_days integer,
  supplier text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.item_prices (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  priced_on date not null default current_date,
  price_crc numeric not null check (price_crc >= 0),
  supplier text,
  created_at timestamptz not null default now()
);

create table public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  moved_at timestamptz not null default now(),
  qty numeric not null, -- + delivery, - use
  reason text,
  cook_run_id uuid references public.cook_runs(id),
  grain_run_id uuid references public.grain_runs(id),
  block_lot_id uuid references public.block_lots(id),
  notes text,
  created_at timestamptz not null default now()
);
create index on public.stock_moves (item_id, moved_at);

-- ---------- money, labour, energy, sensors ----------

create table public.energy_bills (
  id uuid primary key default gen_random_uuid(),
  month date not null unique, -- first day of the billed month
  kwh numeric not null,
  billed_kw numeric, -- demand (binomic billing)
  total_crc numeric not null,
  notes text,
  created_at timestamptz not null default now()
);

create table public.labour_entries (
  id uuid primary key default gen_random_uuid(),
  worked_on date not null default current_date,
  person text not null,
  hours numeric not null check (hours > 0),
  task text,
  block_lot_id uuid references public.block_lots(id),
  notes text,
  created_at timestamptz not null default now()
);

create table public.sensor_readings (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id),
  taken_at timestamptz not null,
  temp_c numeric,
  rh numeric,
  co2_ppm integer,
  source text, -- e.g. govee:<device>
  created_at timestamptz not null default now()
);
create index on public.sensor_readings (room_id, taken_at desc);

-- ---------- reference text (read-only in normal use) ----------

create table public.reference_entries (
  id uuid primary key default gen_random_uuid(),
  topic text not null, -- e.g. species, settings, troubleshooting
  key text not null,
  body text not null,
  source text, -- e.g. "Cap n Stem, video X"
  source_time text, -- timestamp in the video or podcast
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic, key)
);

-- ---------- updated_at triggers ----------

do $$
declare t text;
begin
  foreach t in array array[
    'species', 'strains', 'cultures', 'rooms', 'circuits', 'equipment', 'cook_runs',
    'grain_runs', 'block_lots', 'contaminants', 'sales', 'items', 'reference_entries'
  ] loop
    execute format(
      'create trigger touch_%1$s before update on public.%1$I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------- row level security: signed-in users only ----------

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "signed-in users can read" on public.%I for select to authenticated using (true)', t);
    execute format(
      'create policy "signed-in users can write" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- starting species ----------
-- Letters other than B are a first guess. Change them here or in the app later.

insert into public.species (letter, common_name, latin_name) values
  ('B', 'Blue oyster', 'Pleurotus ostreatus'),
  ('L', 'Lion''s mane', 'Hericium erinaceus'),
  ('C', 'Coral tooth', 'Hericium coralloides'),
  ('G', 'Golden oyster', 'Pleurotus citrinopileatus'),
  ('P', 'Phoenix oyster', 'Pleurotus pulmonarius');
