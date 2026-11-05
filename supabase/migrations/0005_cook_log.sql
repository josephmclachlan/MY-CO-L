-- MY/CO/L database, fifth version (build 9, 5 Nov 2026): PROPULSION cook and sterilization log.
-- Run this AFTER 0004. Paste the whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run twice. Without it, saving a cook run in linked mode fails with "column ... does not exist".
--
-- cook_runs (0001) already holds kind, purpose, load, bag_count, times, come_up_minutes, the three hold
-- columns from Joseph's log sheet, kwh, cost_crc and result. This adds what the log screen also keeps:
--   unit_label    which vessel or round, e.g. 'ROUND A'
--   hold_min_205f minutes above 205 F (overprocessing)
--   max_temp_f, f_value        peak core temperature and the sheet's F (lethality) figure
--   hold_min_psi  minutes at pressure (75X)
--   heater_option the VITALS heater choice at the time: '2x4500' or '6500'
--   pots          MegaChef pots in the batch
--   cook_minutes  cook or pressure-hold minutes typed by hand (no probe)
--   kwh_metered   meter reading for the run, if you took one
--   heater_on_min heater on-time from the controller, if you read it
--   kwh_basis     where kwh came from: METERED, ON-TIME or ESTIMATE
--   seq_run_ref   the SEQUENCE run this cook belongs to, e.g. RUN-20261102-1
-- cook_readings gets a psi column (75X gauge). temp_f may now be empty when the row is a pressure reading.

alter table public.cook_runs add column if not exists unit_label text;
alter table public.cook_runs add column if not exists hold_min_205f integer;
alter table public.cook_runs add column if not exists max_temp_f numeric;
alter table public.cook_runs add column if not exists f_value numeric;
alter table public.cook_runs add column if not exists hold_min_psi integer;
alter table public.cook_runs add column if not exists heater_option text check (heater_option in ('2x4500', '6500'));
alter table public.cook_runs add column if not exists pots integer;
alter table public.cook_runs add column if not exists cook_minutes numeric;
alter table public.cook_runs add column if not exists kwh_metered numeric;
alter table public.cook_runs add column if not exists heater_on_min numeric;
alter table public.cook_runs add column if not exists kwh_basis text check (kwh_basis in ('METERED', 'ON-TIME', 'ESTIMATE'));
alter table public.cook_runs add column if not exists seq_run_ref text;
create index if not exists cook_runs_seq_idx on public.cook_runs (seq_run_ref) where seq_run_ref is not null;

alter table public.cook_readings add column if not exists psi numeric;
alter table public.cook_readings alter column temp_f drop not null;
alter table public.cook_readings drop constraint if exists cook_readings_value_check;
alter table public.cook_readings add constraint cook_readings_value_check check (temp_f is not null or psi is not null);
