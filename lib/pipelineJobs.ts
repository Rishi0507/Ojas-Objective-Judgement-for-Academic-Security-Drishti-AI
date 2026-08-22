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

function runCommand(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { out += d.toString() })
    child.on('error', (err) => reject(new Error(`Failed to start ${cmd}: ${err.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(`${path.basename(cmd)} exited with code ${code}\n${out.split('\n').slice(-20).join('\n')}`))
    })
  })
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

export async function processUploadedVideo(jobId: string, videoPath: string, filename: string) {
  const outDir = path.join(PIPELINE_OUT_DIR, jobId)

  try {
    writeStatus(jobId, {
      state: 'processing',
      message: 'Starting motion detection & event segmentation (Modules 1-7)...',
      percent: 0,
    })

    const progressInterval = watchProgressFile(jobId, path.join(outDir, 'progress.json'), 0, 90)
    try {
      await runCommand(
        'python',
        [path.join(M1_7_DIR, 'run_pipeline.py'), videoPath, '--out-dir', outDir, '--no-clips'],
        ROOT
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
      M8_9_DIR
    )

    writeStatus(jobId, { message: 'Finalizing results...', percent: 98 })

    const enrichedPath = path.join(outDir, 'backend_output', 'enriched_events.json')
    const enriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'))

    // Header/video_path inside `enriched` is whatever absolute path was on the
    // machine that ran Module 1 — not reliably resolvable as a URL. Stamp on
    // the two app-relative pointers that the heatmap/annotated/stream routes
    // and the frontend actually need to locate this specific video's assets.
    enriched.pipeline_dir = jobId
    enriched.source_video_path = path.relative(ROOT, videoPath).split(path.sep).join('/')

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
