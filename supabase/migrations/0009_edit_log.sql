-- MY/CO/L database, ninth version (6 Nov 2026): EDIT HISTORY.
-- Run this AFTER 0008. Paste the whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run twice. Without it, linked mode still saves records, but the HISTORY screen stays empty
-- and each change shows as REFUSED under HISTORY > SAVING + SYNC (local mode needs nothing).
--
-- One row per record per change: who, when, which screen, the field-by-field old and new values,
-- and on deletes a full copy of the record so it can be restored.
-- Rows are only ever added (the app never edits or deletes history).

create table if not exists public.edit_log (
  id uuid primary key,
  at timestamptz not null default now(),
  who text not null,
  action_id uuid not null,
  label text not null,
  screen text,
  table_name text not null,
  row_id text not null,        -- text, not uuid: settings rows use words ('rates'), summaries use '*'
  op text not null check (op in ('create', 'update', 'delete')),
  via text not null default 'edit' check (via in ('edit', 'undo', 'restore', 'import', 'system')),
  changes jsonb not null default '[]',
  snapshot jsonb
);

create index if not exists edit_log_row on public.edit_log (table_name, row_id, at desc);
create index if not exists edit_log_at on public.edit_log (at desc);

select public.owner_only('public.edit_log');
