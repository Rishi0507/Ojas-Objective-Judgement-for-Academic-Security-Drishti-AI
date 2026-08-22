import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getCurrentPipelineDir } from '@/lib/currentVideo'
import { proposeThresholds, type ReviewedOffence, type Verdict } from '@/lib/calibration'

/**
 * GET /api/calibration
 *
 * Reads back what reviewers confirmed or dismissed and proposes threshold
 * changes per detector. Read-only by design: it reports what the verdicts
 * imply and stops there. Nothing here edits the pipeline.
 *
 * That boundary is deliberate. A detector that silently retunes itself from
 * review data would make every later verdict a judgement of a different
 * system, and the drift would be invisible in the output. The thresholds live
 * as named constants in the Go source with their reasoning attached; changing
 * one should be a reviewed commit, not a side effect of clicking "dismiss".
 */

/**
 * Thresholds the pipeline currently applies, so a proposal reads as a change
 * rather than a bare number.
 *
 * Mirrored from the Go constants (pose_analysis.go, processor.go) rather than
 * parsed from them: parsing source to display it invites the two drifting
 * apart silently, whereas a stale literal here is visible the moment the
 * proposal quotes a "current" value a reviewer does not recognise.
 */
const CURRENT_THRESHOLDS: Record<string, number> = {
  prohibited_object: 0.5, // detector confidence gate
  head_turn: 0.35, // headTurnDeviationThreshold
  hand_gesture: 0.15, // handRaiseMargin
  crowd_disturbance: 0.35, // crowdMoveThreshold
  object_exchange: 0.5,
  loitering: 0.5,
}

interface OffenceLike {
  type?: string
  trackId?: string
  frameIdx?: number
  confidence?: number
}

/** Same key the reviewer UI writes: `${trackId ?? 'none'}|${type}|${frameIdx}`. */
function offenceKey(o: OffenceLike): string {
  return `${o.trackId ?? 'none'}|${o.type}|${o.frameIdx}`
}

export async function GET() {
  try {
    const root = process.cwd()
    const pipelineDir = getCurrentPipelineDir()

    const reviewPath = path.join(root, 'pipeline_out', pipelineDir, 'review.json')
    const eventsPath = path.join(root, 'public', 'api', 'events.json')

    let verdicts: Record<string, Verdict> = {}
    try {
      verdicts = JSON.parse(fs.readFileSync(reviewPath, 'utf-8'))
    } catch {
      // no reviews yet for this video
    }

    let events: any[] = []
    try {
      events = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'))?.events ?? []
    } catch {
      // no active video
    }

    // Join verdicts back to the offences they refer to, since a verdict alone
    // carries no confidence and confidence is what is being calibrated.
    const reviewed: ReviewedOffence[] = []
    let orphaned = 0
    for (const ev of events) {
      for (const off of (ev.offences ?? []) as OffenceLike[]) {
        const verdict = verdicts[offenceKey(off)]
        if (!verdict) continue
        if (typeof off.confidence !== 'number') {
          orphaned++
          continue
        }
        reviewed.push({
          type: off.type ?? 'unknown',
          confidence: off.confidence,
          verdict,
        })
      }
    }

    // Verdicts whose offence is no longer present - the video was re-analysed
    // and that finding did not recur. Counted, not silently dropped: a large
    // number means the proposals rest on a shrinking slice of the reviews.
    const unmatched = Object.keys(verdicts).length - reviewed.length - orphaned

    const proposals = proposeThresholds(reviewed, CURRENT_THRESHOLDS)

    return NextResponse.json({
      pipeline_dir: pipelineDir,
      verdicts_recorded: Object.keys(verdicts).length,
      verdicts_matched: reviewed.length,
      verdicts_unmatched: Math.max(0, unmatched),
      verdicts_without_confidence: orphaned,
      proposals,
      note:
        'Proposals only. Thresholds are constants in the Go source and are changed by ' +
        'a reviewed commit, never automatically from this endpoint.',
    })
  } catch (error: any) {
    console.error('Calibration failed:', error)
    return NextResponse.json(
      { error: error?.message ?? 'Failed to compute calibration' },
      { status: 500 }
    )
  }
}
