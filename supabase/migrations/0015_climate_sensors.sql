-- MY/CO/L database, fifteenth version (6 Nov 2026): CLIMATE SENSORS (build G8, basic).
-- Run this AFTER 0014. Paste the whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run twice. Local mode needs nothing.
--
-- 1. sensors: each sensor (Govee thermo-hygrometer, CO2 meter, hand thermometer ...) and where it is.
-- 2. sensor_readings: one reading at one moment. REPLACES the first draft of this table from 0001, which the app
--    never wrote to (number ids and a link to a rooms table the app does not use). The old table is only dropped
--    when it is still the old shape AND empty; if it holds rows, this file stops and says so.
-- 3. ac_log: hand checks of the air conditioners (no Lennox feed yet).
--
-- Places are short codes: lab, fridge, packing, coldroom, incubation, fruiting, boiling, outside.
-- Times are exact UTC moments; the app shows the farm clock (Costa Rica, UTC-6).
-- A live feed (the bridge, build G13) writes readings straight into sensor_readings with source 'govee' or 'bridge'.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sensor_readings' and column_name = 'room_id'
  ) then
    if exists (select 1 from public.sensor_readings limit 1) then
      raise exception 'sensor_readings (from 0001) holds rows. Copy them out before running 0015.';
    end if;
    drop table public.sensor_readings;
  end if;
end $$;

create table if not exists public.sensors (
  id uuid primary key,
  name text not null,
  place text not null check (place in ('lab', 'fridge', 'packing', 'coldroom', 'incubation', 'fruiting', 'boiling', 'outside')),
  vendor text not null default 'other' check (vendor in ('govee', 'lennox', 'co2meter', 'inkbird', 'hand', 'other')),
  model text,
  device_id text,
  measures text[] not null default '{temp,rh}',
  auto boolean not null default false,
  active boolean not null default true,
  mock boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sensor_readings (
  id uuid primary key,
  sensor_id uuid references public.sensors(id) on delete set null,
  place text not null check (place in ('lab', 'fridge', 'packing', 'coldroom', 'incubation', 'fruiting', 'boiling', 'outside')),
  taken_at timestamptz not null,
  temp_c numeric check (temp_c is null or (temp_c >= -20 and temp_c <= 60)),
  rh numeric check (rh is null or (rh >= 0 and rh <= 100)),
  co2_ppm integer check (co2_ppm is null or (co2_ppm >= 0 and co2_ppm <= 20000)),
  source text not null default 'hand' check (source in ('hand', 'csv', 'mock', 'govee', 'lennox', 'bridge')),
  batch text,
  who text,
  note text,
  created_at timestamptz not null default now(),
  check (temp_c is not null or rh is not null or co2_ppm is not null)
);
create index if not exists sensor_readings_place_time on public.sensor_readings (place, taken_at desc);
create index if not exists sensor_readings_sensor_time on public.sensor_readings (sensor_id, taken_at desc);
create index if not exists sensor_readings_batch on public.sensor_readings (batch) where batch is not null;

create table if not exists public.ac_log (
  id uuid primary key,
  unit text not null,
  logged_at timestamptz not null,
  mode text not null check (mode in ('cool', 'dry', 'fan', 'heat', 'auto', 'off')),
  set_c numeric check (set_c is null or (set_c >= 0 and set_c <= 40)),
  shown_c numeric check (shown_c is null or (shown_c >= 0 and shown_c <= 40)),
  state text not null check (state in ('running', 'stopped', 'fault')),
  fault_code text,
  notes text,
  who text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ac_log_unit_time on public.ac_log (unit, logged_at desc);

-- updated_at triggers (same function as the other tables).
do $$
declare t text;
begin
  foreach t in array array['sensors', 'ac_log'] loop
    if not exists (select 1 from pg_trigger where tgname = 'touch_' || t) then
      execute format('create trigger touch_%1$s before update on public.%1$I for each row execute function public.touch_updated_at()', t);
    end if;
  end loop;
end $$;

-- Owner-only access, like every other table (see 0002).
select public.owner_only('public.sensors');
select public.owner_only('public.sensor_readings');
select public.owner_only('public.ac_log');
