-- MY/CO/L database, fourteenth version (6 Nov 2026): FACILITY LOGS (build G7).
-- Run this AFTER 0013. Paste the whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run twice. Local mode needs nothing.
--
-- Times are exact UTC moments. The app shows and adds up the FARM's clock (Costa Rica, UTC-6, no daylight saving).
--
-- 1. power_cuts: one row per grid outage (kind 'cut') or generator test run (kind 'test'). up_at is empty while
--    the power is still out. gen_runs is a list of {on, off} generator runs inside the cut.
-- 2. water_tests: one reading set at one sampling point.
-- 3. maint_items / maint_log: the equipment and maintenance register, and each time a job was done.
-- 4. clean_log: cleaning and sanitation per room.
-- 5. checklist_runs: a signed-off checklist (lab clean-down, steam run, knock day, power cut response).
-- 6. reminders: reminders typed by hand (the others are worked out from the rest of the data).

create table if not exists public.power_cuts (
  id uuid primary key,
  kind text not null default 'cut' check (kind in ('cut', 'test')),
  down_at timestamptz not null,
  up_at timestamptz,
  gen_runs jsonb,
  gen_hours numeric check (gen_hours is null or (gen_hours >= 0 and gen_hours <= 720)),
  fuel text check (fuel is null or fuel in ('propane', 'gasoline')),
  fuel_amount numeric check (fuel_amount is null or (fuel_amount >= 0 and fuel_amount <= 1000)),
  affected text[],
  losses text,
  notes text,
  who text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (up_at is null or up_at > down_at)
);
create index if not exists power_cuts_down on public.power_cuts (down_at);

create table if not exists public.water_tests (
  id uuid primary key,
  tested_on date not null,
  tested_time text,
  point text not null check (point in ('raw', 'filtered', 'ro', 'tank', 'mix')),
  ph numeric check (ph is null or (ph >= 0 and ph <= 14)),
  tds_ppm numeric check (tds_ppm is null or (tds_ppm >= 0 and tds_ppm <= 5000)),
  hardness_ppm numeric check (hardness_ppm is null or (hardness_ppm >= 0 and hardness_ppm <= 2000)),
  cl_ppm numeric check (cl_ppm is null or (cl_ppm >= 0 and cl_ppm <= 1000)),
  temp_c numeric check (temp_c is null or (temp_c >= 0 and temp_c <= 60)),
  action text,
  notes text,
  who text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists water_tests_day on public.water_tests (tested_on);

create table if not exists public.maint_items (
  id uuid primary key,
  name text not null,
  category text not null default 'other',
  room_id text,
  make_model text,
  serial text,
  installed_on date,
  every_days integer check (every_days is null or every_days > 0),
  every_hours numeric check (every_hours is null or every_hours > 0),
  last_done_on date,
  started_on date not null,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.maint_log (
  id uuid primary key,
  item_id uuid not null references public.maint_items(id) on delete cascade,
  done_on date not null,
  who text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists maint_log_item on public.maint_log (item_id, done_on);

create table if not exists public.clean_log (
  id uuid primary key,
  cleaned_on date not null,
  room_id text not null,
  tasks text[] not null,
  product text,
  who text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clean_log_day on public.clean_log (cleaned_on);

create table if not exists public.checklist_runs (
  id uuid primary key,
  template text not null,
  done_on date not null,
  finished_at timestamptz not null,
  who text,
  items jsonb not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists checklist_runs_day on public.checklist_runs (template, done_on);

create table if not exists public.reminders (
  id uuid primary key,
  due_on date not null,
  text text not null,
  repeat_days integer check (repeat_days is null or repeat_days > 0),
  done_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

select public.owner_only('public.power_cuts');
select public.owner_only('public.water_tests');
select public.owner_only('public.maint_items');
select public.owner_only('public.maint_log');
select public.owner_only('public.clean_log');
select public.owner_only('public.checklist_runs');
select public.owner_only('public.reminders');
