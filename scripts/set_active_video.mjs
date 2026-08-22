/**
 * Re-cuts event clips for an already-processed job and makes it the active
 * video, without re-running the expensive Modules 1-9 stages.
 *
 * Needed because the clip-timing fix (gap-aware holds + CFR encode) landed
 * after some jobs were processed, and because the active-video pointer
 * (public/api/events.json) is overwritten by whichever upload finished last.
 *
 * Usage: node scripts/set_active_video.mjs <pipeline_out/dirname>
 */
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

const ROOT = process.cwd()
const jobId = process.argv[2]?.replace(/^pipeline_out[\\/]/, '')
if (!jobId) {
  console.error('Usage: node scripts/set_active_video.mjs <pipeline_out/dirname>')
  process.exit(1)
}

const outDir = path.join(ROOT, 'pipeline_out', jobId)
const clipsDir = path.join(outDir, 'clips')
const annotatedDir = path.join(outDir, 'backend_output', 'annotated')
const playbackPath = path.join(outDir, 'playback.mp4')
const enrichedPath = path.join(outDir, 'backend_output', 'enriched_events.json')

for (const p of [outDir, playbackPath, enrichedPath]) {
  if (!fs.existsSync(p)) {
    console.error(`Missing: ${p}`)
    process.exit(1)
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}\n${out.split('\n').slice(-8).join('\n')}`))
    )
  })
}

const enriched = JSON.parse(fs.readFileSync(enrichedPath, 'utf-8'))
const events = enriched.events ?? []
const fps = Number(enriched?.metadata?.fps) || 0

const annotatedFrames = fs.existsSync(annotatedDir)
  ? fs
      .readdirSync(annotatedDir)
      .filter((f) => f.endsWith('.jpg'))
      .map((f) => ({ file: f, idx: parseInt(f.match(/(\d+)\.jpg$/)?.[1] ?? '-1', 10) }))
      .filter((f) => f.idx >= 0)
      .sort((a, b) => a.idx - b.idx)
  : []

fs.mkdirSync(clipsDir, { recursive: true })
const NEWLINE = String.fromCharCode(10)
const MIN_HOLD = 0.04

for (const ev of events) {
  const start = Number(ev.start) || 0
  const duration = Math.max(0.5, (Number(ev.end) || 0) - start)
  const eventEnd = start + duration
  const safeId = String(ev.id ?? 'event').replace(/[^a-zA-Z0-9_-]/g, '_')

  const clipPath = path.join(clipsDir, `${safeId}.mp4`)
  await run('ffmpeg', [
    '-y', '-ss', start.toFixed(3), '-i', playbackPath, '-t', duration.toFixed(3),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-an', '-movflags', '+faststart', clipPath,
  ])
  ev.clipUrl = path.relative(ROOT, clipPath).split(path.sep).join('/')
  ev.annotatedClipUrl = ''

  if (annotatedFrames.length && fps > 0) {
    const inWindow = annotatedFrames.filter((f) => {
      const t = f.idx / fps
      return t >= start && t <= eventEnd
    })
    if (inWindow.length >= 2) {
      const frameTimes = inWindow.map((f) => f.idx / fps)
      const listBody = inWindow
        .map((f, i) => {
          const from = i === 0 ? start : frameTimes[i]
          const to = i === inWindow.length - 1 ? eventEnd : frameTimes[i + 1]
          const hold = Math.max(MIN_HOLD, to - from)
          const framePath = path.join(annotatedDir, f.file).split(path.sep).join('/')
          return `file '${framePath}'` + NEWLINE + `duration ${hold.toFixed(3)}`
        })
        .join(NEWLINE)
      const lastFile = path.join(annotatedDir, inWindow[inWindow.length - 1].file).split(path.sep).join('/')
      const listPath = path.join(clipsDir, `${safeId}_frames.txt`)
      fs.writeFileSync(listPath, `${listBody}${NEWLINE}file '${lastFile}'${NEWLINE}`)

      const annPath = path.join(clipsDir, `${safeId}_annotated.mp4`)
      try {
        await run('ffmpeg', [
          '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
          '-fps_mode', 'cfr', '-r', String(fps),
            // Hard-cap at the event length. CFR fills the holds by duplicating
            // frames and can overrun by a few seconds on sparse events; -t trims
            // the tail so clip length always equals the window exactly.
            '-t', duration.toFixed(3),
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-movflags', '+faststart', annPath,
        ])
        ev.annotatedClipUrl = path.relative(ROOT, annPath).split(path.sep).join('/')
      } finally {
        try { fs.unlinkSync(listPath) } catch {}
      }
    }
  }
  console.log(`  ${ev.id}: clip=${!!ev.clipUrl} annotated=${!!ev.annotatedClipUrl}`)
}

// Snapshot paths are recorded relative to the Go backend's own cwd.
const toAppRelative = (p) => {
  const n = String(p).replace(/\\/g, '/')
  const i = n.indexOf('pipeline_out/')
  return i >= 0 ? n.slice(i) : n
}
for (const ev of events) {
  if (Array.isArray(ev.snapshots)) ev.snapshots = ev.snapshots.map(toAppRelative)
  for (const off of ev.offences ?? []) if (off.snapshot) off.snapshot = toAppRelative(off.snapshot)
}

enriched.pipeline_dir = jobId
enriched.source_video_path = path.relative(ROOT, playbackPath).split(path.sep).join('/')

fs.writeFileSync(path.join(ROOT, 'public', 'api', 'events.json'), JSON.stringify(enriched, null, 2))
fs.writeFileSync(path.join(outDir, 'api_response.json'), JSON.stringify(enriched, null, 2))
console.log(`\nActive video is now: ${jobId} (${events.length} events)`)
