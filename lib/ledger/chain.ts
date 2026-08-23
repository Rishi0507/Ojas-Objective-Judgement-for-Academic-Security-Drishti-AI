import crypto from 'crypto'
import { ZERO_HASH, hashDocument, joinFields, sha256 } from './hash'

/**
 * Statement construction, signing, and chain verification.
 *
 * Two independent properties are being established, and keeping them separate
 * is what makes the design work:
 *
 *   Signature  - WHO asserted WHAT. Covers the statement only.
 *   Chain      - the ORDER entries were written in, and that none were
 *                removed. Covers seq + prev_hash + statement hash.
 *
 * They are deliberately not merged. If the signature also covered the chain
 * position, signing would have to happen after the database assigned that
 * position, and the database cannot sign because it must never hold the
 * private key. Splitting them removes the circularity and leaves both
 * properties intact and independently checkable.
 */

export type LedgerKind =
  | 'video_uploaded'
  | 'artifact_derived'
  | 'verdict_recorded'
  /** An incident report was issued. Its own hash goes in the chain it describes. */
  | 'report_generated'
  /** Intermediates discarded; findings and evidence stills kept. */
  | 'media_pruned'
  /** A job's media was removed. The record of it outlives the files. */
  | 'media_deleted'
  | 'anchor_published'

/** The assertion an actor signs. Chain position is deliberately absent. */
export interface Statement {
  kind: LedgerKind
  /** What was acted on: a file path, an offence key. */
  subject: string
  /** Pipeline job this concerns, or null for entries not tied to one. */
  jobId: string | null
  /** auth.users id, or null when the pipeline itself is the actor. */
  actorId: string | null
  /** RFC 3339, second precision. */
  timestamp: string
  /** Digest of the thing being attested (file or document). */
  payloadHash: string
  /** Metadata only - never file content, never personal data. */
  payload: Record<string, unknown>
}

export interface LedgerEntry {
  seq: number
  prevHash: string
  entryHash: string
  statementHash: string
  signature: string | null
  publicKey: string | null
  kind: LedgerKind
  jobId: string | null
  subject: string
  actorId: string | null
  payloadHash: string
  payload: Record<string, unknown>
  /** The timestamp that was signed. Distinct from createdAt: the database
   *  stamps its own insertion time, and hashing that instead would make every
   *  Postgres-written entry fail verification. */
  timestamp: string
  createdAt: string
  anchorRoot?: string | null
  anchorRef?: string | null
}

export function hashStatement(statement: Statement): string {
  return hashDocument(statement as unknown as Record<string, unknown>)
}

/**
 * Entry hash over chain position and statement.
 *
 * Mirrored by ledger_append() in 0002_ledger.sql; the two must agree exactly
 * or every entry written by one will fail verification by the other.
 */
export function computeEntryHash(seq: number, prevHash: string, statementHash: string): string {
  return sha256(joinFields(String(seq), prevHash, statementHash))
}

// ------------------------------------------------------------- signing ---

/**
 * The signing key, from LEDGER_SIGNING_KEY (base64 PKCS#8 Ed25519).
 *
 * Absent by design in local development: unsigned entries still chain, and the
 * tamper-evidence of the chain does not depend on the signature. What is lost
 * without a key is non-repudiation - the ability to show an entry came from
 * this server and not from someone with database access. Generate one with
 * `npx tsx scripts/ledger-keygen.ts`.
 *
 * The key is never written to the repo, never sent to the browser, and never
 * recorded in the ledger. If it leaks, rotate it: past entries stay verifiable
 * under the old public key, which is why public_key is stored per entry rather
 * than looked up globally.
 */
let cachedKey: crypto.KeyObject | null | undefined

function signingKey(): crypto.KeyObject | null {
  if (cachedKey !== undefined) return cachedKey

  const raw = process.env.LEDGER_SIGNING_KEY?.trim()
  if (!raw) {
    console.log(
      '[ledger] LEDGER_SIGNING_KEY not set - entries will chain but stay unsigned. ' +
        'Generate one with: npx tsx scripts/ledger-keygen.ts'
    )
    cachedKey = null
    return null
  }

  try {
    cachedKey = crypto.createPrivateKey({
      key: Buffer.from(raw, 'base64'),
      format: 'der',
      type: 'pkcs8',
    })
    return cachedKey
  } catch (err) {
    // Do not fall through to unsigned: a key that was configured but does not
    // load is a deployment fault, and silently downgrading would leave the
    // operator believing entries are signed when they are not.
    throw new Error(
      `[ledger] LEDGER_SIGNING_KEY is set but could not be parsed as base64 PKCS#8 Ed25519: ${
        (err as Error).message
      }`
    )
  }
}

export function publicKeyB64(): string | null {
  const key = signingKey()
  if (!key) return null
  return crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64')
}

/** Ed25519 over the statement hash. Null when no key is configured. */
export function signStatement(statementHash: string): string | null {
  const key = signingKey()
  if (!key) return null
  // Ed25519 in Node takes null for the digest algorithm - it hashes internally.
  return crypto.sign(null, Buffer.from(statementHash, 'utf8'), key).toString('base64')
}

export function verifySignature(
  statementHash: string,
  signature: string | null,
  publicKey: string | null
): boolean {
  if (!signature || !publicKey) return false
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    })
    return crypto.verify(
      null,
      Buffer.from(statementHash, 'utf8'),
      key,
      Buffer.from(signature, 'base64')
    )
  } catch {
    return false
  }
}

// -------------------------------------------------------- verification ---

export interface VerificationProblem {
  seq: number
  problem: string
  detail: string
}

export interface VerificationResult {
  ok: boolean
  entriesChecked: number
  signedEntries: number
  problems: VerificationProblem[]
  /** Head of the chain, for comparison against an external anchor. */
  headHash: string | null
}

/**
 * Recompute the whole chain from genesis.
 *
 * Every check is reported rather than thrown on, and verification continues
 * past the first failure. A partial answer is worth more than an exception
 * here: "entries 1-400 verify, 401 was altered, 402-900 verify against the
 * altered value" localises tampering, where a thrown error only says the
 * ledger is bad.
 *
 * An unsigned entry is not a failure - signing is optional (see signingKey).
 * A signature that is present and does NOT verify is a failure, since that can
 * only mean the statement changed after it was signed.
 */
export function verifyChain(entries: LedgerEntry[]): VerificationResult {
  const problems: VerificationProblem[] = []
  let signedEntries = 0

  const sorted = [...entries].sort((a, b) => a.seq - b.seq)
  let expectedPrev = ZERO_HASH

  sorted.forEach((entry, i) => {
    const expectedSeq = i + 1
    if (entry.seq !== expectedSeq) {
      problems.push({
        seq: entry.seq,
        problem: 'sequence_gap',
        detail: `expected seq ${expectedSeq}, found ${entry.seq} - an entry is missing or was reordered`,
      })
    }

    if (entry.prevHash !== expectedPrev) {
      problems.push({
        seq: entry.seq,
        problem: 'broken_link',
        detail: `prev_hash ${entry.prevHash.slice(0, 12)}... does not match the previous entry's hash ${expectedPrev.slice(0, 12)}...`,
      })
    }

    // Does the statement still hash to what the entry claims? This is the
    // check that catches edited payloads.
    const recomputedStatement = hashStatement({
      kind: entry.kind,
      subject: entry.subject,
      jobId: entry.jobId,
      actorId: entry.actorId,
      timestamp: entry.timestamp,
      payloadHash: entry.payloadHash,
      payload: entry.payload,
    })
    if (recomputedStatement !== entry.statementHash) {
      problems.push({
        seq: entry.seq,
        problem: 'statement_altered',
        detail: 'the recorded statement no longer hashes to its stored digest',
      })
    }

    const recomputedEntry = computeEntryHash(entry.seq, entry.prevHash, entry.statementHash)
    if (recomputedEntry !== entry.entryHash) {
      problems.push({
        seq: entry.seq,
        problem: 'entry_hash_mismatch',
        detail: 'entry_hash does not match seq + prev_hash + statement_hash',
      })
    }

    if (entry.signature) {
      signedEntries++
      if (!verifySignature(entry.statementHash, entry.signature, entry.publicKey)) {
        problems.push({
          seq: entry.seq,
          problem: 'bad_signature',
          detail: 'signature present but does not verify against the recorded public key',
        })
      }
    }

    expectedPrev = entry.entryHash
  })

  return {
    ok: problems.length === 0,
    entriesChecked: sorted.length,
    signedEntries,
    problems,
    headHash: sorted.length ? sorted[sorted.length - 1].entryHash : null,
  }
}
