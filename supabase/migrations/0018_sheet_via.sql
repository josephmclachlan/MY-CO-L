-- MY/CO/L database, eighteenth version (7 Nov 2026): GOOGLE SHEET MIRROR.
-- Run this AFTER 0017. Paste the whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run twice.
--
-- DATA > GOOGLE SHEET mirrors every record into one Google Sheet and brings edits typed there back.
-- Those changes go into the edit history marked via = 'sheet' (signed GOOGLE SHEET), so HISTORY shows
-- where they came from and UNDO can reverse them. This widens the check on edit_log.via to allow that
-- word. Nothing else changes: the sync's memory stays on the syncing device, no new table, no new policy.

do $$
begin
  if to_regclass('public.edit_log') is not null then
    alter table public.edit_log drop constraint if exists edit_log_via_check;
    alter table public.edit_log add constraint edit_log_via_check
      check (via in ('edit', 'undo', 'restore', 'import', 'system', 'assistant', 'sheet'));
  end if;
end $$;
