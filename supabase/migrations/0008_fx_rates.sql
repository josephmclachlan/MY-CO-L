-- MY/CO/L database, eighth version (6 Nov 2026): exchange rate by day.
-- Run this AFTER 0007, only when you link Supabase. Local mode needs nothing.
-- Safe to run twice.
--
-- One row per day: colones per US dollar on that day. Every amount in the app is saved in colones;
-- dollars are only shown, at the rate of the record's own day, so history never moves with the rate.
-- source: AUTO = fetched by the app (daily market rate), MANUAL = typed by you (wins over AUTO).

create table if not exists public.fx_rates (
  id text primary key, -- the day, yyyy-mm-dd
  day date not null unique,
  crc_per_usd numeric not null check (crc_per_usd > 0),
  source text not null default 'AUTO' check (source in ('AUTO', 'MANUAL')),
  fetched_at timestamptz
);

select public.owner_only('public.fx_rates');
