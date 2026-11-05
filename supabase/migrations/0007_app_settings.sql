-- MY/CO/L database, seventh version (5 Nov 2026): PRICES + COSTS.
-- Run this AFTER 0006. Paste the whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run twice. Without it, saving on the PRICES + COSTS screen in linked mode fails with
-- "relation app_settings does not exist" (local mode needs nothing).
--
-- One row per settings record. Row 'rates' holds every price and cost the app uses: sale prices per
-- species, the ICE tariff and monthly estimate, labour rate, wear and the colones-per-dollar rate.
-- Supply prices stay in item_prices (CARGO).

create table if not exists public.app_settings (
  id text primary key, -- e.g. 'rates'
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

select public.owner_only('public.app_settings');
