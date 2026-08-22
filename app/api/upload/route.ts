import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { ensureDirs, slugify, writeStatus, enqueueProcessing } from '@/lib/pipelineJobs'
import { createClient } from '@/lib/supabase/server'
import { createVideoRow } from '@/lib/supabase/sync'

const ALLOWED_EXTENSIONS = ['.mp4', '.mkv', '.mov', '.avi', '.webm']
const MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024 // 2GB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('video') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No video file provided' }, { status: 400 })
    }

    const ext = path.extname(file.name).toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` },
        { status: 400 }
      )
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: 'File exceeds 2GB limit' }, { status: 400 })
    }

    ensureDirs()

    const jobId = slugify(file.name)
    const savedName = `${jobId}${ext}`
    const savedPath = path.join(process.cwd(), 'uploads', savedName)

    const buffer = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(savedPath, buffer)

    // Attribute the job to the signed-in user, if there is one. Uploading
    // without a session still works and stays local-only, so the app remains
    // usable before Supabase is configured.
    let ownerId = ''
    try {
      const supabase = createClient()
      const { data } = await supabase.auth.getUser()
      ownerId = data.user?.id ?? ''
    } catch {
      // Supabase not configured - local-only run.
    }

    writeStatus(jobId, {
      state: 'queued',
      message: 'Upload received, queued for processing',
      filename: file.name,
      startedAt: new Date().toISOString(),
      ownerId,
    })

    await createVideoRow(jobId, ownerId, file.name)

    // Queued (not fired immediately): the pipeline is CPU-bound, so videos
    // process one at a time. The dev/production server process stays alive
    // for the duration of the multi-minute pipeline, so this continues
    // after the response below is sent regardless of queue position.
    enqueueProcessing(jobId, savedPath, file.name, ownerId)

    return NextResponse.json({ jobId, filename: file.name }, { status: 202 })
  } catch (error: any) {
    console.error('Upload failed:', error)
    return NextResponse.json({ error: error?.message ?? 'Upload failed' }, { status: 500 })
  }
}
