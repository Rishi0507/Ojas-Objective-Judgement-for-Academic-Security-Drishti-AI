import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import {
  foldSession,
  detectDrift,
  rankFleet,
  type RegionBaselines,
  type DriftReport,
} from '@/lib/centreProfile'
import { loadProfiles, getProfile, putProfile, mirrorProfile } from '@/lib/centreStore'

/**
 * Fleet calibration.
 *
 *   GET  /api/centres            -> every camera's profile and last drift verdict
 *   POST /api/centres            -> register a processed run against a camera
 *        body: { centre_id, camera_id, pipeline_dir, fold? }
 *
 * POST reports drift against the stored profile FIRST, then folds the session
 * in only when asked. Folding unconditionally would quietly absorb a knocked
 * camera into its own baseline - the drift would be reported once and then
 * become the new normal, which is the opposite of what a fleet operator needs.
 */

const ROOT = process.cwd()

function readBaselines(pipelineDir: string): RegionBaselines | null {
  try {
    const p = path.join(ROOT, 'pipeline_out', pipelineDir, 'baselines', 'region_baselines.json')
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
    if (!data?.regions || typeof data.regions !== 'object') return null
    return data as RegionBaselines
  } catch {
    return null
  }
}

/** Last drift verdict per camera, recorded at registration time. */
const DRIFT_PATH = path.join(ROOT, 'fleet', 'last_drift.json')

function loadDrift(): Record<string, DriftReport> {
  try {
    return JSON.parse(fs.readFileSync(DRIFT_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function saveDrift(all: Record<string, DriftReport>): void {
  fs.mkdirSync(path.dirname(DRIFT_PATH), { recursive: true })
  const tmp = `${DRIFT_PATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2))
  fs.renameSync(tmp, DRIFT_PATH)
}

export async function GET() {
  try {
    const profiles = loadProfiles()
    const drift = loadDrift()

    const cameras = Object.values(profiles).map((p) => {
      const key = `${p.centre_id}::${p.camera_id}`
      return {
        centre_id: p.centre_id,
        camera_id: p.camera_id,
        sessions: p.sessions,
        regions: Object.keys(p.regions).length,
        grid: p.grid,
        frame_resolution: p.frame_resolution,
        updated_at: p.updated_at,
        last_drift: drift[key] ?? null,
      }
    })

    const reports = cameras.map((c) => c.last_drift).filter(Boolean) as DriftReport[]
    const ranked = rankFleet(reports)

    const counts = reports.reduce<Record<string, number>>((acc, r) => {
      acc[r.verdict] = (acc[r.verdict] ?? 0) + 1
      return acc
    }, {})

    return NextResponse.json({
      cameras: cameras.sort((a, b) =>
        a.centre_id.localeCompare(b.centre_id) || a.camera_id.localeCompare(b.camera_id)
      ),
      fleet_size: cameras.length,
      verdict_counts: counts,
      // Worst first: what an operator should look at before the exam starts.
      attention_queue: ranked.filter((r) => r.verdict !== 'stable'),
    })
  } catch (error: any) {
    console.error('Fleet read failed:', error)
    return NextResponse.json({ error: error?.message ?? 'Failed to read fleet' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const centreId = String(body?.centre_id ?? '').trim()
    const cameraId = String(body?.camera_id ?? '').trim()
    const pipelineDir = String(body?.pipeline_dir ?? '').trim()
    const fold = body?.fold !== false // default: fold after reporting

    if (!centreId || !cameraId || !pipelineDir) {
      return NextResponse.json(
        { error: 'centre_id, camera_id and pipeline_dir are required' },
        { status: 400 }
      )
    }
    // pipeline_dir indexes a directory, so a traversal here would read
    // arbitrary JSON off disk.
    if (pipelineDir.includes('..') || pipelineDir.includes('/') || pipelineDir.includes('\\')) {
      return NextResponse.json({ error: 'invalid pipeline_dir' }, { status: 400 })
    }

    const baselines = readBaselines(pipelineDir)
    if (!baselines) {
      return NextResponse.json(
        {
          error:
            `No region_baselines.json for "${pipelineDir}". Run: ` +
            `python m1_7/module10_region_baseline.py --pipeline-dir pipeline_out/${pipelineDir}`,
        },
        { status: 404 }
      )
    }

    const existing = getProfile(centreId, cameraId)
    const drift = detectDrift(existing, baselines, centreId, cameraId)

    const allDrift = loadDrift()
    allDrift[`${centreId}::${cameraId}`] = drift
    saveDrift(allDrift)

    let profile = existing
    let folded = false
    // A moved camera is not folded in even when asked: absorbing it would make
    // the new framing the baseline and erase the very deviation just reported.
    if (fold && drift.verdict !== 'camera_moved' && drift.verdict !== 'unusable') {
      profile = foldSession(existing, centreId, cameraId, baselines)
      putProfile(profile)
      folded = true
      await mirrorProfile(profile)
    }

    return NextResponse.json({
      centre_id: centreId,
      camera_id: cameraId,
      drift,
      folded,
      fold_skipped_reason: folded
        ? null
        : drift.verdict === 'camera_moved' || drift.verdict === 'unusable'
          ? `Not folded: verdict "${drift.verdict}" would overwrite the baseline with the deviation. ` +
            `Confirm the camera, then re-register with fold=true.`
          : 'Not folded: fold=false requested.',
      sessions: profile?.sessions ?? 0,
    })
  } catch (error: any) {
    console.error('Fleet register failed:', error)
    return NextResponse.json({ error: error?.message ?? 'Failed to register' }, { status: 500 })
  }
}
