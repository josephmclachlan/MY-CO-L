-- MY/CO/L database, seventeenth version (6 Nov 2026): FARM ASSISTANT.
-- Run this AFTER 0016. Paste the whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run twice.
--
-- The ASK screen (module 22) can save records from a typed command ("log 4.2 kg from B1020") after
-- the person presses CONFIRM. Those changes go into the edit history like any other, marked
-- via = 'assistant' so the HISTORY screen can show where they came from. This widens the check on
-- edit_log.via to allow that word. Nothing else changes: no new table, no new policy.

do $$
begin
  if to_regclass('public.edit_log') is not null then
    alter table public.edit_log drop constraint if exists edit_log_via_check;
    alter table public.edit_log add constraint edit_log_via_check
      check (via in ('edit', 'undo', 'restore', 'import', 'system', 'assistant'));
  end if;
end $$;
