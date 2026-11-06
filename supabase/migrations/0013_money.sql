-- MY/CO/L database, thirteenth version (6 Nov 2026): MONEY (build G6).
-- Run this AFTER 0012. Paste the whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run twice. Local mode needs nothing.
--
-- Money rules (Joseph, 6 Nov 2026): every amount is stored in colones. US$ is worked out from fx_rates at the
-- record's own day, so history never changes when today's rate does. Every buyer pays cash on delivery.
--
-- 1. sales gets pay_status (paid / owed / written_off), paid_on (cash day, or the write-off day) and receipt_no.
--    Old sales were cash on delivery, so they are filled in as paid on the sale day.
-- 2. cash_moves: money spent or money in that is not a sale (loans, savings added), one line of the
--    12-month cash flow template each.
-- 3. budget_lines: one budget figure per month per line. id = 'yyyy-mm:line'.
-- 4. waste_log: fresh kg that did not sell fresh, and where it went (unsold, dried, donated, compost).

alter table public.sales add column if not exists pay_status text not null default 'paid';
alter table public.sales drop constraint if exists sales_pay_status_check;
alter table public.sales add constraint sales_pay_status_check check (pay_status in ('paid', 'owed', 'written_off'));
alter table public.sales add column if not exists paid_on date;
alter table public.sales add column if not exists receipt_no text;
update public.sales set paid_on = sold_on where pay_status = 'paid' and paid_on is null;
create unique index if not exists sales_receipt_no_idx on public.sales (receipt_no) where receipt_no is not null;
create index if not exists sales_pay_status_idx on public.sales (pay_status) where pay_status <> 'paid';

create table if not exists public.cash_moves (
  id uuid primary key,
  day date not null,
  line text not null check (line in (
    'other_income', 'loan_in', 'fuel', 'substrate', 'packaging', 'water', 'cultures', 'labour', 'transport',
    'repairs', 'admin', 'other_out', 'equipment', 'loan_pay')),
  amount_crc numeric not null check (amount_crc > 0),
  who text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cash_moves_day on public.cash_moves (day);

create table if not exists public.budget_lines (
  id text primary key,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  line text not null,
  amount_crc numeric not null check (amount_crc >= 0),
  updated_at timestamptz not null default now()
);
create index if not exists budget_lines_month on public.budget_lines (month);

create table if not exists public.waste_log (
  id uuid primary key,
  logged_on date not null,
  species_key text not null,
  kg numeric not null check (kg > 0),
  route text not null check (route in ('unsold', 'dried', 'donated', 'compost')),
  lot_codes text[],
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists waste_log_day on public.waste_log (logged_on);

select public.owner_only('public.cash_moves');
select public.owner_only('public.budget_lines');
select public.owner_only('public.waste_log');
