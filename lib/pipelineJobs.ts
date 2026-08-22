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

export async function processUploadedVideo(jobId: string, videoPath: string, filename: string) {
  const outDir = path.join(PIPELINE_OUT_DIR, jobId)

  try {
    writeStatus(jobId, {
      state: 'processing',
      message: 'Running motion detection & event segmentation (Modules 1-7)... this can take a few minutes',
    })

    await runCommand(
      'python',
      [path.join(M1_7_DIR, 'run_pipeline.py'), videoPath, '--out-dir', outDir, '--no-clips'],
      ROOT
    )

    writeStatus(jobId, { message: 'Running person & object detection (Modules 8-9)...' })

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

    writeStatus(jobId, { message: 'Finalizing results...' })

    const enrichedPath = path.join(outDir, 'backend_output', 'enriched_events.json')
    const enriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'))

    fs.writeFileSync(path.join(ROOT, 'public', 'api', 'events.json'), JSON.stringify(enriched, null, 2))
    fs.writeFileSync(path.join(outDir, 'api_response.json'), JSON.stringify(enriched, null, 2))

    writeStatus(jobId, {
      state: 'done',
      message: 'Processing complete',
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
