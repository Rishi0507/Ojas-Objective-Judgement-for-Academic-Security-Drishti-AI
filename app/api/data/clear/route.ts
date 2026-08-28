import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { appendEntry } from '@/lib/ledger/store'
import { hashDocument } from '@/lib/ledger/hash'
import { createClient } from '@/lib/supabase/server'

/**
 * Clears every processed job: pipeline_out/, the uploaded sources, and the
 * pointer at public/api/events.json.
 *
 * This is the widest destructive action in the app, and it used to be the one
 * with the fewest controls: no caller check, and no ledger entry. That made the
 * custody chain only as strong as its weakest deletion path, since
 * app/api/videos/delete records a single job's removal before touching it while
 * this route removed every job silently. Three things follow from that, and
 * they are the whole substance of this file:
 *
 *   1. Recorded first. One media_deleted entry naming every job goes into the
 *      ledger, and nothing is removed if that write fails. An unrecorded
 *      deletion is worse than a deletion that did not happen.
 *
 *   2. The ledger survives it. In local-only mode the chain lives at
 *      pipeline_out/ledger.jsonl (lib/ledger/store.ts), inside the directory
 *      this route empties, so a blanket wipe destroyed the very record of the
 *      wipe. That file is now skipped explicitly.
 *
 *   3. Attributed when it can be. Where Supabase is configured a session is
 *      required and the actor is recorded. Where it is not, the app is in the
 *      local-only mode the rest of the codebase supports, and the entry is
 *      written with a null actor rather than the action being blocked.
 */

const ROOT = process.cwd()

// Must match LEDGER_FILE in lib/ledger/store.ts.
const LEDGER_FILENAME = 'ledger.jsonl'

function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return [] // absent is the same as empty here
  }
}

function dirSizeMb(dir: string): number {
  let total = 0
  const walk = (d: string, depth: number) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      try {
        if (e.isFile()) total += fs.statSync(p).size
        else if (e.isDirectory() && depth > 0) walk(p, depth - 1)
      } catch {
        // vanished mid-walk; the figure is advisory
      }
    }
  }
  walk(dir, 2)
  return Math.round((total / 1e6) * 10) / 10
}

export async function DELETE() {
  try {
    // Supabase configured means auth is available, so require it. Its absence
    // is the documented local-only mode (see middleware.ts), not a bypass.
    const authConfigured = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    )
    let actorId: string | null = null

    if (authConfigured) {
      try {
        const supabase = createClient()
        const { data } = await supabase.auth.getUser()
        actorId = data.user?.id ?? null
      } catch {
        actorId = null
      }
      if (!actorId) {
        return NextResponse.json(
          { error: 'Sign in to clear processed data.' },
          { status: 401 }
        )
      }
    }

    const pipelineOut = path.join(ROOT, 'pipeline_out')
    const uploadsDir = path.join(ROOT, 'uploads')
    const eventsJson = path.join(ROOT, 'public', 'api', 'events.json')

    // The ledger is not a job and is never a deletion target.
    const jobs = listDir(pipelineOut).filter((name) => name !== LEDGER_FILENAME)
    const uploads = listDir(uploadsDir)
    const hadPointer = fs.existsSync(eventsJson)

    // Nothing to remove: return without writing a ledger entry, so repeated
    // clicks on an already-empty install do not pad the chain with no-ops.
    if (jobs.length === 0 && uploads.length === 0 && !hadPointer) {
      return NextResponse.json({
        success: true,
        jobsRemoved: 0,
        uploadsRemoved: 0,
        freedMb: 0,
        ledgerSeq: null,
      })
    }

    const sizeMbBefore = dirSizeMb(pipelineOut)

    // Record BEFORE deleting, matching app/api/videos/delete. If the ledger
    // write fails the files stay, which is the safe direction.
    const record = {
      scope: 'all_jobs',
      jobs,
      uploads,
      clearedActiveVideo: hadPointer,
      sizeMbBefore,
    }
    const entry = await appendEntry({
      kind: 'media_deleted',
      subject: 'pipeline_out/<all jobs>',
      actorId,
      payloadHash: hashDocument(record),
      payload: record,
    })
    if (!entry) {
      return NextResponse.json(
        { error: 'Could not record this in the custody ledger, so nothing was removed.' },
        { status: 500 }
      )
    }

    // 1. Clear pipeline_out, keeping the directory and the chain inside it.
    for (const name of jobs) {
      fs.rmSync(path.join(pipelineOut, name), { recursive: true, force: true })
    }

    // 2. Clear uploads.
    for (const name of uploads) {
      fs.rmSync(path.join(uploadsDir, name), { recursive: true, force: true })
    }

    // 3. Clear the active-video pointer, which now references nothing.
    if (hadPointer) {
      fs.rmSync(eventsJson, { force: true })
    }

    const freedMb = Math.round((sizeMbBefore - dirSizeMb(pipelineOut)) * 10) / 10

    return NextResponse.json({
      success: true,
      jobsRemoved: jobs.length,
      uploadsRemoved: uploads.length,
      freedMb,
      ledgerSeq: entry.seq,
    })
  } catch (err: any) {
    console.error('Error clearing data:', err)
    return NextResponse.json({ error: 'Failed to clear data' }, { status: 500 })
  }
}
