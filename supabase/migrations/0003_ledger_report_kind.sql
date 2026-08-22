-- Allow 'report_generated' entries in the custody ledger.
--
-- An issued incident report is hashed and appended to the chain it describes,
-- so a copy circulating later can be checked against the ledger and shown to
-- be the document that was actually issued rather than an edited version.
--
-- Written as a constraint swap rather than an edit to 0002 so this applies
-- whether or not 0002 has already been run somewhere.

alter table public.ledger_entries
  drop constraint if exists ledger_entries_kind_check;

alter table public.ledger_entries
  add constraint ledger_entries_kind_check
  check (kind in (
    'video_uploaded',
    'artifact_derived',
    'verdict_recorded',
    'report_generated',
    'anchor_published'
  ));
