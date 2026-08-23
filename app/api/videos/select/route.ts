import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

/**
 * Makes one processed video the active one.
 *
 * public/api/events.json is the single "currently viewing" pointer that every
 * other route resolves through (see lib/currentVideo.ts). Selecting a video
 * copies that job's results over it; nothing is moved or deleted, so switching
 * back is the same operation in reverse.
 */

const ROOT = process.cwd()

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const jobId = String(body?.jobId ?? '')

    // The id becomes a path segment, so anything that could climb out of
    // pipeline_out/ is rejected rather than sanitised - a traversal here would
    // let any file on disk be served as analysis results. basename() strips any
    // separator on either platform, so a mismatch means the input contained one.
    if (!jobId || jobId === '..' || path.basename(jobId) !== jobId) {
      return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 })
    }

    const source = path.join(ROOT, 'pipeline_out', jobId, 'api_response.json')
    if (!fs.existsSync(source)) {
      return NextResponse.json(
        { error: `No analysis results for "${jobId}". The run may not have finished.` },
        { status: 404 }
      )
    }

    const results = JSON.parse(fs.readFileSync(source, 'utf-8'))
    // Stamp it even though the pipeline already does: a job processed before
    // that field existed would otherwise leave every downstream route resolving
    // to the wrong directory.
    results.pipeline_dir = jobId

    const target = path.join(ROOT, 'public', 'api', 'events.json')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(results, null, 2))

    return NextResponse.json({
      ok: true,
      jobId,
      videoId: results.video_id ?? null,
      eventCount: results.event_count ?? 0,
    })
  } catch (error: any) {
    console.error('Failed to select video:', error)
    return NextResponse.json({ error: error?.message ?? 'Failed to select' }, { status: 500 })
  }
}
