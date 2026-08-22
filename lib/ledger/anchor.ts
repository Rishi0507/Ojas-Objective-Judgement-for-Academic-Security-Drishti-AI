import { LedgerEntry } from './chain'
import { merkleProof, merkleRoot, verifyMerkleProof, MerkleProofStep } from './merkle'

/**
 * Layer 3 seam - external anchoring. Not enabled.
 *
 * Layers 1 and 2 (hashing and the hash-linked signed log) make the ledger
 * tamper-EVIDENT: alter anything and every subsequent hash stops matching, and
 * /api/ledger/verify will say exactly where. What they cannot do is stop
 * whoever controls this database from rebuilding the entire chain from genesis
 * with different contents. Nothing self-contained can, because every input to
 * the recomputation is under that person's control.
 *
 * Anchoring fixes precisely that and nothing else: publish a Merkle root of
 * each batch somewhere the operator cannot rewrite, and a silently rebuilt
 * chain no longer matches what was published. That is the entire contribution
 * of a blockchain to this design - one external, hard-to-collude timestamp.
 *
 * The interface is here so adding it later is an implementation, not a
 * refactor. Two options, both compatible with this shape:
 *
 *   OpenTimestamps - free, no wallet, no gas, anchors into Bitcoin. Proves
 *     "this root existed before time T". The cleanest answer if the goal is
 *     evidentiary weight rather than a demo surface.
 *
 *   EVM L2 (Base / Polygon) - a small contract storing (root, timestamp).
 *     Go talks to it well via go-ethereum's abigen. Costs gas and needs key
 *     management, but gives a block explorer link to point at.
 *
 * Whichever is chosen, the rule is unchanged: only the root is published.
 * Never an entry, never a payload, never a filename.
 */

export interface AnchorReceipt {
  /** Merkle root that was published. */
  root: string
  /** Where to find the proof: an OTS receipt path, or a chain txid. */
  ref: string
  /** Which backend produced it, for the verifier's benefit. */
  backend: string
  publishedAt: string
}

export interface Anchor {
  readonly name: string
  readonly enabled: boolean
  publish(root: string): Promise<AnchorReceipt | null>
}

/**
 * The no-op anchor, deliberately honest about what it is.
 *
 * It reports enabled=false rather than pretending to publish, so the verify
 * endpoint can tell the difference between "anchored and intact" and "not
 * anchored at all". Silently returning a fake receipt would be the worst
 * possible failure here: an audit trail that claims a guarantee it does not
 * have is more dangerous than one that claims nothing.
 */
export class NoopAnchor implements Anchor {
  readonly name = 'none'
  readonly enabled = false
  async publish(): Promise<AnchorReceipt | null> {
    return null
  }
}

let active: Anchor = new NoopAnchor()

export function activeAnchor(): Anchor {
  return active
}

/** Swap in a real backend once layer 3 is implemented. */
export function setAnchor(anchor: Anchor): void {
  active = anchor
}

// ------------------------------------------------------------- batching ---

/**
 * The leaf value for an entry.
 *
 * entry_hash already commits to seq, prev_hash and the statement, so it is a
 * complete summary of the entry; nothing further needs to go into the leaf.
 */
export function leafFor(entry: LedgerEntry): string {
  return entry.entryHash
}

export interface Batch {
  root: string
  entries: LedgerEntry[]
  fromSeq: number
  toSeq: number
}

/** Merkle root over a run of entries, ready to be published. */
export function buildBatch(entries: LedgerEntry[]): Batch | null {
  if (entries.length === 0) return null
  const sorted = [...entries].sort((a, b) => a.seq - b.seq)
  const root = merkleRoot(sorted.map(leafFor))
  if (!root) return null
  return {
    root,
    entries: sorted,
    fromSeq: sorted[0].seq,
    toSeq: sorted[sorted.length - 1].seq,
  }
}

/**
 * Inclusion proof for one entry within its batch.
 *
 * This is the selective-disclosure path: it lets one candidate's evidence be
 * proven intact without disclosing that any other candidate was recorded.
 */
export function proofForEntry(
  batch: Batch,
  seq: number
): { leaf: string; proof: MerkleProofStep[]; root: string } | null {
  const index = batch.entries.findIndex((e) => e.seq === seq)
  if (index === -1) return null
  const leaves = batch.entries.map(leafFor)
  return {
    leaf: leaves[index],
    proof: merkleProof(leaves, index),
    root: batch.root,
  }
}

export { verifyMerkleProof }
