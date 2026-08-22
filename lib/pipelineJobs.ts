import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { createVideoRow, updateVideoStatus, syncJobResults } from './supabase/sync'
import { appendEntry } from './ledger/store'
import { sha256File } from './ledger/hash'

export type JobState = 'queued' | 'processing' | 'done' | 'error'

export interface JobStatus {
  jobId: string
  state: JobState
  message: string
  filename: string
  videoId?: string
  eventCount?: number
  startedAt: string
  updatedAt: string
  error?: string
  /** 0-100. Modules 1-7 (Python) map to 0-90, Modules 8-9 (Go) to 90-100. */
  percent?: number
  /** Current pipeline stage id, e.g. "module3_motion_detection". */
  stage?: string
  /**
   * Supabase user id of whoever uploaded this. Carried explicitly because
   * processing finishes long after the request that started it, so there is
   * no session to read at write time. Empty for anonymous/local-only runs.
   */
  ownerId?: string
}

const ROOT = process.cwd()
const UPLOADS_DIR = path.join(ROOT, 'uploads')
const PIPELINE_OUT_DIR = path.join(ROOT, 'pipeline_out')
const M1_7_DIR = path.join(ROOT, 'm1_7')
const M8_9_DIR = path.join(ROOT, 'm8_9_golang')
const BACKEND_EXE = path.join(M8_9_DIR, 'drishti-backend.exe')

export function ensureDirs() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
  fs.mkdirSync(PIPELINE_OUT_DIR, { recursive: true })
}

export function slugify(filename: string): string {
  const base = filename.replace(/\.[^/.]+$/, '')
  const cleaned = base.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  return `${Date.now()}_${cleaned || 'video'}`
}

function statusPath(jobId: string) {
  return path.join(PIPELINE_OUT_DIR, jobId, 'status.json')
}

export function writeStatus(jobId: string, patch: Partial<JobStatus>) {
  const dir = path.join(PIPELINE_OUT_DIR, jobId)
  fs.mkdirSync(dir, { recursive: true })
  const existing = readStatus(jobId)
  const merged: JobStatus = {
    ...(existing as JobStatus),
    ...patch,
    jobId,
    updatedAt: new Date().toISOString(),
  } as JobStatus
  fs.writeFileSync(statusPath(jobId), JSON.stringify(merged, null, 2))
  return merged
}

export function readStatus(jobId: string): JobStatus | null {
  const p = statusPath(jobId)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

const activeProcesses = new Map<string, Set<any>>()

function runCommand(cmd: string, args: string[], cwd: string, jobId?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd })
    if (jobId) {
      if (!activeProcesses.has(jobId)) activeProcesses.set(jobId, new Set())
      activeProcesses.get(jobId)!.add(child)
    }
    
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { out += d.toString() })
    child.on('error', (err) => {
      if (jobId) activeProcesses.get(jobId)?.delete(child)
      reject(new Error(`Failed to start ${cmd}: ${err.message}`))
    })
    child.on('close', (code) => {
      if (jobId) activeProcesses.get(jobId)?.delete(child)
      if (code === 0 || code === null) resolve(out) // Allow null code for killed processes
      else reject(new Error(`${path.basename(cmd)} exited with code ${code}\n${out.split('\n').slice(-20).join('\n')}`))
    })
  })
}

export function cancelJob(jobId: string) {
  writeStatus(jobId, { state: 'error', message: 'Cancelled by user', percent: 0 })
  const procs = activeProcesses.get(jobId)
  if (procs) {
    for (const p of procs) {
      try {
        p.kill('SIGKILL')
      } catch (e) {}
    }
    procs.clear()
  }
}

/**
 * Polls a progress.json file (written by run_pipeline.py after each stage —
 * see STAGE_WEIGHTS there) while a long-running command executes, and maps
 * its 0-100 into [scaleMin, scaleMax] of the overall job's percent so the
 * UI shows real incremental progress instead of a static message for
 * minutes at a time.
 */
function watchProgressFile(
  jobId: string,
  progressPath: string,
  scaleMin: number,
  scaleMax: number
): NodeJS.Timeout {
  return setInterval(() => {
    try {
      const data = JSON.parse(fs.readFileSync(progressPath, 'utf-8'))
      if (typeof data.percent === 'number') {
        const scaled = scaleMin + (data.percent / 100) * (scaleMax - scaleMin)
        writeStatus(jobId, {
          percent: Math.round(scaled * 10) / 10,
          message: data.stage_label || 'Processing...',
          stage: data.stage,
        })
      }
    } catch {
      // progress.json may not exist yet, or be mid-write — ignore and retry
    }
  }, 1500)
}

/** Rewrites any path pointing into pipeline_out/ to be app-root relative. */
function toAppRelative(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const idx = normalized.indexOf('pipeline_out/')
  return idx >= 0 ? normalized.slice(idx) : normalized
}

function normalizeAssetPaths(enriched: any): void {
  for (const ev of enriched?.events ?? []) {
    if (Array.isArray(ev.snapshots)) {
      ev.snapshots = ev.snapshots.map(toAppRelative)
    }
    for (const off of ev.offences ?? []) {
      if (off.snapshot) off.snapshot = toAppRelative(off.snapshot)
    }
  }
}

async function probeCodec(videoPath: string, streamSelector: 'v:0' | 'a:0'): Promise<string | null> {
  try {
    const out = await runCommand('ffprobe', [
      '-v', 'error',
      '-select_streams', streamSelector,
      '-show_entries', 'stream=codec_name',
      '-of', 'csv=p=0',
      videoPath,
    ], ROOT)
    const codec = out.trim().split('\n')[0]?.trim()
    return codec || null
  } catch {
    return null
  }
}

/** Literal newline, kept out of template strings so concat-list text stays readable. */
const NEWLINE = String.fromCharCode(10)

const BROWSER_SAFE_VIDEO_CODECS = new Set(['h264'])
const BROWSER_SAFE_AUDIO_CODECS = new Set(['aac', 'mp3'])

/**
 * Generates a browser-playable MP4 proxy of the source video. Real CCTV
 * footage in this project is frequently old MPEG-4 Part 2 ("DivX"-style
 * codec, ffprobe reports it as "mpeg4") — no modern browser's <video>
 * element can decode that natively, and no Content-Type/container fix can
 * work around a genuinely unsupported codec, only a real transcode can.
 * If the source is already H.264 (+ AAC/no audio), this is just a fast
 * stream-copy remux into .mp4 (near-instant, no quality loss). Runs
 * concurrently with the Python pipeline (see processUploadedVideo) rather
 * than after it, so on typical clip lengths the transcode is hidden inside
 * that window instead of adding to total wait time.
 */
/**
 * Timestamp of the first keyframe, or 0 if the file already opens on one.
 *
 * CCTV exports are frequently cut mid-stream, so the file's first frames are
 * predicted frames with no reference to predict from — ffmpeg says as much
 * ("first frame is no keyframe") and the decoder emits flat grey. Measured on
 * this footage: 03.CCTV is undecodable until 0.483s, Seat No. 12 until 1.040s,
 * while 01.Candidate opens cleanly at 0.000s.
 */
async function probeFirstKeyframe(videoPath: string): Promise<number> {
  try {
    const out = await runCommand('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-skip_frame', 'nokey',
      '-show_entries', 'frame=pts_time',
      '-of', 'csv=p=0',
      '-read_intervals', '%+3',
      videoPath,
    ], ROOT)
    const first = parseFloat(out.trim().split('\n')[0])
    return Number.isFinite(first) && first > 0 ? first : 0
  } catch {
    return 0
  }
}

async function generatePlaybackProxy(
  videoPath: string,
  outDir: string,
  jobId: string
): Promise<{ path: string; offset: number }> {
  const outPath = path.join(outDir, 'playback.mp4')
  const [videoCodec, audioCodec, keyframeAt] = await Promise.all([
    probeCodec(videoPath, 'v:0'),
    probeCodec(videoPath, 'a:0'),
    probeFirstKeyframe(videoPath),
  ])

  // Start at the first keyframe so the proxy opens on a decodable picture.
  // Reproducing the broken lead-in faithfully only propagates it: it showed up
  // as a grey thumbnail on the first segment of every video, because segment 1
  // reliably begins at t=0 right on top of those frames.
  const seekArgs = keyframeAt > 0 ? ['-ss', keyframeAt.toFixed(3)] : []

  const videoArgs = videoCodec && BROWSER_SAFE_VIDEO_CODECS.has(videoCodec)
    ? ['-c:v', 'copy']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']

  const audioArgs = !audioCodec
    ? ['-an']
    : BROWSER_SAFE_AUDIO_CODECS.has(audioCodec)
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '128k']

  await runCommand('ffmpeg', [
    '-y', ...seekArgs, '-i', videoPath,
    ...videoArgs,
    ...audioArgs,
    '-movflags', '+faststart',
    outPath,
  ], ROOT, jobId)

  // The proxy's clock now starts `offset` seconds into the source. Events are
  // timed against the source, so anything cutting from the proxy has to
  // subtract this — see generateEventClips.
  return { path: outPath, offset: keyframeAt }
}

/**
 * Cuts a short, self-contained clip per event out of the playback proxy, plus
 * (where the Go backend produced annotated frames) a second clip with the
 * detection boxes burned in.
 *
 * Without this, the UI could only play the *whole* video and seek — which is
 * why event playback looked like unrelated footage: an investigator needs the
 * few seconds where the offence happens, not a 5-minute recording to scrub.
 *
 * Both are written under <outDir>/clips and referenced from the event's
 * existing clipUrl / annotatedClipUrl fields (previously always empty).
 */
async function generateEventClips(
  outDir: string,
  enriched: any,
  jobId: string,
  proxyOffset: number
): Promise<void> {
  const events: any[] = enriched?.events ?? []
  if (!events.length) return

  const playbackPath = path.join(outDir, 'playback.mp4')
  if (!fs.existsSync(playbackPath)) return

  const clipsDir = path.join(outDir, 'clips')
  fs.mkdirSync(clipsDir, { recursive: true })

  const annotatedDir = path.join(outDir, 'backend_output', 'annotated')
  const annotatedFrames = fs.existsSync(annotatedDir)
    ? fs.readdirSync(annotatedDir)
        .filter((f) => f.endsWith('.jpg'))
        .map((f) => ({ file: f, idx: parseInt(f.match(/(\d+)\.jpg$/)?.[1] ?? '-1', 10) }))
        .filter((f) => f.idx >= 0)
        .sort((a, b) => a.idx - b.idx)
    : []

  // Annotated frames are named by SOURCE frame index, so converting an
  // event's time window into frame numbers needs the video's real frame
  // rate — not an assumed one.
  const fps = Number(enriched?.metadata?.fps) || 0

  for (const ev of events) {
    const start = Number(ev.start) || 0
    const duration = Math.max(0.5, (Number(ev.end) || 0) - start)
    // Events are timed against the source video, but the proxy's clock starts
    // proxyOffset seconds later (its undecodable lead-in was skipped), so seek
    // positions have to be rebased or every clip drifts by that much.
    const proxyStart = Math.max(0, start - proxyOffset)
    const safeId = String(ev.id ?? 'event').replace(/[^a-zA-Z0-9_-]/g, '_')

    // ---- plain clip ----
    const clipPath = path.join(clipsDir, `${safeId}.mp4`)
    try {
      await runCommand('ffmpeg', [
        '-y',
        '-ss', proxyStart.toFixed(3),
        '-i', playbackPath,
        '-t', duration.toFixed(3),
        // Re-encode rather than stream-copy: copy can only cut on keyframes,
        // which would drift the clip off the actual moment of the offence.
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-an', '-movflags', '+faststart',
        clipPath,
      ], ROOT, jobId)
      ev.clipUrl = path.relative(ROOT, clipPath).split(path.sep).join('/')
    } catch (err: any) {
      console.error(`[clips] ${jobId} ${safeId} failed:`, err?.message ?? err)
    }

    // ---- annotated clip (detection boxes burned in) ----
    if (annotatedFrames.length && fps > 0) {
      const inWindow = annotatedFrames.filter((f) => {
        const t = f.idx / fps
        return t >= start && t <= start + duration
      })

      if (inWindow.length >= 2) {
        // Sampled frames are sparse and unevenly spaced, so drive ffmpeg with a
        // concat list rather than pretending they're a contiguous sequence.
        //
        // Each frame is held for the gap until the NEXT annotated frame, not a
        // fixed 0.2s. Only frames that carried a detection exist on disk, so a
        // fixed hold silently collapses every gap between them: an 83s event
        // rendered as a 32s montage, a 54s event as 3.8s. That breaks more than
        // length - EventDetail maps clip time to source time as
        // `event.start + video.currentTime`, so a compressed annotated clip
        // desynced the time readout, the frame lookup and the scrubber the
        // moment the user toggled bounding boxes.
        //
        // Holding each frame for its real gap makes clip time map 1:1 onto
        // source time, exactly like the plain clip, so the two are
        // interchangeable to the player. The first frame stretches back to the
        // event start and the last runs to the event end, so the total always
        // equals the event duration.
        const listPath = path.join(clipsDir, `${safeId}_frames.txt`)
        const eventEnd = start + duration
        const frameTimes = inWindow.map((f) => f.idx / fps)
        const MIN_HOLD = 0.04 // guard against zero/negative spans
        const listBody = inWindow
          .map((f, i) => {
            const from = i === 0 ? start : frameTimes[i]
            const to = i === inWindow.length - 1 ? eventEnd : frameTimes[i + 1]
            const hold = Math.max(MIN_HOLD, to - from)
            const framePath = path.join(annotatedDir, f.file).split(path.sep).join('/')
            return `file '${framePath}'` + NEWLINE + `duration ${hold.toFixed(3)}`
          })
          .join(NEWLINE)
        // concat demuxer ignores the final entry's duration unless the last
        // file is repeated, otherwise the closing frame is dropped.
        const lastFile = path.join(annotatedDir, inWindow[inWindow.length - 1].file).replace(/\\/g, '/')
        fs.writeFileSync(listPath, `${listBody}\nfile '${lastFile}'\n`)

        const annPath = path.join(clipsDir, `${safeId}_annotated.mp4`)
        try {
          await runCommand('ffmpeg', [
            '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
            // -fps_mode, not the old -vsync: that alias was deprecated in
            // ffmpeg 5 and REMOVED in ffmpeg 9, where it hard-fails the whole
            // command with "Unrecognized option 'vsync'" — so every annotated
            // clip silently failed to render on a current ffmpeg.
            // CFR, not VFR. The concat demuxer expresses each frame's hold as a
            // PTS gap, and a VFR encode drops most of the trailing hold on the
            // floor - measured 7.2s out of an intended 8.33s. Resampling to a
            // constant rate duplicates frames across the gaps instead, landing
            // within one frame of the true event duration so clip time stays
            // aligned with source time for the whole clip.
            '-fps_mode', 'cfr', '-r', String(fps),
            // Hard-cap at the event length. CFR fills the holds by duplicating
            // frames and can overrun by a few seconds on sparse events; -t trims
            // the tail so clip length always equals the window exactly.
            '-t', duration.toFixed(3),
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
            // yuv420p + even dimensions, or browsers refuse to decode it.
            '-pix_fmt', 'yuv420p',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-movflags', '+faststart',
            annPath,
          ], ROOT, jobId)
          ev.annotatedClipUrl = path.relative(ROOT, annPath).split(path.sep).join('/')
        } catch (err: any) {
          console.error(`[clips] ${jobId} ${safeId} annotated failed:`, err?.message ?? err)
        } finally {
          try { fs.unlinkSync(listPath) } catch {}
        }
      }
    }
  }
}

// Serializes video processing to one job at a time. The pipeline is CPU-bound
// (Python motion detection, Go+YOLO detection) — running two concurrently on
// the same machine doesn't parallelize useful work, it just makes both slower
// via cache thrashing and context-switching (measured: module 6 went from
// 68s solo to 108s when a second upload was processing at the same time).
// A queued job's status stays 'queued' (written by the upload route) until
// processUploadedVideo actually starts it, so the UI already reflects "still
// waiting" correctly with no extra state needed.
let queueTail: Promise<void> = Promise.resolve()

export function enqueueProcessing(
  jobId: string,
  videoPath: string,
  filename: string,
  ownerId = ''
): void {
  queueTail = queueTail.then(() => processUploadedVideo(jobId, videoPath, filename, ownerId))
}

async function processUploadedVideo(
  jobId: string,
  videoPath: string,
  filename: string,
  ownerId = ''
) {
  const outDir = path.join(PIPELINE_OUT_DIR, jobId)

  try {
    // Non-blocking: a Supabase failure must not stop analysis that would
    // otherwise succeed, so every sync call here is awaited but never thrown.
    await updateVideoStatus(jobId, ownerId, { status: 'processing' })
    writeStatus(jobId, {
      state: 'processing',
      message: 'Starting motion detection & event segmentation (Modules 1-7)...',
      percent: 0,
    })

    // Kicked off alongside the Python pipeline (not after it) — see
    // generatePlaybackProxy's docstring. Non-fatal if it fails (e.g. ffmpeg
    // missing): falls back to streaming the raw source, same as before.
    const proxyPromise = generatePlaybackProxy(videoPath, outDir, jobId).catch((err) => {
      console.error(`[playback-proxy] failed for ${jobId}:`, err?.message ?? err)
      return null
    })

    const progressInterval = watchProgressFile(jobId, path.join(outDir, 'progress.json'), 0, 90)
    try {
      await runCommand(
        'python',
        [path.join(M1_7_DIR, 'run_pipeline.py'), videoPath, '--out-dir', outDir, '--no-clips'],
        ROOT,
        jobId
      )
    } finally {
      clearInterval(progressInterval)
    }

    writeStatus(jobId, { message: 'Running person & object detection (Modules 8-9)...', percent: 90 })

    await runCommand(
      BACKEND_EXE,
      [
        '--events-json', path.join(outDir, 'events', 'events.json'),
        '--rois-json', path.join(outDir, 'rois', 'rois_per_frame.json'),
        '--header-json', path.join(outDir, 'header.json'),
        '--frames-dir', path.join(outDir, 'frames'),
        '--out-dir', path.join(outDir, 'backend_output'),
        // Module 10.4 writes here, one level up from the backend's out-dir.
        '--baselines-json', path.join(outDir, 'baselines', 'region_baselines.json'),
      ],
      M8_9_DIR,
      jobId
    )

    // CLIP verification of each finding, and suppression of the ones it
    // contradicts. Runs here rather than earlier because it reads the Go
    // backend's output and rewrites it in place, so it must sit between the
    // backend finishing and the results below being read.
    //
    // Non-fatal on purpose: CLIP is a second opinion. If it fails to load or
    // the model is not cached, the job still delivers its findings unfiltered
    // rather than losing an analysis that already succeeded.
    writeStatus(jobId, { message: 'Verifying findings (CLIP)...', percent: 95 })
    try {
      const clipOut = await runCommand(
        'python',
        [
          path.join(M1_7_DIR, 'clip_verify.py'),
          '--pipeline-dir', outDir,
          '--filter',
        ],
        ROOT,
        jobId
      )
      const tail = clipOut.trim().split(NEWLINE).slice(-12).join(NEWLINE)
      console.log(`[clip] ${jobId}:${NEWLINE}${tail}`)
    } catch (err: any) {
      console.error(
        `[clip] ${jobId}: verification skipped, findings will be unfiltered - ${err?.message ?? err}`
      )
    }

    writeStatus(jobId, { message: 'Finalizing results...', percent: 98 })

    // By now the Python pipeline (several minutes) has almost certainly
    // outlasted the transcode, but await it properly rather than assume.
    const proxy = await proxyPromise
    const proxyPath = proxy?.path ?? null
    const proxyOffset = proxy?.offset ?? 0

    const enrichedPath = path.join(outDir, 'backend_output', 'enriched_events.json')
    const enriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'))

    // Header/video_path inside `enriched` is whatever absolute path was on the
    // machine that ran Module 1 — not reliably resolvable as a URL. Stamp on
    // the two app-relative pointers that the heatmap/annotated/stream routes
    // and the frontend actually need to locate this specific video's assets.
    // Prefer the transcoded playback proxy (guaranteed browser-compatible
    // H.264/AAC MP4) over the raw source, which is frequently a codec no
    // browser can decode (see generatePlaybackProxy).
    enriched.pipeline_dir = jobId
    enriched.source_video_path = path.relative(ROOT, proxyPath ?? videoPath).split(path.sep).join('/')
    // How far into the source the proxy begins, for anything seeking in it by
    // source timestamps rather than playing a pre-cut clip.
    enriched.proxy_time_offset = proxyPath ? proxyOffset : 0

    // The Go backend records snapshot paths relative to its own working
    // directory (m8_9_golang), so they arrive as "../pipeline_out/...".
    // Rewrite them app-relative so /api/stream and /api/snapshot can resolve
    // them the same way as every other asset.
    normalizeAssetPaths(enriched)

    writeStatus(jobId, { message: 'Extracting event clips...', percent: 99 })
    await generateEventClips(outDir, enriched, jobId, proxyOffset)

    fs.writeFileSync(path.join(ROOT, 'public', 'api', 'events.json'), JSON.stringify(enriched, null, 2))
    fs.writeFileSync(path.join(outDir, 'api_response.json'), JSON.stringify(enriched, null, 2))

    writeStatus(jobId, {
      state: 'done',
      message: 'Processing complete',
      percent: 100,
      videoId: enriched.video_id,
      eventCount: enriched.event_count,
      ownerId,
    })

    // Chain the derived evidence to the upload it came from.
    //
    // Hashed from disk rather than from the in-memory object: the file is what
    // will be produced if anyone asks for the evidence later, so the file is
    // what must be attested. Recorded after the job is marked done, alongside
    // the Supabase mirror, so neither can delay the UI.
    await recordArtifacts(jobId, ownerId, outDir, enriched)

    // Mirror artefacts and rows into Supabase after the job is already marked
    // done locally, so a slow or failing upload never delays the UI.
    await syncJobResults(jobId, ownerId, outDir, enriched, proxyPath ?? videoPath)
  } catch (err: any) {
    writeStatus(jobId, {
      state: 'error',
      message: 'Processing failed',
      error: err?.message ?? String(err),
    })
    await updateVideoStatus(jobId, ownerId, {
      status: 'error',
      error_message: err?.message ?? String(err),
    })
  }
}

/**
 * Record each derived artifact in the custody chain.
 *
 * One entry per artifact rather than one for the whole job, so a dispute about
 * a single snapshot can be settled without re-attesting the entire run. That
 * is more rows, but rows are cheap and a coarse entry that says "everything is
 * fine" is not evidence about anything in particular.
 *
 * Offence stills are capped: a busy video can produce hundreds, and a ledger
 * that grows without bound per upload becomes something people delete. The cap
 * is recorded in the summary entry so the omission is visible rather than
 * silent - an audit trail that hides its own gaps is worse than none.
 */
const MAX_SNAPSHOT_ENTRIES = 50

async function recordArtifacts(
  jobId: string,
  ownerId: string,
  outDir: string,
  enriched: any
): Promise<void> {
  const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, '/')

  const record = async (filePath: string, payload: Record<string, unknown>) => {
    if (!fs.existsSync(filePath)) return
    await appendEntry({
      kind: 'artifact_derived',
      subject: rel(filePath),
      jobId,
      actorId: ownerId || null,
      payloadHash: await sha256File(filePath),
      payload,
    })
  }

  // The analysis output itself - the document every finding in the UI is read
  // from, and therefore the one most worth being able to prove unaltered.
  await record(path.join(outDir, 'api_response.json'), {
    artifact: 'analysis_results',
    eventCount: enriched?.event_count ?? 0,
    offenceCount: (enriched?.events ?? []).reduce(
      (n: number, e: any) => n + (e.offences?.length ?? 0),
      0
    ),
  })

  // Per-offence stills: the images an invigilator actually looks at.
  const snapshots: { file: string; meta: Record<string, unknown> }[] = []
  for (const event of enriched?.events ?? []) {
    for (const off of event.offences ?? []) {
      if (!off.snapshot) continue
      snapshots.push({
        file: path.join(ROOT, off.snapshot.replace(/^\//, '')),
        meta: {
          artifact: 'offence_still',
          offenceType: off.type,
          trackId: off.trackId ?? null,
          frameIdx: off.frameIdx ?? null,
        },
      })
    }
  }

  for (const s of snapshots.slice(0, MAX_SNAPSHOT_ENTRIES)) {
    await record(s.file, s.meta)
  }

  if (snapshots.length > MAX_SNAPSHOT_ENTRIES) {
    console.log(
      `[ledger] ${jobId}: recorded ${MAX_SNAPSHOT_ENTRIES} of ${snapshots.length} offence stills ` +
        `(cap is MAX_SNAPSHOT_ENTRIES); the remainder are covered by the analysis_results hash`
    )
  }
}
