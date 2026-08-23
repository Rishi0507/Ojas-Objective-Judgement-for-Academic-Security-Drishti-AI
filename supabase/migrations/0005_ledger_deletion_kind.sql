-- Allow deletion events in the custody ledger.
--
-- Removing media is exactly the act an audit trail must not be silent about.
-- The ledger entry outlives the files it describes: job_id is plain text and
-- not a foreign key precisely so that deleting a video leaves behind the
-- record that it existed, who removed it, and when.
--
--   media_pruned  - intermediates discarded (optical flow, motion masks).
--                   Findings, evidence stills and results are untouched.
--   media_deleted - the whole job removed, including evidence stills.
--
-- Written as a constraint swap so it applies whether or not 0003 has run.

alter table public.ledger_entries
  drop constraint if exists ledger_entries_kind_check;

alter table public.ledger_entries
  add constraint ledger_entries_kind_check
  check (kind in (
    'video_uploaded',
    'artifact_derived',
    'verdict_recorded',
    'report_generated',
    'media_pruned',
    'media_deleted',
    'anchor_published'
  ));
