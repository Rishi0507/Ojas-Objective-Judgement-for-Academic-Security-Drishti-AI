import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getCurrentPipelineDir } from '@/lib/currentVideo'

/**
 * Every video processed on this machine, newest first.
 *
 * Until now the dashboard read public/api/events.json, which is a single
 * pointer to the most recent run - so each upload made the previous one
 * invisible even though every frame, snapshot and clip was still on disk.
 * Nothing was ever deleted; it just could not be reached.
 *
 * Built from each job's status.json rather than its api_response.json: the
 * latter is several megabytes once evidence is embedded, and parsing one per
 * job on every dashboard load would make listing cost scale with the size of
 * the analysis rather than the number of runs.
 */

const ROOT = process.cwd()
const PIPELINE_OUT = path.join(ROOT, 'pipeline_out')

export interface VideoSummary {
  jobId: string
  filename: string
  state: string
  videoId: string | null
  eventCount: number
  offenceCount: number | null
  startedAt: string | null
  updatedAt: string | null
  sizeMb: number | null
  isActive: boolean
  hasResults: boolean
}

function readJSON(p: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Directory size, computed once and remembered.
 *
 * The naive version walked every file in the job - 13,838 stat calls across
 * four runs, which made this endpoint take 2.7 seconds to return 1.6KB. A
 * finished job's output never changes, so the figure is written beside it the
 * first time and read back afterwards.
 *
 * Deliberately not a time-based cache: there is nothing to invalidate. The
 * answer is either already known and permanent, or the job is still running
 * and the size is not worth reporting yet.
 */
function dirSizeMb(dir: string, isFinished: boolean): number | null {
  const cachePath = path.join(dir, '.summary.json')

  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
    if (typeof cached?.sizeMb === 'number') return cached.sizeMb
  } catch {
    // not computed yet
  }

  // Skip the walk entirely while a job is still producing files: the number
  // would be wrong the moment it was read, and this is the expensive path.
  if (!isFinished) return null

  try {
    let total = 0
    const walk = (d: string, depth: number) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name)
        if (entry.isFile()) total += fs.statSync(p).size
        else if (entry.isDirectory() && depth > 0) walk(p, depth - 1)
      }
    }
    walk(dir, 2)
    const sizeMb = Math.round((total / 1e6) * 10) / 10
    try {
      fs.writeFileSync(cachePath, JSON.stringify({ sizeMb, computedAt: new Date().toISOString() }))
    } catch {
      // read-only directory - recomputing next time is acceptable
    }
    return sizeMb
  } catch {
    return null
  }
}


/** One field from a job's cached summary, or null if not computed yet. */
function cachedField(dir: string, key: string): any {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dir, '.summary.json'), 'utf-8'))
    return c?.[key] ?? null
  } catch {
    return null
  }
}

/** Merge one field into the cached summary, leaving the rest intact. */
function writeCachedField(dir: string, key: string, value: any): void {
  const p = path.join(dir, '.summary.json')
  let existing: Record<string, unknown> = {}
  try {
    existing = JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    // first write
  }
  try {
    fs.writeFileSync(p, JSON.stringify({ ...existing, [key]: value }))
  } catch {
    // read-only - recompute next time
  }
}

export async function GET() {
  try {
    if (!fs.existsSync(PIPELINE_OUT)) {
      return NextResponse.json({ videos: [], active: null })
    }

    const active = getCurrentPipelineDir()
    const videos: VideoSummary[] = []

    for (const entry of fs.readdirSync(PIPELINE_OUT, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = path.join(PIPELINE_OUT, entry.name)
      const status = readJSON(path.join(dir, 'status.json'))
      const resultsPath = path.join(dir, 'api_response.json')
      const hasResults = fs.existsSync(resultsPath)

      // Offence count is the one figure worth the extra read, since it is what
      // a reviewer is actually choosing between. Cached with the size for the
      // same reason: api_response.json is several megabytes and only changes
      // when the job is re-analysed, so parsing it on every list was costing
      // more than everything else on this endpoint combined.
      let offenceCount: number | null = cachedField(dir, 'offenceCount')
      if (offenceCount === null && hasResults) {
        const results = readJSON(resultsPath)
        if (results?.events) {
          offenceCount = results.events.reduce(
            (n: number, e: any) => n + ((e.offences ?? []).filter((o: any) => !o.suppressed).length),
            0
          )
          writeCachedField(dir, 'offenceCount', offenceCount)
        }
      }

      videos.push({
        jobId: entry.name,
        filename: status?.filename ?? entry.name,
        state: status?.state ?? (hasResults ? 'done' : 'unknown'),
        videoId: status?.videoId ?? null,
        eventCount: status?.eventCount ?? 0,
        offenceCount,
        startedAt: status?.startedAt ?? null,
        updatedAt: status?.updatedAt ?? null,
        sizeMb: dirSizeMb(dir, (status?.state ?? '') === 'done' || hasResults),
        isActive: entry.name === active,
        hasResults,
      })
    }

    // Newest first. The job id is prefixed with an epoch timestamp, so it
    // sorts correctly even when status.json is missing or unreadable.
    videos.sort((a, b) => b.jobId.localeCompare(a.jobId))

    return NextResponse.json({ videos, active })
  } catch (error: any) {
    console.error('Failed to list videos:', error)
    return NextResponse.json({ error: error?.message ?? 'Failed to list' }, { status: 500 })
  }
}
