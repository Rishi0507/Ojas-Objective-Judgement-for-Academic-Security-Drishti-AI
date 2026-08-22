import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getCurrentPipelineDir } from '@/lib/currentVideo'
import { createClient } from '@/lib/supabase/server'
import { syncVerdict } from '@/lib/supabase/sync'

/**
 * Reviewer verdicts on individual offences.
 *
 * Detection is heuristic — a wrist entering a neighbour's box is evidence of
 * reaching, not proof of a hand-off — so the person reviewing needs to be able
 * to throw out what the system got wrong. Verdicts are stored per video
 * alongside its pipeline output rather than in the browser, so a dismissal
 * survives a reload and is visible to whoever reviews next.
 *
 * Keyed by trackId/type/frameIdx: stable across re-runs of the same video, and
 * independent of ordering within the offence list.
 */

type Verdict = 'dismissed' | 'confirmed'

function reviewPath(): string {
  return path.join(process.cwd(), 'pipeline_out', getCurrentPipelineDir(), 'review.json')
}

function readReview(): Record<string, Verdict> {
  try {
    return JSON.parse(fs.readFileSync(reviewPath(), 'utf-8'))
  } catch {
    return {}
  }
}

export async function GET() {
  return NextResponse.json({ verdicts: readReview() })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const key = String(body?.key ?? '')
    const verdict = body?.verdict

    if (!key) {
      return NextResponse.json({ error: 'key required' }, { status: 400 })
    }
    if (verdict !== 'dismissed' && verdict !== 'confirmed' && verdict !== null) {
      return NextResponse.json({ error: 'verdict must be dismissed, confirmed, or null' }, { status: 400 })
    }

    const verdicts = readReview()
    if (verdict === null) {
      delete verdicts[key] // undo — back to unreviewed
    } else {
      verdicts[key] = verdict
    }

    const p = reviewPath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(verdicts, null, 2))

    // Mirror to Supabase so a verdict is attributed to a reviewer and survives
    // beyond this machine. The local file stays authoritative for rendering,
    // so an unconfigured or failing Supabase never blocks a review.
    try {
      const supabase = createClient()
      const { data } = await supabase.auth.getUser()
      if (data.user) {
        await syncVerdict(getCurrentPipelineDir(), data.user.id, key, verdict)
      }
    } catch {
      // local-only run
    }

    return NextResponse.json({ ok: true, verdicts })
  } catch (error: any) {
    console.error('Failed to save review:', error)
    return NextResponse.json({ error: error?.message ?? 'Failed to save' }, { status: 500 })
  }
}
