-- DrishtiAI - auth-scoped schema and storage.
-- Run once in: Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Mirrors the on-disk pipeline structure:
--   pipeline_out/<job>/                  -> public.videos            (one row per upload)
--   .../backend_output/enriched_events   -> public.events            (one row per segment)
--   .../offences[]                       -> public.offences          (one row per finding)
--   .../clips/*.mp4                      -> storage bucket "clips"
--   .../snapshots, offence_stills/*.jpg  -> storage bucket "snapshots"
--   uploads/<job>.mp4, playback.mp4      -> storage bucket "videos"
--
-- Everything is owner-scoped: a signed-in user sees only their own uploads.
-- The pipeline itself writes with the service role, which bypasses RLS.

-- ---------------------------------------------------------------- tables ---

create table if not exists public.videos (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users (id) on delete cascade,
  job_id         text not null,                       -- pipeline_out/<job_id>
  filename       text not null,
  status         text not null default 'queued'
                 check (status in ('queued','processing','done','error')),
  pipeline_dir   text,
  duration_sec   double precision,
  resolution     text,
  fps            double precision,
  event_count    integer not null default 0,
  -- Storage object paths, not signed URLs: URLs expire, paths do not.
  source_path    text,
  playback_path  text,
  heatmap_path   text,
  error_message  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (owner_id, job_id)
);

create table if not exists public.events (
  id                  uuid primary key default gen_random_uuid(),
  video_id            uuid not null references public.videos (id) on delete cascade,
  event_key           text not null,                  -- "event-1"
  start_sec           double precision not null,
  end_sec             double precision not null,
  duration_sec        double precision,
  priority            text check (priority in ('high','medium','low')),
  event_type          text,
  description         text,
  motion_score        double precision,
  observability       double precision,
  camera_shake        double precision,
  object_score        double precision,
  person_proximity    double precision,
  person_count        integer,
  track_ids           text[],
  roi                 integer[],
  -- 10.3: readable bands rather than raw floats.
  uncertainty_reasons jsonb,
  -- 10.6:every claim bound to the evidence it rests on.
  explanations        jsonb,
  clip_path           text,
  annotated_clip_path text,
  created_at          timestamptz not null default now(),
  unique (video_id, event_key)
);

create table if not exists public.offences (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  offence_type  text not null,        -- prohibited_object | head_turn | hand_gesture | ...
  label         text not null,
  track_id      text,
  start_sec     double precision,
  end_sec       double precision,
  frame_idx     integer,
  confidence    double precision,
  bbox          integer[],
  snapshot_path text,                 -- object path in the "snapshots" bucket
  created_at    timestamptz not null default now()
);

-- Investigator verdicts. Separate from offences so re-running detection never
-- discards human review, and so one offence can carry a review history.
create table if not exists public.offence_reviews (
  id         uuid primary key default gen_random_uuid(),
  offence_id uuid not null references public.offences (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  reviewer_id uuid not null references auth.users (id) on delete cascade,
  verdict    text not null check (verdict in ('confirmed','discarded','unsure')),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (offence_id, reviewer_id)
);

create index if not exists videos_owner_idx      on public.videos (owner_id, created_at desc);
create index if not exists events_video_idx      on public.events (video_id, start_sec);
create index if not exists offences_event_idx    on public.offences (event_id);
create index if not exists reviews_offence_idx   on public.offence_reviews (offence_id);

-- ------------------------------------------------------------------ RLS ---
-- Enabled on every table. A table with RLS on and no policy denies everything,
-- which is the safe failure direction; the policies below open exactly the
-- owner's own rows.

alter table public.videos          enable row level security;
alter table public.events          enable row level security;
alter table public.offences        enable row level security;
alter table public.offence_reviews enable row level security;

drop policy if exists videos_owner_all on public.videos;
create policy videos_owner_all on public.videos
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Child rows inherit reachability from the parent video's owner.
drop policy if exists events_via_video on public.events;
create policy events_via_video on public.events
  for all using (
    exists (select 1 from public.videos v
            where v.id = events.video_id and v.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.videos v
            where v.id = events.video_id and v.owner_id = auth.uid())
  );

drop policy if exists offences_via_event on public.offences;
create policy offences_via_event on public.offences
  for all using (
    exists (select 1 from public.events e
            join public.videos v on v.id = e.video_id
            where e.id = offences.event_id and v.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.events e
            join public.videos v on v.id = e.video_id
            where e.id = offences.event_id and v.owner_id = auth.uid())
  );

drop policy if exists reviews_own on public.offence_reviews;
create policy reviews_own on public.offence_reviews
  for all using (auth.uid() = reviewer_id) with check (auth.uid() = reviewer_id);

-- -------------------------------------------------------------- storage ---
-- Private buckets. Media is served through short-lived signed URLs, so a
-- leaked path is not a leaked recording. Exam footage of identifiable people
-- is the reason these are not public.

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('videos',    'videos',    false, 2147483648),  -- 2 GB, matches the upload route's cap
  ('clips',     'clips',     false,  268435456),  -- 256 MB
  ('snapshots', 'snapshots', false,   52428800)   -- 50 MB
on conflict (id) do nothing;

-- Objects are laid out as <auth.uid()>/<job_id>/... so the first path segment
-- is the ownership check.
drop policy if exists storage_own_folder_read on storage.objects;
create policy storage_own_folder_read on storage.objects
  for select using (
    bucket_id in ('videos','clips','snapshots')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists storage_own_folder_write on storage.objects;
create policy storage_own_folder_write on storage.objects
  for insert with check (
    bucket_id in ('videos','clips','snapshots')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists storage_own_folder_delete on storage.objects;
create policy storage_own_folder_delete on storage.objects
  for delete using (
    bucket_id in ('videos','clips','snapshots')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ------------------------------------------------------------- triggers ---

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists videos_touch on public.videos;
create trigger videos_touch before update on public.videos
  for each row execute function public.touch_updated_at();

drop trigger if exists reviews_touch on public.offence_reviews;
create trigger reviews_touch before update on public.offence_reviews
  for each row execute function public.touch_updated_at();
