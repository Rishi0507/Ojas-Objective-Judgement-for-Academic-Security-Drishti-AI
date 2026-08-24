import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getCurrentPipelineDir } from '@/lib/currentVideo'

export const dynamic = 'force-dynamic'

/**
 * Every finding from every processed video on this machine.
 *
 * /api/video answers "what is in the active video", which is the right shape
 * for the player and the segment views - they all resolve through the active
 * pointer. But a reviewer working through findings does not care which video
 * happens to be selected; they want the whole backlog in one list. This walks
 * pipeline_out/ instead of following the pointer.
 *
 * The response deliberately keeps /api/video's shape - { video_id, event_count,
 * events[] } - so the findings list can consume either without a second code
 * path. What is added is per-event attribution: sourceJobId and sourceVideo,
 * so a row can say which video it came from.
 */

const PIPELINE_OUT = path.join(process.cwd(), 'pipeline_out')

function readJSON(p: string): any {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

export async function GET() {
  try {
    if (!fs.existsSync(PIPELINE_OUT)) {
      return NextResponse.json({ video_id: 'all', event_count: 0, events: [], videos: [] })
    }

    const active = getCurrentPipelineDir()
    const events: any[] = []
    const videos: { jobId: string; filename: string; eventCount: number; offenceCount: number; isActive: boolean }[] = []

    const dirs = fs
      .readdirSync(PIPELINE_OUT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()

    for (const jobId of dirs) {
      const dir = path.join(PIPELINE_OUT, jobId)
      const results = readJSON(path.join(dir, 'api_response.json'))
      if (!results?.events) continue

      const status = readJSON(path.join(dir, 'status.json'))
      const filename = status?.filename ?? results.video_id ?? jobId

      let offenceCount = 0
      for (const ev of results.events) {
        offenceCount += (ev.offences ?? []).filter((o: any) => !o.suppressed).length
        events.push({
          ...ev,
          // Segment ids are only unique within a job, so two videos both
          // holding an "event-1" would collide as React keys and, worse, make
          // two different segments indistinguishable to the review store.
          id: `${jobId}::${ev.id}`,
          sourceJobId: jobId,
          sourceVideo: filename,
          sourceIsActive: jobId === active,
        })
      }

      videos.push({
        jobId,
        filename,
        eventCount: results.events.length,
        offenceCount,
        isActive: jobId === active,
      })
    }

    return NextResponse.json({
      video_id: 'all',
      event_count: events.length,
      events,
      videos,
      active,
    })
  } catch (error) {
    console.error('Error aggregating offences:', error)
    return NextResponse.json({ error: 'Failed to aggregate findings' }, { status: 500 })
  }
}
