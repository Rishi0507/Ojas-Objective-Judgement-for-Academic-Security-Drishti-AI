import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { appendEntry } from '@/lib/ledger/store'
import { hashDocument } from '@/lib/ledger/hash'
import { getCurrentPipelineDir } from '@/lib/currentVideo'

/**
 * Removes a processed job's media, in one of two degrees.
 *
 *   mode: 'prune'   discard intermediates only - optical flow and motion
 *                   masks. Measured on this footage: flow alone is 291MB of a
 *                   370MB job, 79% of the total, and nothing reads it once
 *                   Module 7 has run. Findings, evidence stills, clips and
 *                   results all survive, so the job stays fully reviewable.
 *
 *   mode: 'delete'  remove the job entirely, evidence included.
 *
 * Both are recorded in the custody ledger before the files go. Removing
 * evidence is precisely the act an audit trail must not be silent about, and
 * ledger entries reference job_id as plain text rather than a foreign key so
 * the record outlives what it describes.
 *
 * The ledger itself is never touched.
 */

const ROOT = process.cwd()

/** Directories safe to discard after Module 7: written during the run, read by nothing after it. */
const INTERMEDIATE_DIRS = ['flow', 'masks', 'cleaned_masks']

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const jobId = String(body?.jobId ?? '')
    const mode = body?.mode === 'delete' ? 'delete' : 'prune'

    // basename() strips any separator on either platform, so a mismatch means
    // the input contained one and must not become a path.
    if (!jobId || jobId === '..' || path.basename(jobId) !== jobId) {
      return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 })
    }

    const jobDir = path.join(ROOT, 'pipeline_out', jobId)
    if (!fs.existsSync(jobDir)) {
      return NextResponse.json({ error: `No such job: ${jobId}` }, { status: 404 })
    }

    const before = dirSizeMb(jobDir)
    const wasActive = getCurrentPipelineDir() === jobId

    // Record BEFORE deleting. If the ledger write fails the files stay, which
    // is the safe direction: an unrecorded deletion is worse than a deletion
    // that did not happen.
    const record = {
      jobId,
      mode,
      sizeMbBefore: before,
      removed: mode === 'delete' ? ['<entire job>'] : INTERMEDIATE_DIRS,
    }
    const entry = await appendEntry({
      kind: mode === 'delete' ? 'media_deleted' : 'media_pruned',
      subject: `pipeline_out/${jobId}`,
      jobId,
      payloadHash: hashDocument(record),
      payload: record,
    })
    if (!entry) {
      return NextResponse.json(
        { error: 'Could not record this in the custody ledger, so nothing was removed.' },
        { status: 500 }
      )
    }

    if (mode === 'delete') {
      fs.rmSync(jobDir, { recursive: true, force: true })
      // Also drop the uploaded source, which lives outside pipeline_out.
      for (const f of fs.readdirSync(path.join(ROOT, 'uploads')).filter((n) => n.startsWith(jobId))) {
        try {
          fs.rmSync(path.join(ROOT, 'uploads', f), { force: true })
        } catch {
          // best effort
        }
      }
      // The active pointer would otherwise reference a directory that is gone.
      if (wasActive) {
        try {
          fs.rmSync(path.join(ROOT, 'public', 'api', 'events.json'), { force: true })
        } catch {
          /* nothing to clear */
        }
      }
    } else {
      for (const sub of INTERMEDIATE_DIRS) {
        fs.rmSync(path.join(jobDir, sub), { recursive: true, force: true })
      }
      // The cached size is now wrong; drop it so the next listing recomputes.
      try {
        fs.rmSync(path.join(jobDir, '.summary.json'), { force: true })
      } catch {
        /* not cached yet */
      }
    }

    const after = mode === 'delete' ? 0 : dirSizeMb(jobDir)
    return NextResponse.json({
      ok: true,
      jobId,
      mode,
      freedMb: Math.round((before - after) * 10) / 10,
      ledgerSeq: entry.seq,
      clearedActiveVideo: mode === 'delete' && wasActive,
    })
  } catch (error: any) {
    console.error('Delete failed:', error)
    return NextResponse.json({ error: error?.message ?? 'Delete failed' }, { status: 500 })
  }
}
