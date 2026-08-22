-- DrishtiAI - tamper-evident custody ledger.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- What this is
-- ------------
-- An append-only, hash-linked log of every material act performed on a piece
-- of evidence: the upload itself, each artifact the pipeline derived from it,
-- and every reviewer verdict. Each row carries the hash of the row before it,
-- so altering or removing any entry breaks every hash after it. That is the
-- same structure a blockchain uses; what is deliberately absent is distributed
-- consensus, which buys nothing when one organisation runs all the nodes.
--
-- What this is NOT
-- ----------------
-- No video, frame, or personal data is stored here - only digests. A hash of a
-- video file is not reversible and is safe to retain indefinitely. A hash of
-- something low-entropy (a seat number, a track ID) would be brute-forceable
-- in seconds, so payloads are hashed as whole documents, never field by field.
-- This matters beyond good practice: an append-only log of personal data would
-- collide head-on with the right to erasure.
--
-- What it proves, and what it does not
-- ------------------------------------
-- It proves nothing has been altered SINCE it reached this server. It cannot
-- prove the footage is authentic - edited or synthetic video uploaded at the
-- start would be faithfully certified. Closing that gap requires signing at
-- the point of capture (C2PA, or a camera holding a hardware key).
--
-- Until a public anchor is added (see lib/ledger/anchor.ts), the operator of
-- this database could in principle rewrite the entire chain from genesis. The
-- trigger below stops accidental and casual tampering, not a determined
-- administrator. Anchoring a periodic Merkle root externally is what closes
-- that, and the schema already carries the columns for it.

-- ----------------------------------------------------------------- table ---

create table if not exists public.ledger_entries (
  -- Gapless and strictly increasing. A gap is itself evidence of tampering,
  -- which is why this is not a uuid.
  seq             bigint primary key,

  -- The chain link. Genesis uses 64 zeros.
  prev_hash       text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  entry_hash      text not null check (entry_hash ~ '^[0-9a-f]{64}$'),

  -- The signed assertion. statement_hash is what the signature covers; it is
  -- kept separate from entry_hash so that signing does not depend on chain
  -- position, which the database assigns only at insert time.
  statement_hash  text not null check (statement_hash ~ '^[0-9a-f]{64}$'),
  signature       text,                    -- base64 Ed25519 over statement_hash
  public_key      text,                    -- base64, so a verifier can check without a keyserver

  kind            text not null check (kind in (
                    'video_uploaded',
                    'artifact_derived',
                    'verdict_recorded',
                    'anchor_published'
                  )),

  -- Plain text, not a foreign key: a ledger entry must outlive the row it
  -- describes. Cascading a delete into the audit trail would let deleting a
  -- video silently erase the record that it ever existed.
  job_id          text,
  subject         text not null,           -- what was acted on (file path, offence key)
  actor_id        uuid,                    -- auth.users id, or null for the pipeline itself

  -- The timestamp that was SIGNED, stored verbatim as text rather than as a
  -- timestamptz. A timestamptz round-trips through Postgres formatting and
  -- comes back with a different string than the one that was hashed - the
  -- entry would then fail verification despite nothing having been tampered
  -- with. created_at below records insertion time separately.
  statement_ts    text not null,

  payload_hash    text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  payload         jsonb not null default '{}'::jsonb,  -- metadata only, never content

  -- Anchoring (layer 3, not yet enabled). Populated when a batch containing
  -- this entry has its Merkle root published externally.
  anchor_root     text,
  anchor_ref      text,                    -- OTS receipt path or chain txid

  created_at      timestamptz not null default now()
);

create index if not exists ledger_job_idx     on public.ledger_entries (job_id, seq);
create index if not exists ledger_subject_idx on public.ledger_entries (subject);
create index if not exists ledger_unanchored  on public.ledger_entries (seq) where anchor_root is null;

-- -------------------------------------------------------- append-only ---
-- The single most important object in this file. RLS does not protect the
-- ledger, because the pipeline writes with the service role and the service
-- role bypasses RLS entirely - so a policy-based rule would be enforced on
-- everyone except the one component that writes most of the rows. A trigger
-- fires regardless of role, which is exactly the property required here.

create or replace function public.ledger_immutable()
returns trigger language plpgsql as $$
begin
  raise exception
    'ledger_entries is append-only; attempted % on seq %',
    tg_op, coalesce(old.seq, -1)
    using hint = 'Correct a mistaken entry by appending a correcting entry, never by editing history.';
end $$;

drop trigger if exists ledger_no_update on public.ledger_entries;
create trigger ledger_no_update before update on public.ledger_entries
  for each row execute function public.ledger_immutable();

drop trigger if exists ledger_no_delete on public.ledger_entries;
create trigger ledger_no_delete before delete on public.ledger_entries
  for each row execute function public.ledger_immutable();

-- ------------------------------------------------------ atomic append ---
-- Chaining has an inherent race: two concurrent uploads that both read the
-- current head would produce two entries claiming the same prev_hash, forking
-- the chain. Serialising in application code would not survive more than one
-- server process, so the read-modify-write happens here, under a transaction
-- lock, where it is atomic by construction.
--
-- The caller signs the statement BEFORE calling this, which is why signing
-- cannot depend on seq or prev_hash: those are assigned here. The signature
-- proves who asserted what; the chain proves the order and completeness.

create or replace function public.ledger_append(
  p_statement_hash text,
  p_statement_ts   text,
  p_signature      text,
  p_public_key     text,
  p_kind           text,
  p_job_id         text,
  p_subject        text,
  p_actor_id       uuid,
  p_payload_hash   text,
  p_payload        jsonb
) returns public.ledger_entries
language plpgsql security definer as $$
declare
  v_seq       bigint;
  v_prev      text;
  v_entry     text;
  v_row       public.ledger_entries;
begin
  -- One writer at a time. The constant is arbitrary but must be stable.
  perform pg_advisory_xact_lock(hashtext('drishti_ledger'));

  select seq, entry_hash into v_seq, v_prev
    from public.ledger_entries order by seq desc limit 1;

  if v_seq is null then
    v_seq := 1;
    v_prev := repeat('0', 64);
  else
    v_seq := v_seq + 1;
  end if;

  -- Length-prefixed field joining, mirrored exactly in lib/ledger/chain.ts.
  -- Plain concatenation would let two different entries collide by shifting a
  -- character across a field boundary.
  v_entry := encode(digest(
    length(v_seq::text)      || ':' || v_seq::text      || '|' ||
    length(v_prev)           || ':' || v_prev           || '|' ||
    length(p_statement_hash) || ':' || p_statement_hash,
    'sha256'), 'hex');

  insert into public.ledger_entries (
    seq, prev_hash, entry_hash, statement_hash, statement_ts, signature, public_key,
    kind, job_id, subject, actor_id, payload_hash, payload
  ) values (
    v_seq, v_prev, v_entry, p_statement_hash, p_statement_ts, p_signature, p_public_key,
    p_kind, p_job_id, p_subject, p_actor_id, p_payload_hash, coalesce(p_payload, '{}'::jsonb)
  ) returning * into v_row;

  return v_row;
end $$;

-- digest() lives in pgcrypto.
create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ RLS ---
-- Readable by any signed-in user, writable through ledger_append only.
--
-- Deliberately not owner-scoped for reads: an audit trail that only its
-- subject can inspect is not an audit trail. It carries no personal data and
-- no content, only digests, so this discloses nothing about the footage.

alter table public.ledger_entries enable row level security;

drop policy if exists ledger_read_all on public.ledger_entries;
create policy ledger_read_all on public.ledger_entries
  for select using (auth.role() = 'authenticated');

-- No insert/update/delete policy: RLS denies by default, so ordinary clients
-- cannot write directly. Appends go through ledger_append (security definer)
-- or the service role, and both still hit the immutability triggers.

revoke update, delete on public.ledger_entries from anon, authenticated;
grant execute on function public.ledger_append to authenticated, service_role;
