import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
import {
  PROFILES,
  PROFILE_NAMES,
  isProfileName,
  rescoreEvents,
} from '@/lib/investigationProfiles'
import { buildEvidenceGraph } from '@/lib/evidenceGraph'

/**
 * Event list with optional investigator-conditioned ranking (feature 10.1) and
 * evidence grouping (feature 10.2).
 *
 *   GET /api/events                            -> events in pipeline order
 *   GET /api/events?mode=phone_activity        -> same events, re-ranked
 *   GET /api/events?groups=1                   -> adds the evidence graph
 *   GET /api/events?profiles=1                 -> lists available profiles
 *
 * Deliberately a separate route from /api/video, which the existing frontend
 * depends on: this re-reads the same source of truth and re-orders a copy, so
 * no current caller changes behaviour.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams

    if (params.get('profiles') === '1') {
      return NextResponse.json({
        profiles: PROFILE_NAMES.map((name) => ({ name, weights: PROFILES[name] })),
      })
    }

    const dataPath = path.join(process.cwd(), 'public', 'api', 'events.json')
    if (!fs.existsSync(dataPath)) {
      return NextResponse.json({ error: 'No data available' }, { status: 404 })
    }

    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
    const events: any[] = Array.isArray(data?.events) ? data.events : []

    const mode = params.get('mode')
    if (mode !== null && !isProfileName(mode)) {
      return NextResponse.json(
        { error: `Unknown mode "${mode}". Available: ${PROFILE_NAMES.join(', ')}` },
        { status: 400 }
      )
    }

    const ranked = mode ? rescoreEvents(events, mode) : events

    const body: Record<string, unknown> = {
      video_id: data.video_id,
      pipeline_dir: data.pipeline_dir,
      event_count: ranked.length,
      mode: mode ?? null,
      ranked_by: mode ? 'profileScore' : 'pipeline order',
      events: ranked,
    }

    if (params.get('groups') === '1') {
      const timeWindow = Number(params.get('time_window') ?? 300)
      const spatialThresh = Number(params.get('spatial_thresh') ?? 0.3)
      body.groups = buildEvidenceGraph(
        events,
        Number.isFinite(timeWindow) ? timeWindow : 300,
        Number.isFinite(spatialThresh) ? spatialThresh : 0.3
      )
    }

    return NextResponse.json(body)
  } catch (error) {
    console.error('Error building event list:', error)
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 })
  }
}
