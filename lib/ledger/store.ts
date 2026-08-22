import fs from 'fs'
import path from 'path'
import { createServiceClient } from '@/lib/supabase/server'
import { ZERO_HASH } from './hash'
import {
  LedgerEntry,
  Statement,
  computeEntryHash,
  hashStatement,
  publicKeyB64,
  signStatement,
} from './chain'

/**
 * Persistence for the custody ledger.
 *
 * Two backends, same chain. Postgres is authoritative when configured, because
 * its trigger enforces append-only against every role including the one the
 * pipeline writes with. A local JSONL file is the fallback, matching how every
 * other integration here degrades: the app must stay usable before Supabase is
 * set up, which for a hackathon means it must work on a laptop with no network.
 *
 * The local file is honestly weaker and should be described that way - anyone
 * who can edit the file can rewrite the chain, and nothing stops them. It is
 * tamper-EVIDENT (rewriting one line breaks every hash after it, and the
 * verify endpoint will say so) but not tamper-PROOF. Only the anchor in layer
 * 3 makes rewriting detectable by someone who does not trust this server.
 */

const LEDGER_FILE = path.join(process.cwd(), 'pipeline_out', 'ledger.jsonl')

function nowISO(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// ------------------------------------------------------------ local ---

function readLocal(): LedgerEntry[] {
  try {
    return fs
      .readFileSync(LEDGER_FILE, 'utf-8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as LedgerEntry)
  } catch {
    return []
  }
}

/**
 * Append locally.
 *
 * Node runs this route handler on a single thread, and appends are short, so
 * the read-head-then-write race that the Postgres path takes an advisory lock
 * for is far narrower here. It is not zero - two concurrent requests can still
 * interleave across an await - so the head is read synchronously immediately
 * before the synchronous append, with no await between them.
 */
function appendLocal(entry: Omit<LedgerEntry, 'seq' | 'prevHash' | 'entryHash'>): LedgerEntry {
  const existing = readLocal()
  const last = existing[existing.length - 1]
  const seq = last ? last.seq + 1 : 1
  const prevHash = last ? last.entryHash : ZERO_HASH
  const entryHash = computeEntryHash(seq, prevHash, entry.statementHash)

  const full: LedgerEntry = { ...entry, seq, prevHash, entryHash }
  fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true })
  fs.appendFileSync(LEDGER_FILE, JSON.stringify(full) + '\n', 'utf-8')
  return full
}

// --------------------------------------------------------- public API ---

export interface AppendInput {
  kind: Statement['kind']
  subject: string
  jobId?: string | null
  actorId?: string | null
  payloadHash: string
  payload?: Record<string, unknown>
}

/**
 * Record one act in the custody chain.
 *
 * Best-effort by deliberate choice, consistent with the rest of the pipeline:
 * a ledger write that fails must not fail the upload or lose an analysis that
 * already succeeded. The cost of that choice is a gap in the record, so a
 * failure is logged loudly rather than swallowed - a silent gap in an audit
 * trail is far worse than a noisy one, because nobody goes looking for it.
 */
export async function appendEntry(input: AppendInput): Promise<LedgerEntry | null> {
  try {
    const statement: Statement = {
      kind: input.kind,
      subject: input.subject,
      jobId: input.jobId ?? null,
      actorId: input.actorId ?? null,
      timestamp: nowISO(),
      payloadHash: input.payloadHash,
      payload: input.payload ?? {},
    }

    const statementHash = hashStatement(statement)
    const signature = signStatement(statementHash)
    const publicKey = publicKeyB64()

    const supabase = createServiceClient()
    if (supabase) {
      const { data, error } = await supabase.rpc('ledger_append', {
        p_statement_hash: statementHash,
        p_statement_ts: statement.timestamp,
        p_signature: signature,
        p_public_key: publicKey,
        p_kind: statement.kind,
        p_job_id: statement.jobId,
        p_subject: statement.subject,
        p_actor_id: statement.actorId,
        p_payload_hash: statement.payloadHash,
        p_payload: statement.payload,
      })

      if (!error && data) {
        const row = Array.isArray(data) ? data[0] : data
        return rowToEntry(row)
      }
      console.error(
        `[ledger] Postgres append failed for ${input.kind}/${input.subject}, ` +
          `falling back to local file: ${error?.message ?? 'no row returned'}`
      )
    }

    return appendLocal({
      statementHash,
      signature,
      publicKey,
      kind: statement.kind,
      jobId: statement.jobId,
      subject: statement.subject,
      actorId: statement.actorId,
      payloadHash: statement.payloadHash,
      payload: statement.payload,
      timestamp: statement.timestamp,
      createdAt: statement.timestamp,
    })
  } catch (err) {
    console.error(
      `[ledger] FAILED to record ${input.kind} for ${input.subject} - ` +
        `the custody chain now has a gap: ${(err as Error).message}`
    )
    return null
  }
}

/** Whole chain, oldest first. */
export async function readChain(jobId?: string): Promise<LedgerEntry[]> {
  const supabase = createServiceClient()
  if (supabase) {
    // Chain verification recomputes links from genesis, so it always needs the
    // full log; jobId filters the presentation, never the verification input.
    const { data, error } = await supabase
      .from('ledger_entries')
      .select('*')
      .order('seq', { ascending: true })
    if (!error && data) return data.map(rowToEntry)
    console.error(`[ledger] could not read chain from Postgres: ${error?.message}`)
  }

  const local = readLocal()
  return jobId ? local.filter((e) => e.jobId === jobId) : local
}

function rowToEntry(row: any): LedgerEntry {
  return {
    seq: Number(row.seq),
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
    statementHash: row.statement_hash,
    signature: row.signature,
    publicKey: row.public_key,
    kind: row.kind,
    jobId: row.job_id,
    subject: row.subject,
    actorId: row.actor_id,
    payloadHash: row.payload_hash,
    payload: row.payload ?? {},
    // Verbatim, never reformatted: this string is an input to the hash.
    timestamp: row.statement_ts,
    createdAt: String(row.created_at),
  }
}
