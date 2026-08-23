import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
import { getCurrentPipelineDir } from '@/lib/currentVideo'
import { verifyChain } from '@/lib/ledger/chain'
import { readChain, appendEntry } from '@/lib/ledger/store'
import { hashDocument, sha256File } from '@/lib/ledger/hash'
import { buildBatch } from '@/lib/ledger/anchor'

/**
 * Assembled incident report, for n8n (or anything else) to render.
 *
 *   GET  /api/report?job=<id>[&embed=1]   preview, no side effects
 *   POST /api/report?job=<id>[&embed=1]   same payload, and records the report
 *                                         in the custody ledger
 *
 * Why one endpoint rather than letting the workflow join three
 * -----------------------------------------------------------
 * Findings, reviewer verdicts and the custody chain live in three different
 * places, and joining them correctly requires knowing that a verdict is keyed
 * by trackId|type|frameIdx and that a suppressed finding is filtered rather
 * than deleted. Pushing that into an n8n expression means the join silently
 * drifts the first time either side changes. It belongs here, next to the code
 * that defines those shapes.
 *
 * What this deliberately includes
 * -------------------------------
 * Dismissed findings and CLIP-suppressed findings, not just confirmed ones. A
 * document that may be used to accuse a student of malpractice is weaker, not
 * stronger, for hiding what the reviewer threw out and what a model filtered
 * before anyone saw it: the ratio of confirmed to rejected is what tells a
 * reader how much weight the confirmed ones carry. The same applies to the
 * limitations block, which states what the ledger cannot establish.
 *
 * What it deliberately omits
 * --------------------------
 * Any identity. Subjects are anonymous per-video track IDs and there is no
 * mapping to a person anywhere in this system; the report must not become the
 * place one gets invented. Also no accuracy figures - there is no evaluation
 * set, so any number would be fabricated.
 */

const ROOT = process.cwd()

/** Matches offenceKey() in EventsList - verdicts are stored under this. */
function offenceKey(o: any): string {
  return `${o.trackId ?? 'none'}|${o.type}|${o.frameIdx}`
}

/**
 * What each detector actually measures, and where it fails.
 *
 * Kept beside the report rather than in the UI so the document carries its own
 * method section: a reader with a PDF and no access to this app still needs to
 * know that "head turn" is a deviation from the person's own baseline and not
 * a measured angle.
 */
const METHOD_NOTES: Record<string, { measures: string; fails: string }> = {
  prohibited_object: {
    measures:
      'YOLO detection of a phone or paper/chit above a 0.35 confidence floor, inside or overlapping a tracked person. Overlay artefacts near the frame edges are rejected.',
    fails:
      'Small or partly occluded objects are missed. Rectangular desk items can be read as paper. There is no minimum hold time, so a single confident frame flags it.',
  },
  head_turn: {
    measures:
      'Head yaw estimated from nose/eye/ear keypoint offsets, compared against this person’s own median yaw across the video. Flagged past 0.35 deviation on a -1 to 1 scale.',
    fails:
      'Not a measured angle. Leaning down over one’s own desk reads as a turn. This is the least reliable detector in the system and the one most often rejected on review.',
  },
  hand_gesture: {
    measures: 'A wrist keypoint rising above the shoulder line.',
    fails:
      'Cannot distinguish signalling from stretching, or from a hand resting against the head.',
  },
  object_exchange: {
    measures:
      'Wrist keypoints of two tracked people coming within reaching distance, scaled by torso length so pixel distance is not confused with real distance.',
    fails: 'Proximity is not transfer. Two people working side by side can trigger it.',
  },
  loitering: {
    measures: 'A tracked person remaining in one area beyond a duration threshold.',
    fails: 'An invigilator supervising normally is indistinguishable from a candidate loitering.',
  },
  crowd_disturbance: {
    measures: 'Several tracked people moving beyond a normalised motion threshold within a window.',
    fails: 'Synchronised normal movement (a session starting or ending) can trigger it.',
  },
}

function readJSON(p: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

async function buildReport(jobId: string, embed: boolean) {
  const jobDir = path.join(ROOT, 'pipeline_out', jobId)
  const analysis = readJSON(path.join(jobDir, 'api_response.json'))
  if (!analysis) {
    return { error: `No analysis found for job "${jobId}"` }
  }

  const verdicts: Record<string, string> = readJSON(path.join(jobDir, 'review.json')) ?? {}

  // Custody chain. Verified over the whole log, never a per-job subset: a
  // subset verifies happily while entries either side of it are removed.
  const chain = await readChain()
  const verification = verifyChain(chain)
  const batch = buildBatch(chain)
  const jobEntries = chain.filter((e) => e.jobId === jobId)
  const uploadEntry = jobEntries.find((e) => e.kind === 'video_uploaded')

  // Hash of every artifact this job produced, so a citation in the report can
  // be checked against the file on disk.
  const artifactHashes: Record<string, string> = {}
  for (const e of jobEntries) {
    if (e.kind === 'artifact_derived') artifactHashes[e.subject] = e.payloadHash
  }

  const findings: any[] = []
  for (const event of analysis.events ?? []) {
    for (const off of event.offences ?? []) {
      const key = offenceKey(off)
      const verdict = verdicts[key] ?? null

      let evidence: any = null
      if (off.snapshot) {
        const abs = path.join(ROOT, off.snapshot.replace(/^\//, ''))
        const exists = fs.existsSync(abs)
        evidence = {
          url: `/api/snapshot?path=${encodeURIComponent(off.snapshot)}`,
          path: off.snapshot,
          sha256: exists ? await sha256File(abs) : null,
          // Opt-in: 21 stills at ~85KB each is ~2.4MB of base64, which is fine
          // for a self-contained document and wasteful for a preview.
          //
          // The key is omitted rather than set to undefined. canonicalJSON
          // rejects undefined outright, because it is dropped inside objects
          // but becomes null inside arrays - so the same report would hash two
          // different ways depending on where the field sat.
          ...(embed && exists ? { base64: fs.readFileSync(abs).toString('base64') } : {}),
        }
      }

      findings.push({
        key,
        type: off.type,
        label: off.label,
        // Anonymous per-video identifier. Not a person, and not resolvable to
        // one anywhere in this system.
        subject: off.trackId ?? null,
        startSec: off.startSec,
        endSec: off.endSec,
        durationSec: off.durationSec ?? null,
        frameIdx: off.frameIdx,
        detectorConfidence: off.confidence,
        boundingBox: off.bbox ?? null,
        segment: { id: event.id, startSec: event.start, endSec: event.end },
        evidence,
        regionContext: off.region
          ? {
              region: off.region,
              z: off.regionZ ?? 0,
              // Sigma is floored at 1e-3 upstream, so a near-static region
              // divides any motion into a very large number. Past 10 the
              // magnitude is an artefact, not a measurement.
              interpretation:
                (off.regionZ ?? 0) === 0
                  ? 'This part of the frame was within its normal range for this video when the finding fired.'
                  : Math.abs(off.regionZ) >= 10
                  ? 'This part of the frame was far outside its normal range. The exact multiple is not meaningful: the region was near-static during calibration.'
                  : `This part of the frame departed from its own baseline by ${Number(off.regionZ).toFixed(1)} standard deviations.`,
            }
          : null,
        clipVerification: off.clip
          ? {
              verdict: off.clip.verdict,
              readAs: off.clip.topLabel ?? null,
              score: off.clip.topScore ?? null,
              note: 'Zero-shot image/caption matching, advisory. Scores are sensitive to caption wording and are not a measure of accuracy.',
            }
          : null,
        conditions: event.uncertaintyReasons ?? null,
        groundedExplanations: (event.explanations ?? []).filter(
          (x: any) => Math.abs(x.timestamp - off.startSec) < 4
        ),
        autoFiltered: !!off.suppressed,
        autoFilteredReason: off.suppressedReason ?? null,
        review: {
          verdict, // 'confirmed' | 'dismissed' | null (not yet reviewed)
          reviewed: verdict !== null,
        },
      })
    }
  }

  const confirmed = findings.filter((f) => f.review.verdict === 'confirmed')
  const dismissed = findings.filter((f) => f.review.verdict === 'dismissed')
  const autoFiltered = findings.filter((f) => f.autoFiltered)
  const unreviewed = findings.filter((f) => !f.review.reviewed && !f.autoFiltered)

  return {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),

    provenance: {
      jobId,
      videoId: analysis.video_id ?? null,
      sourceFilename: (uploadEntry?.payload as any)?.filename ?? null,
      // The hash of the file as uploaded, taken before any transcoding - this
      // is what a later copy would be compared against.
      sourceSha256: uploadEntry?.payloadHash ?? null,
      uploadRecordedAt: uploadEntry?.timestamp ?? null,
      metadata: analysis.metadata ?? null,
      qualityMetrics: analysis.quality_metrics ?? null,
    },

    summary: {
      segmentsAnalysed: analysis.event_count ?? 0,
      findingsTotal: findings.length,
      autoFilteredByClip: autoFiltered.length,
      presentedForReview: findings.length - autoFiltered.length,
      confirmed: confirmed.length,
      dismissed: dismissed.length,
      awaitingReview: unreviewed.length,
      // Stated rather than left to be inferred: a reader needs to know whether
      // the confirmed set is the product of a completed review or a partial one.
      reviewComplete: unreviewed.length === 0 && findings.length > 0,
    },

    confirmed,
    dismissed,
    awaitingReview: unreviewed,
    autoFiltered,

    // Precision, and an explicit statement of what cannot be computed.
    //
    // Reviewer verdicts ARE the labels: a confirmed finding is a true positive
    // and a dismissed one a false positive, so precision falls out of the
    // review with no extra annotation. Recall does not - it needs every real
    // offence in the footage marked by hand, including the ones the system
    // never surfaced, and nothing in this pipeline can supply that.
    //
    // Accuracy is deliberately absent rather than merely unavailable. Almost
    // no frame contains an offence, so a detector that flagged nothing would
    // score above 99%; quoting it would be technically true and actively
    // misleading.
    evaluation: (() => {
      const judged = confirmed.length + dismissed.length
      return {
        precision:
          judged > 0 ? Math.round((confirmed.length / judged) * 1000) / 1000 : null,
        truePositives: confirmed.length,
        falsePositives: dismissed.length,
        judged,
        basis:
          judged > 0
            ? `Precision over the ${judged} finding(s) a reviewer has ruled on. Not a model accuracy figure: it describes this footage and this reviewer.`
            : 'No findings have been reviewed yet, so no precision figure can be given.',
        recall:
          'Not computed. Recall requires every genuine offence in the footage to be annotated by hand, including any this system failed to surface. No such labelled set exists for this video.',
        accuracy:
          'Deliberately not reported. Offences occupy a tiny fraction of frames, so an accuracy figure would exceed 99% for a detector that found nothing, and would mislead rather than inform.',
      }
    })(),

    integrity: {
      chainVerified: verification.ok,
      summary: verification.ok
        ? `${verification.entriesChecked} entries verify from genesis; nothing has been altered or removed.`
        : `${verification.problems.length} problem(s) found across ${verification.entriesChecked} entries.`,
      entriesInChain: verification.entriesChecked,
      entriesForThisJob: jobEntries.length,
      signedEntries: verification.signedEntries,
      headHash: verification.headHash,
      merkleRoot: batch?.root ?? null,
      problems: verification.problems,
      artifactHashes,
      limitations: [
        'Proves nothing has been altered since it reached this server. It cannot establish that the footage is authentic - video edited or synthesised before upload would be recorded faithfully.',
        'Not externally anchored: whoever controls this database could rebuild the entire chain from genesis and it would still verify. Publishing the Merkle root above to an external anchor is what closes that gap.',
        verification.signedEntries < verification.entriesChecked
          ? `${verification.entriesChecked - verification.signedEntries} of ${verification.entriesChecked} entries are unsigned, so those show what happened but not which server recorded them.`
          : null,
      ].filter(Boolean),
    },

    method: {
      detectors: METHOD_NOTES,
      statement:
        'Findings are produced by geometric and pose heuristics, then optionally re-checked by a zero-shot image/caption model. They are prompts for human review, not determinations of misconduct. Every finding in this report was accepted or rejected by a named reviewer, and the rejections are included.',
      privacy:
        'No facial recognition and no identity mapping is performed. Subjects are anonymous track identifiers scoped to a single video and are not resolvable to a person.',
      accuracy:
        'No accuracy or detection-rate figure is quoted because no labelled evaluation set exists for this footage. Any such figure would be unsupported.',
    },

    custodyLog: jobEntries.map((e) => ({
      seq: e.seq,
      kind: e.kind,
      subject: e.subject,
      recordedAt: e.timestamp,
      contentHash: e.payloadHash,
      entryHash: e.entryHash,
      signed: !!e.signature,
    })),
  }
}

export async function GET(request: NextRequest) {
  try {
    const jobId = request.nextUrl.searchParams.get('job') || getCurrentPipelineDir()
    const embed = request.nextUrl.searchParams.get('embed') === '1'
    const report = await buildReport(jobId, embed)
    if ((report as any).error) {
      return NextResponse.json(report, { status: 404 })
    }
    return NextResponse.json(report)
  } catch (error: any) {
    console.error('Report generation failed:', error)
    return NextResponse.json({ error: error?.message ?? 'Report failed' }, { status: 500 })
  }
}

/**
 * Same payload, plus a ledger entry recording that this report was issued.
 *
 * The report becomes part of the chain it describes: its hash is appended, so
 * a copy circulating later can be checked against the ledger and shown to be
 * the document that was actually issued rather than an edited version of it.
 *
 * GET stays side-effect free so previewing a report - which n8n will do while
 * a workflow is being built - does not fill the custody chain with noise.
 */
export async function POST(request: NextRequest) {
  try {
    const jobId = request.nextUrl.searchParams.get('job') || getCurrentPipelineDir()
    const embed = request.nextUrl.searchParams.get('embed') === '1'
    const report = await buildReport(jobId, embed)
    if ((report as any).error) {
      return NextResponse.json(report, { status: 404 })
    }

    // The hash covers the whole document as issued.
    //
    // It is deliberately NOT stable across re-issues, and cannot be: the
    // report states the ledger's head hash and custody log, and recording the
    // report appends to that ledger. Each issue is therefore its own artifact
    // with its own digest, which is the right model for an incident report -
    // two documents issued at different times describe different states and
    // should not be conflated by sharing a hash.
    //
    // A verifier recomputes over the document with the `issued` block removed,
    // since that block carries the hash itself.
    const reportHash = hashDocument(report as any)

    const entry = await appendEntry({
      kind: 'report_generated',
      subject: `report/${jobId}`,
      jobId,
      payloadHash: reportHash,
      payload: {
        reportVersion: (report as any).reportVersion,
        confirmed: (report as any).summary.confirmed,
        dismissed: (report as any).summary.dismissed,
        autoFiltered: (report as any).summary.autoFilteredByClip,
        chainVerified: (report as any).integrity.chainVerified,
      },
    })

    return NextResponse.json({
      ...report,
      issued: {
        reportHash,
        ledgerSeq: entry?.seq ?? null,
        ledgerEntryHash: entry?.entryHash ?? null,
        note: entry
          ? 'Recorded in the custody ledger. To confirm this is the document that was issued, remove the "issued" block and recompute SHA-256 over the canonical JSON of the remainder; it must equal reportHash, which entry ' +
            entry.seq +
            ' commits to.'
          : 'The ledger entry could not be written - this report is NOT recorded in the custody chain.',
      },
    })
  } catch (error: any) {
    console.error('Report issue failed:', error)
    return NextResponse.json({ error: error?.message ?? 'Report failed' }, { status: 500 })
  }
}
