import { sha256 } from './hash'

/**
 * Merkle tree over ledger entries.
 *
 * Not needed for the chain itself - the prev_hash links already make the log
 * tamper-evident. This exists for two things the chain cannot do:
 *
 *   1. Anchoring cost. Publishing one root per batch is a single external
 *      operation regardless of whether the batch holds ten entries or ten
 *      thousand. Anchoring per entry would not scale past a demo.
 *
 *   2. Selective disclosure. A Merkle proof shows that ONE entry is part of an
 *      anchored batch without revealing the others. For exam footage that is
 *      the difference between proving one candidate's evidence is intact and
 *      handing over a list of every candidate recorded that day.
 *
 * Domain separation: leaves are hashed with a 0x00 prefix and internal nodes
 * with 0x01. Without it, an attacker can present an internal node as though it
 * were a leaf and forge a proof for data that was never in the tree - the
 * classic second-preimage attack on Merkle trees.
 */

const LEAF_PREFIX = '00'
const NODE_PREFIX = '01'

export function hashLeaf(data: string): string {
  return sha256(LEAF_PREFIX + data)
}

function hashNode(left: string, right: string): string {
  return sha256(NODE_PREFIX + left + right)
}

/**
 * Merkle root of the given leaves.
 *
 * An odd node at any level is promoted rather than duplicated. Duplicating it
 * (the Bitcoin approach) makes trees of different leaf counts collide, so two
 * different batches can share a root - fine there because block structure
 * rules it out, not fine here where batch size is arbitrary.
 */
export function merkleRoot(leaves: string[]): string | null {
  if (leaves.length === 0) return null
  let level = leaves.map(hashLeaf)

  while (level.length > 1) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(hashNode(level[i], level[i + 1]))
      } else {
        next.push(level[i]) // promote, do not duplicate
      }
    }
    level = next
  }
  return level[0]
}

export interface MerkleProofStep {
  hash: string
  side: 'left' | 'right'
}

/** Proof that the leaf at `index` belongs to the tree over `leaves`. */
export function merkleProof(leaves: string[], index: number): MerkleProofStep[] {
  if (index < 0 || index >= leaves.length) {
    throw new RangeError(`merkleProof: index ${index} outside 0..${leaves.length - 1}`)
  }

  const proof: MerkleProofStep[] = []
  let level = leaves.map(hashLeaf)
  let idx = index

  while (level.length > 1) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        if (i === idx) proof.push({ hash: level[i + 1], side: 'right' })
        else if (i + 1 === idx) proof.push({ hash: level[i], side: 'left' })
        next.push(hashNode(level[i], level[i + 1]))
      } else {
        next.push(level[i]) // promoted: no sibling, so no proof step
      }
    }
    idx = Math.floor(idx / 2)
    level = next
  }
  return proof
}

/** Recompute a root from a leaf and its proof. */
export function verifyMerkleProof(
  leafData: string,
  proof: MerkleProofStep[],
  expectedRoot: string
): boolean {
  let hash = hashLeaf(leafData)
  for (const step of proof) {
    hash = step.side === 'right' ? hashNode(hash, step.hash) : hashNode(step.hash, hash)
  }
  return hash === expectedRoot
}
