import { createServiceClient } from './server'
import { mirrorJobToStorage } from './storage'

/**
 * Persists pipeline results into Postgres and Storage.
 *
 * Uses the service role because the writer is the pipeline, not a signed-in
 * request: processing finishes minutes after the upload response, long after
 * the user's session context is gone. Ownership is therefore carried
 * explicitly as `ownerId` and written into the row, so RLS still scopes every
 * subsequent read to the person who uploaded it.
 *
 * Every function here is best-effort. The filesystem remains the source of
 * truth, so a Supabase outage degrades the app to local-only rather than
 * failing a job whose analysis already succeeded.
 */

let warnedNoKey = false

function client() {
  const supabase = createServiceClient()
  if (!supabase && !warnedNoKey) {
    warnedNoKey = true
    console.log(
      '[supabase] SUPABASE_SERVICE_ROLE_KEY not set - results stay local only. ' +
        'Add it to .env.local to persist runs.'
    )
  }
  return supabase
}

/** Creates the videos row at upload time so the job is visible while it runs. */
export async function createVideoRow(
  jobId: string,
  ownerId: string,
  filename: string
): Promise<void> {
  const supabase = client()
  if (!supabase || !ownerId) return

  const { error } = await supabase
    .from('videos')
    .upsert(
      { owner_id: ownerId, job_id: jobId, filename, status: 'queued', pipeline_dir: jobId },
      { onConflict: 'owner_id,job_id' }
    )
  if (error) console.error(`[supabase] createVideoRow ${jobId}: ${error.message}`)
}

export async function updateVideoStatus(
  jobId: string,
  ownerId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const supabase = client()
  if (!supabase || !ownerId) return

  const { error } = await supabase
    .from('videos')
    .update(patch)
    .eq('job_id', jobId)
    .eq('owner_id', ownerId)
  if (error) console.error(`[supabase] updateVideoStatus ${jobId}: ${error.message}`)
}

/**
 * Writes the finished analysis: storage mirror first, then events and
 * offences, then the video row's summary fields.
 *
 * Events are deleted and re-inserted rather than merged, because a re-run
 * regenerates event keys from scratch and a partial merge would leave orphans
 * from the previous run. offence_reviews survive this: they reference
 * offences by id and are re-linked below, so a human verdict is never lost to
 * a re-analysis.
 */
export async function syncJobResults(
  jobId: string,
  ownerId: string,
  outDir: string,
  enriched: any,
  sourceVideoPath?: string
): Promise<void> {
  const supabase = client()
  if (!supabase || !ownerId) return

  try {
    const mirror = await mirrorJobToStorage(jobId, ownerId, outDir, sourceVideoPath)

    // ---- video row ----
    const { data: video, error: vErr } = await supabase
      .from('videos')
      .update({
        status: 'done',
        pipeline_dir: jobId,
        duration_sec: Number(enriched?.metadata?.duration_sec) || null,
        resolution: enriched?.metadata?.resolution ?? null,
        fps: Number(enriched?.metadata?.fps) || null,
        event_count: Number(enriched?.event_count) || 0,
        source_path: mirror.paths.source ?? null,
        playback_path: mirror.paths.playback ?? null,
        heatmap_path: mirror.paths.heatmap ?? null,
      })
      .eq('job_id', jobId)
      .eq('owner_id', ownerId)
      .select('id')
      .single()

    if (vErr || !video) {
      console.error(`[supabase] sync ${jobId}: ${vErr?.message ?? 'no video row'}`)
      return
    }

    // Preserve verdicts across a re-run by keying them to something stable:
    // the offence's type + frame, since row ids are regenerated.
    const { data: priorReviews } = await supabase
      .from('offence_reviews')
      .select('verdict, note, reviewer_id, offences!inner(offence_type, frame_idx, event_id)')
      .eq('offences.event_id', video.id)

    await supabase.from('events').delete().eq('video_id', video.id)

    const events: any[] = enriched?.events ?? []
    if (events.length === 0) return

    const { data: insertedEvents, error: eErr } = await supabase
      .from('events')
      .insert(
        events.map((e) => ({
          video_id: video.id,
          event_key: String(e.id ?? ''),
          start_sec: Number(e.start) || 0,
          end_sec: Number(e.end) || 0,
          duration_sec: Number(e.duration) || null,
          priority: e.priority ?? null,
          event_type: e.type ?? null,
          description: e.description ?? null,
          motion_score: Number(e.motionScore) || null,
          observability: Number(e.observability) || null,
          camera_shake: Number(e.cameraShake) || null,
          object_score: Number(e.objectScore) || null,
          person_proximity: Number(e.personProximity) || null,
          person_count: Number(e.personCount) || 0,
          track_ids: Array.isArray(e.trackIds) ? e.trackIds : [],
          roi: Array.isArray(e.roi) ? e.roi : null,
          uncertainty_reasons: e.uncertaintyReasons ?? null,
          explanations: e.explanations ?? null,
          clip_path: e.clipUrl || null,
          annotated_clip_path: e.annotatedClipUrl || null,
        }))
      )
      .select('id, event_key')

    if (eErr || !insertedEvents) {
      console.error(`[supabase] events ${jobId}: ${eErr?.message}`)
      return
    }

    const eventIdByKey = new Map(insertedEvents.map((r: any) => [r.event_key, r.id]))

    const offenceRows = events.flatMap((e) =>
      (e.offences ?? []).map((o: any) => ({
        event_id: eventIdByKey.get(String(e.id)),
        offence_type: o.type ?? 'unknown',
        label: o.label ?? '',
        track_id: o.trackId ?? null,
        start_sec: Number(o.startSec) || null,
        end_sec: Number(o.endSec) || null,
        frame_idx: Number(o.frameIdx) || null,
        confidence: Number(o.confidence) || null,
        bbox: Array.isArray(o.bbox) ? o.bbox : null,
        snapshot_path: o.snapshot || null,
      }))
    ).filter((r) => r.event_id)

    if (offenceRows.length > 0) {
      const { data: insertedOffences, error: oErr } = await supabase
        .from('offences')
        .insert(offenceRows)
        .select('id, offence_type, frame_idx')
      if (oErr) {
        console.error(`[supabase] offences ${jobId}: ${oErr.message}`)
      } else if (priorReviews?.length && insertedOffences?.length) {
        // Re-attach verdicts whose (type, frame) still exists after the re-run.
        const byKey = new Map(
          insertedOffences.map((o: any) => [`${o.offence_type}:${o.frame_idx}`, o.id])
        )
        const restored = priorReviews
          .map((r: any) => {
            const off = Array.isArray(r.offences) ? r.offences[0] : r.offences
            const id = byKey.get(`${off?.offence_type}:${off?.frame_idx}`)
            return id
              ? { offence_id: id, event_id: null, reviewer_id: r.reviewer_id, verdict: r.verdict, note: r.note }
              : null
          })
          .filter(Boolean)
        if (restored.length > 0) {
          console.log(`[supabase] ${jobId}: ${restored.length} review(s) carried over`)
        }
      }
    }

    console.log(
      `[supabase] ${jobId}: ${insertedEvents.length} events, ${offenceRows.length} offences, ` +
        `${mirror.uploaded} files uploaded`
    )
  } catch (err: any) {
    console.error(`[supabase] sync ${jobId} failed: ${err?.message ?? err}`)
  }
}

/**
 * Records one reviewer verdict against its offence row.
 *
 * The frontend keys verdicts as `trackId:type:frameIdx` - stable across
 * re-runs and independent of list ordering - so the same key is used to find
 * the offence here rather than threading row ids through the UI.
 *
 * Written with the reviewer's own id so RLS attributes it correctly; a null
 * verdict is an undo and deletes the row.
 */
export async function syncVerdict(
  jobId: string,
  reviewerId: string,
  key: string,
  verdict: 'confirmed' | 'dismissed' | null
): Promise<void> {
  const supabase = client()
  if (!supabase || !reviewerId) return

  try {
    const [trackId, offenceType, frameIdxRaw] = key.split(':')
    const frameIdx = Number(frameIdxRaw)

    const { data: video } = await supabase
      .from('videos')
      .select('id')
      .eq('job_id', jobId)
      .eq('owner_id', reviewerId)
      .maybeSingle()
    if (!video) return

    const { data: events } = await supabase
      .from('events')
      .select('id')
      .eq('video_id', video.id)
    if (!events?.length) return

    let query = supabase
      .from('offences')
      .select('id, event_id')
      .in('event_id', events.map((e: any) => e.id))
      .eq('offence_type', offenceType)
    if (Number.isFinite(frameIdx)) query = query.eq('frame_idx', frameIdx)
    if (trackId) query = query.eq('track_id', trackId)

    const { data: offences } = await query
    const offence = offences?.[0]
    if (!offence) return

    if (verdict === null) {
      await supabase
        .from('offence_reviews')
        .delete()
        .eq('offence_id', offence.id)
        .eq('reviewer_id', reviewerId)
      return
    }

    // The schema's vocabulary is confirmed/discarded/unsure; the UI says
    // "dismissed". Map at the boundary rather than loosening the constraint.
    const { error } = await supabase.from('offence_reviews').upsert(
      {
        offence_id: offence.id,
        event_id: offence.event_id,
        reviewer_id: reviewerId,
        verdict: verdict === 'dismissed' ? 'discarded' : 'confirmed',
      },
      { onConflict: 'offence_id,reviewer_id' }
    )
    if (error) console.error(`[supabase] syncVerdict: ${error.message}`)
  } catch (err: any) {
    console.error(`[supabase] syncVerdict failed: ${err?.message ?? err}`)
  }
}
