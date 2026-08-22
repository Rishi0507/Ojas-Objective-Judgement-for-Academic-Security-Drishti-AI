import { NextRequest, NextResponse } from 'next/server'
import { verifyChain } from '@/lib/ledger/chain'
import { readChain } from '@/lib/ledger/store'
import { activeAnchor, buildBatch } from '@/lib/ledger/anchor'

/**
 * Verify the custody chain and report what it does and does not prove.
 *
 *   GET /api/ledger/verify            whole chain
 *   GET /api/ledger/verify?job=<id>   same verification, one job's entries listed
 *
 * Verification always runs over the complete chain even when the response is
 * filtered. Checking a subset would pass happily while entries either side of
 * it had been removed, which is exactly the tampering this is meant to catch.
 *
 * Open to anyone who can reach it, by design: a tamper check that only its
 * subject can run is not much of a check. The response carries digests and
 * event kinds, never footage, filenames of people, or personal data.
 */
export async function GET(request: NextRequest) {
  try {
    const jobId = request.nextUrl.searchParams.get('job')

    const chain = await readChain()
    const result = verifyChain(chain)
    const anchor = activeAnchor()
    const batch = buildBatch(chain)

    const scoped = jobId ? chain.filter((e) => e.jobId === jobId) : chain

    return NextResponse.json({
      ok: result.ok,
      summary: result.ok
        ? `${result.entriesChecked} entries verify from genesis; nothing has been altered or removed.`
        : `${result.problems.length} problem(s) found across ${result.entriesChecked} entries.`,

      entriesChecked: result.entriesChecked,
      signedEntries: result.signedEntries,
      headHash: result.headHash,
      merkleRoot: batch?.root ?? null,
      problems: result.problems,

      // Stated plainly rather than implied. Someone reading this response is
      // deciding how much weight to put on it, and the honest answer is that
      // an unanchored chain is only as trustworthy as whoever runs the server.
      guarantees: {
        integrity: 'Each entry commits to the hash of the one before it, so any edit or deletion breaks every hash after it.',
        attribution: result.signedEntries > 0
          ? `${result.signedEntries} of ${result.entriesChecked} entries carry an Ed25519 signature verifying which server recorded them.`
          : 'No entries are signed (LEDGER_SIGNING_KEY is unset), so the chain shows what happened but not who recorded it.',
        anchored: anchor.enabled,
        limitation: anchor.enabled
          ? null
          : 'Not externally anchored: whoever controls this database could rebuild the whole chain from genesis and it would still verify. Publishing the Merkle root above to an external anchor is what closes that gap.',
        notProvenance: 'This proves the footage has not changed since it reached the server. It cannot prove the footage is authentic - video edited before upload would be recorded faithfully.',
      },

      entries: scoped.map((e) => ({
        seq: e.seq,
        kind: e.kind,
        subject: e.subject,
        jobId: e.jobId,
        timestamp: e.timestamp,
        payloadHash: e.payloadHash,
        entryHash: e.entryHash,
        signed: !!e.signature,
        payload: e.payload,
      })),
    })
  } catch (error: any) {
    console.error('Ledger verification failed:', error)
    return NextResponse.json(
      { error: error?.message ?? 'Verification failed' },
      { status: 500 }
    )
  }
}
