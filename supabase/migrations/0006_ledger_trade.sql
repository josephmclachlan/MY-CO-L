-- MY/CO/L database, sixth version (build 10, 5 Nov 2026): LEDGER (cost of goods) and TRADE (sales).
-- Run this AFTER 0005. Paste the whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run twice. Without it, saving a sale in linked mode fails with "column ... does not exist".
--
-- energy_bills and labour_entries (0001) already hold what LEDGER needs.
-- sales gets:
--   species_key  the app's species id ('blue-oyster'), the same as block_lots.species_key (0003)
--   lot_codes    the lot codes on the sale, as typed (B1020 L1022). Text, so a sale can name a lot
--                that was never logged; sale_lots (0001) stays for exact links later.
-- and the channel list adds 'delivery'.

alter table public.sales add column if not exists species_key text;
alter table public.sales add column if not exists lot_codes text[];

alter table public.sales drop constraint if exists sales_channel_check;
alter table public.sales add constraint sales_channel_check
  check (channel in ('market', 'restaurant', 'shop', 'direct', 'delivery', 'other'));

create index if not exists sales_sold_on_idx on public.sales (sold_on);
create index if not exists sales_species_idx on public.sales (species_key);
create index if not exists labour_worked_on_idx on public.labour_entries (worked_on);
