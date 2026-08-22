import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

/**
 * Serves an auto-captured offence snapshot. Paths are confined to
 * pipeline_out/ so a crafted `path` can't read arbitrary files.
 */
export async function GET(request: NextRequest) {
  try {
    const rel = request.nextUrl.searchParams.get('path')
    if (!rel) {
      return NextResponse.json({ error: 'path required' }, { status: 400 })
    }

    const root = process.cwd()
    const full = path.resolve(root, rel)
    const allowed = path.resolve(root, 'pipeline_out')

    if (!full.startsWith(allowed + path.sep)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!fs.existsSync(full)) {
      return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
    }

    return new NextResponse(fs.readFileSync(full), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    console.error('Error serving snapshot:', error)
    return NextResponse.json({ error: 'Failed to load snapshot' }, { status: 500 })
  }
}
