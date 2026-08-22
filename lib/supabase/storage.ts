import fs from 'fs'
import path from 'path'
import { createServiceClient } from './server'

/**
 * Mirrors a finished job's artefacts into Supabase Storage.
 *
 * Deliberately best-effort and non-blocking: the pipeline's source of truth
 * stays the local filesystem, and the app keeps working with Supabase absent,
 * misconfigured, or offline. A failed upload logs and moves on rather than
 * failing a job whose analysis already succeeded.
 *
 * Layout is `<ownerId>/<jobId>/...`, because the storage RLS policies key
 * ownership off the first path segment.
 */

const ROOT = process.cwd()

export interface MirrorResult {
  enabled: boolean
  uploaded: number
  failed: number
  paths: {
    source?: string
    playback?: string
    heatmap?: string
    clips: string[]
    snapshots: string[]
  }
}

async function upload(
  supabase: any,
  bucket: string,
  objectPath: string,
  localPath: string,
  contentType: string
): Promise<boolean> {
  try {
    if (!fs.existsSync(localPath)) return false
    const body = fs.readFileSync(localPath)
    const { error } = await supabase.storage
      .from(bucket)
      .upload(objectPath, body, { contentType, upsert: true })
    if (error) {
      console.error(`[storage] ${bucket}/${objectPath}: ${error.message}`)
      return false
    }
    return true
  } catch (err: any) {
    console.error(`[storage] ${bucket}/${objectPath}: ${err?.message ?? err}`)
    return false
  }
}

export async function mirrorJobToStorage(
  jobId: string,
  ownerId: string,
  outDir: string,
  sourceVideoPath?: string
): Promise<MirrorResult> {
  const result: MirrorResult = {
    enabled: false,
    uploaded: 0,
    failed: 0,
    paths: { clips: [], snapshots: [] },
  }

  const supabase = createServiceClient()
  if (!supabase || !ownerId) return result // no service key, or anonymous run
  result.enabled = true

  const prefix = `${ownerId}/${jobId}`
  const tally = (ok: boolean) => {
    if (ok) result.uploaded++
    else result.failed++
    return ok
  }

  // ---- source + playback proxy ----
  if (sourceVideoPath && fs.existsSync(sourceVideoPath)) {
    const name = `${prefix}/source${path.extname(sourceVideoPath)}`
    if (tally(await upload(supabase, 'videos', name, sourceVideoPath, 'video/mp4'))) {
      result.paths.source = name
    }
  }

  const playback = path.join(outDir, 'playback.mp4')
  if (fs.existsSync(playback)) {
    const name = `${prefix}/playback.mp4`
    if (tally(await upload(supabase, 'videos', name, playback, 'video/mp4'))) {
      result.paths.playback = name
    }
  }

  // ---- heatmap ----
  const heatmap = path.join(outDir, 'events', 'heatmap.png')
  if (fs.existsSync(heatmap)) {
    const name = `${prefix}/heatmap.png`
    if (tally(await upload(supabase, 'videos', name, heatmap, 'image/png'))) {
      result.paths.heatmap = name
    }
  }

  // ---- event clips ----
  const clipsDir = path.join(outDir, 'clips')
  if (fs.existsSync(clipsDir)) {
    for (const file of fs.readdirSync(clipsDir).filter((f) => f.endsWith('.mp4'))) {
      const name = `${prefix}/${file}`
      if (tally(await upload(supabase, 'clips', name, path.join(clipsDir, file), 'video/mp4'))) {
        result.paths.clips.push(name)
      }
    }
  }

  // ---- evidence stills ----
  // Only offence stills and snapshots, not the whole annotated frame set:
  // those run to hundreds of images per job and are reproducible from the
  // frames on disk, so uploading them buys nothing but egress.
  for (const sub of ['snapshots', 'offence_stills']) {
    const dir = path.join(outDir, 'backend_output', sub)
    if (!fs.existsSync(dir)) continue
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.jpg'))) {
      const name = `${prefix}/${sub}/${file}`
      if (tally(await upload(supabase, 'snapshots', name, path.join(dir, file), 'image/jpeg'))) {
        result.paths.snapshots.push(name)
      }
    }
  }

  console.log(
    `[storage] ${jobId}: ${result.uploaded} uploaded, ${result.failed} failed`
  )
  return result
}

/**
 * Short-lived signed URL for a private object.
 *
 * Buckets are private, so this is how media reaches the browser. One hour is
 * long enough for a review session and short enough that a URL pasted into a
 * chat stops working before it spreads.
 */
export async function signedUrl(
  bucket: string,
  objectPath: string,
  expiresIn = 3600
): Promise<string | null> {
  const supabase = createServiceClient()
  if (!supabase) return null
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectPath, expiresIn)
  if (error) {
    console.error(`[storage] sign ${bucket}/${objectPath}: ${error.message}`)
    return null
  }
  return data?.signedUrl ?? null
}
