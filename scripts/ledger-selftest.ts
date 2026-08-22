/**
 * Self-test for the custody ledger.
 *
 *   npx tsx scripts/ledger-selftest.ts
 *
 * Exercises the properties the ledger is supposed to have, including the ones
 * that only matter when something has gone wrong. A hash chain that has never
 * been shown to reject a forged entry has not been tested at all - it will
 * happily verify everything, including tampering, and nobody finds out until
 * the one moment the evidence matters.
 */

import { canonicalJSON, hashDocument, sha256, ZERO_HASH } from '../lib/ledger/hash'
import {
  LedgerEntry,
  Statement,
  computeEntryHash,
  hashStatement,
  verifyChain,
} from '../lib/ledger/chain'
import { merkleProof, merkleRoot, verifyMerkleProof } from '../lib/ledger/merkle'
import crypto from 'crypto'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`)
  }
}

// ------------------------------------------------- canonical serialisation ---
console.log('\ncanonical JSON')

check(
  'key order does not change the digest',
  hashDocument({ a: 1, b: 2 }) === hashDocument({ b: 2, a: 1 })
)
check(
  'nested key order does not change the digest',
  hashDocument({ x: { p: 1, q: 2 } }) === hashDocument({ x: { q: 2, p: 1 } })
)
check(
  'array order DOES change the digest',
  hashDocument({ a: [1, 2] }) !== hashDocument({ a: [2, 1] })
)
check('unicode survives round-trip', canonicalJSON({ s: 'café ☕' }).includes('caf'))

for (const [label, bad] of [
  ['NaN', { a: NaN }],
  ['Infinity', { a: Infinity }],
  ['undefined', { a: undefined }],
] as [string, any][]) {
  let threw = false
  try {
    canonicalJSON(bad)
  } catch {
    threw = true
  }
  check(`${label} is rejected rather than silently coerced`, threw)
}

// -------------------------------------------------------------- the chain ---
console.log('\nchain construction and verification')

const { privateKey } = crypto.generateKeyPairSync('ed25519')
const pubB64 = crypto
  .createPublicKey(privateKey)
  .export({ format: 'der', type: 'spki' })
  .toString('base64')

function makeEntry(seq: number, prevHash: string, subject: string, sign: boolean): LedgerEntry {
  const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const statement: Statement = {
    kind: 'artifact_derived',
    subject,
    jobId: 'job-1',
    actorId: null,
    timestamp,
    payloadHash: sha256(subject),
    payload: { artifact: 'test' },
  }
  const statementHash = hashStatement(statement)
  return {
    seq,
    prevHash,
    entryHash: computeEntryHash(seq, prevHash, statementHash),
    statementHash,
    signature: sign
      ? crypto.sign(null, Buffer.from(statementHash, 'utf8'), privateKey).toString('base64')
      : null,
    publicKey: sign ? pubB64 : null,
    kind: statement.kind,
    jobId: statement.jobId,
    subject: statement.subject,
    actorId: statement.actorId,
    payloadHash: statement.payloadHash,
    payload: statement.payload,
    timestamp,
    createdAt: timestamp,
  }
}

function buildChain(n: number, sign = true): LedgerEntry[] {
  const entries: LedgerEntry[] = []
  let prev = ZERO_HASH
  for (let i = 1; i <= n; i++) {
    const e = makeEntry(i, prev, `artifact-${i}.json`, sign)
    entries.push(e)
    prev = e.entryHash
  }
  return entries
}

const good = buildChain(6)
const goodResult = verifyChain(good)
check('an untampered chain verifies', goodResult.ok, JSON.stringify(goodResult.problems))
check('all signatures verify', goodResult.signedEntries === 6)

check('an unsigned chain still verifies', verifyChain(buildChain(4, false)).ok)
check('an empty chain verifies vacuously', verifyChain([]).ok)

// The cases that matter: each one is a way someone could try to rewrite history.
console.log('\ntamper detection')

const editedPayload = buildChain(6)
editedPayload[2].payload = { artifact: 'test', tampered: true }
const r1 = verifyChain(editedPayload)
check(
  'editing a payload is caught',
  !r1.ok && r1.problems.some((p) => p.problem === 'statement_altered' && p.seq === 3),
  JSON.stringify(r1.problems)
)

const deleted = buildChain(6)
deleted.splice(2, 1)
const r2 = verifyChain(deleted)
check('deleting an entry is caught', !r2.ok && r2.problems.some((p) => p.problem === 'broken_link'))

// Shuffling the array is deliberately NOT tampering: seq defines the order, so
// verifyChain sorts before checking and transport order carries no meaning.
const shuffled = buildChain(6)
;[shuffled[2], shuffled[3]] = [shuffled[3], shuffled[2]]
check('array order alone is not treated as tampering', verifyChain(shuffled).ok)

// Swapping the sequence numbers themselves is a real attack - it claims two
// events happened in the opposite order - and entry_hash commits to seq.
const swappedSeq = buildChain(6)
const tmp = swappedSeq[2].seq
swappedSeq[2].seq = swappedSeq[3].seq
swappedSeq[3].seq = tmp
const rSeq = verifyChain(swappedSeq)
check(
  'swapping sequence numbers is caught',
  !rSeq.ok && rSeq.problems.some((p) => p.problem === 'entry_hash_mismatch'),
  JSON.stringify(rSeq.problems)
)

// The most realistic attack: someone edits an entry AND recomputes its hashes
// to match, hoping the chain re-links. It cannot, because every later entry
// commits to the old hash.
const recomputed = buildChain(6)
const victim = recomputed[2]
victim.payload = { artifact: 'test', tampered: true }
victim.statementHash = hashStatement({
  kind: victim.kind,
  subject: victim.subject,
  jobId: victim.jobId,
  actorId: victim.actorId,
  timestamp: victim.timestamp,
  payloadHash: victim.payloadHash,
  payload: victim.payload,
})
victim.entryHash = computeEntryHash(victim.seq, victim.prevHash, victim.statementHash)
const r3 = verifyChain(recomputed)
check(
  'editing an entry and recomputing its own hashes still breaks the chain',
  !r3.ok && r3.problems.some((p) => p.problem === 'broken_link' && p.seq === 4),
  JSON.stringify(r3.problems)
)

const forgedSig = buildChain(6)
forgedSig[1].payload = { artifact: 'swapped' }
forgedSig[1].statementHash = hashStatement({
  kind: forgedSig[1].kind,
  subject: forgedSig[1].subject,
  jobId: forgedSig[1].jobId,
  actorId: forgedSig[1].actorId,
  timestamp: forgedSig[1].timestamp,
  payloadHash: forgedSig[1].payloadHash,
  payload: forgedSig[1].payload,
})
const r4 = verifyChain(forgedSig)
check(
  'a signature that no longer matches its statement is caught',
  r4.problems.some((p) => p.problem === 'bad_signature')
)

// ------------------------------------------------------------- merkle ---
console.log('\nmerkle tree')

for (const n of [1, 2, 3, 5, 8, 17]) {
  const leaves = Array.from({ length: n }, (_, i) => sha256(`leaf-${i}`))
  const root = merkleRoot(leaves)!
  const allValid = leaves.every((leaf, i) =>
    verifyMerkleProof(leaf, merkleProof(leaves, i), root)
  )
  check(`every inclusion proof verifies (n=${n})`, allValid)
}

const leaves = Array.from({ length: 8 }, (_, i) => sha256(`leaf-${i}`))
const root = merkleRoot(leaves)!
check(
  'a proof for data not in the tree is rejected',
  !verifyMerkleProof(sha256('not-in-tree'), merkleProof(leaves, 0), root)
)
check('an empty tree has no root', merkleRoot([]) === null)
check(
  'different leaf counts give different roots',
  merkleRoot(leaves.slice(0, 4)) !== merkleRoot(leaves.slice(0, 5))
)

// Second-preimage: an internal node must not be presentable as a leaf.
const twoLeaves = [sha256('a'), sha256('b')]
const twoRoot = merkleRoot(twoLeaves)!
check(
  'domain separation blocks passing an internal node off as a leaf',
  merkleRoot([twoRoot]) !== twoRoot
)

// ------------------------------------------------------------------ done ---
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
