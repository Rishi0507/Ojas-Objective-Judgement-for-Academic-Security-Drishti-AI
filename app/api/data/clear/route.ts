import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function DELETE() {
  try {
    const root = process.cwd()

    // 1. Clear pipeline_out
    const pipelineOut = path.join(root, 'pipeline_out')
    if (fs.existsSync(pipelineOut)) {
      // Delete everything inside but keep the directory itself
      const entries = fs.readdirSync(pipelineOut)
      for (const entry of entries) {
        fs.rmSync(path.join(pipelineOut, entry), { recursive: true, force: true })
      }
    }

    // 2. Clear uploads
    const uploads = path.join(root, 'uploads')
    if (fs.existsSync(uploads)) {
      const entries = fs.readdirSync(uploads)
      for (const entry of entries) {
        fs.rmSync(path.join(uploads, entry), { recursive: true, force: true })
      }
    }

    // 3. Clear public/api/events.json
    const eventsJson = path.join(root, 'public', 'api', 'events.json')
    if (fs.existsSync(eventsJson)) {
      fs.rmSync(eventsJson, { force: true })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Error clearing data:', err)
    return NextResponse.json({ error: 'Failed to clear data' }, { status: 500 })
  }
}
