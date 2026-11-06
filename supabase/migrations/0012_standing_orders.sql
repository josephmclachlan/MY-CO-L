-- MY/CO/L database, twelfth version (6 Nov 2026): STANDING ORDERS and HARVEST FORECAST (build G5).
-- Run this AFTER 0011. Paste the whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run twice. Local mode needs nothing.
--
-- 1. standing_orders: what each buyer takes every week. Cash on delivery only (Joseph, 6 Nov 2026), so there is
--    no payment-terms column at all. Money is in colones; US$ is worked out from fx_rates at the day shown.
--    Changing terms ends the old row (end_on) and starts a new one (prev_id), so past weeks keep their old price.
-- 2. order_weeks: a one-week change to an order (kg = 0 skips that week). id = order id + ':' + the Monday.
-- 3. sales.order_id: set when a sale was made by ticking an order's delivery off the pick list.

create table if not exists public.standing_orders (
  id uuid primary key,
  buyer text not null,
  channel text not null default 'restaurant' check (channel in ('market', 'restaurant', 'shop', 'direct', 'delivery', 'other')),
  species_key text not null,
  form text not null default 'fresh' check (form in ('fresh', 'dried')),
  kg numeric not null check (kg > 0),
  price_crc_per_kg numeric not null check (price_crc_per_kg > 0),
  day_of_week smallint not null default 5 check (day_of_week between 1 and 7), -- 1 = Monday
  start_on date not null,
  end_on date,
  confirmed boolean not null default false,
  prev_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists standing_orders_buyer on public.standing_orders (buyer);
create index if not exists standing_orders_dates on public.standing_orders (start_on, end_on);

create table if not exists public.order_weeks (
  id text primary key,
  order_id uuid not null references public.standing_orders (id) on delete cascade,
  week_start date not null,
  kg numeric not null check (kg >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists order_weeks_week on public.order_weeks (week_start);

alter table public.sales add column if not exists order_id text;
create index if not exists sales_order_idx on public.sales (order_id);

select public.owner_only('public.standing_orders');
select public.owner_only('public.order_weeks');
