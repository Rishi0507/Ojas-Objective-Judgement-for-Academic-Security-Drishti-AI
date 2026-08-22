import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

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
async function generatePlaybackProxy(videoPath: string, outDir: string, jobId: string): Promise<string> {
  const outPath = path.join(outDir, 'playback.mp4')
  const [videoCodec, audioCodec] = await Promise.all([
    probeCodec(videoPath, 'v:0'),
    probeCodec(videoPath, 'a:0'),
  ])

  const videoArgs = videoCodec && BROWSER_SAFE_VIDEO_CODECS.has(videoCodec)
    ? ['-c:v', 'copy']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']

  const audioArgs = !audioCodec
    ? ['-an']
    : BROWSER_SAFE_AUDIO_CODECS.has(audioCodec)
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '128k']

  await runCommand('ffmpeg', [
    '-y', '-i', videoPath,
    ...videoArgs,
    ...audioArgs,
    '-movflags', '+faststart',
    outPath,
  ], ROOT, jobId)

  return outPath
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
  jobId: string
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
    const safeId = String(ev.id ?? 'event').replace(/[^a-zA-Z0-9_-]/g, '_')

    // ---- plain clip ----
    const clipPath = path.join(clipsDir, `${safeId}.mp4`)
    try {
      await runCommand('ffmpeg', [
        '-y',
        '-ss', start.toFixed(3),
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
        // Sampled frames are sparse and unevenly spaced, so drive ffmpeg
        // with a concat list at a fixed display rate rather than pretending
        // they're a contiguous numbered sequence.
        const listPath = path.join(clipsDir, `${safeId}_frames.txt`)
        const listBody = inWindow
          .map((f) => `file '${path.join(annotatedDir, f.file).replace(/\\/g, '/')}'\nduration 0.2`)
          .join('\n')
        // concat demuxer ignores the final entry's duration unless the last
        // file is repeated, otherwise the closing frame is dropped.
        const lastFile = path.join(annotatedDir, inWindow[inWindow.length - 1].file).replace(/\\/g, '/')
        fs.writeFileSync(listPath, `${listBody}\nfile '${lastFile}'\n`)

        const annPath = path.join(clipsDir, `${safeId}_annotated.mp4`)
        try {
          await runCommand('ffmpeg', [
            '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
            '-vsync', 'vfr',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
            // yuv420p + even dimensions, or browsers refuse to decode it.
            '-pix_fmt', 'yuv420p',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-movflags', '+faststart',
            annotatedClipPath,
          ], ROOT, jobId)
          ev.annotatedClipUrl = path.relative(ROOT, annotatedClipPath).split(path.sep).join('/')
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

export function enqueueProcessing(jobId: string, videoPath: string, filename: string): void {
  queueTail = queueTail.then(() => processUploadedVideo(jobId, videoPath, filename))
}

async function processUploadedVideo(jobId: string, videoPath: string, filename: string) {
  const outDir = path.join(PIPELINE_OUT_DIR, jobId)

  try {
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
      ],
      M8_9_DIR,
      jobId
    )

    writeStatus(jobId, { message: 'Finalizing results...', percent: 98 })

    // By now the Python pipeline (several minutes) has almost certainly
    // outlasted the transcode, but await it properly rather than assume.
    const proxyPath = await proxyPromise

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

    // The Go backend records snapshot paths relative to its own working
    // directory (m8_9_golang), so they arrive as "../pipeline_out/...".
    // Rewrite them app-relative so /api/stream and /api/snapshot can resolve
    // them the same way as every other asset.
    normalizeAssetPaths(enriched)

    writeStatus(jobId, { message: 'Extracting event clips...', percent: 99 })
    await generateEventClips(outDir, enriched, jobId)

    fs.writeFileSync(path.join(ROOT, 'public', 'api', 'events.json'), JSON.stringify(enriched, null, 2))
    fs.writeFileSync(path.join(outDir, 'api_response.json'), JSON.stringify(enriched, null, 2))

    writeStatus(jobId, {
      state: 'done',
      message: 'Processing complete',
      percent: 100,
      videoId: enriched.video_id,
      eventCount: enriched.event_count,
    })
  } catch (err: any) {
    writeStatus(jobId, {
      state: 'error',
      message: 'Processing failed',
      error: err?.message ?? String(err),
    })
  }
}
