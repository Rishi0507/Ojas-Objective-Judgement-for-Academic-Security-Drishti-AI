-- Fleet calibration profiles.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- One row per camera per centre: what motion is normal in each region of that
-- camera's view, accumulated across sessions. lib/centreStore.ts mirrors here
-- when SUPABASE_SERVICE_ROLE_KEY is set; the local fleet/ directory stays the
-- source of truth so a laptop with no key still works.
--
-- Sized for the target deployment: 800 centres x ~4 cameras x ~12 regions is
-- roughly 3,200 rows of small JSON. Trivial for Postgres - the reason this is
-- a table rather than a file is concurrent access from many centres, not size.

create table if not exists public.centre_profiles (
  id               uuid primary key default gen_random_uuid(),
  centre_id        text not null,
  camera_id        text not null,
  -- [cols, rows] and [w, h]. Stored because a profile is only comparable to a
  -- session captured the same way; a re-framed camera invalidates its regions.
  grid             integer[] not null default '{}',
  frame_resolution integer[] not null default '{}',
  sessions         integer not null default 0,
  -- {"r0c0": {"mu": .., "sigma": .., "samples": ..}, ...}
  regions          jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (centre_id, camera_id)
);

create index if not exists centre_profiles_centre_idx
  on public.centre_profiles (centre_id);

-- Drift verdicts, kept as history rather than overwritten.
--
-- A single "current status" column would answer "is this camera ok now" and
-- lose "has it been drifting for three sessions", which is the pattern that
-- distinguishes a camera someone keeps knocking from a one-off bump.
create table if not exists public.centre_drift_events (
  id               uuid primary key default gen_random_uuid(),
  centre_id        text not null,
  camera_id        text not null,
  verdict          text not null
                   check (verdict in ('stable','camera_moved','scene_changed','unusable','no_baseline')),
  regions_shifted  integer not null default 0,
  regions_compared integer not null default 0,
  peak_shift       double precision,
  reasoning        text,
  pipeline_dir     text,
  created_at       timestamptz not null default now()
);

create index if not exists centre_drift_camera_idx
  on public.centre_drift_events (centre_id, camera_id, created_at desc);

-- RLS on, deliberately with no policy for anon/authenticated.
--
-- Fleet calibration is operator infrastructure, not candidate-facing data, and
-- it is written only by the server's service role - which bypasses RLS. A
-- table with RLS enabled and no policy denies everything else, which is the
-- correct default here: no browser session has any business reading which of
-- 800 centres has a misaligned camera.
alter table public.centre_profiles     enable row level security;
alter table public.centre_drift_events enable row level security;

drop trigger if exists centre_profiles_touch on public.centre_profiles;
create trigger centre_profiles_touch before update on public.centre_profiles
  for each row execute function public.touch_updated_at();
