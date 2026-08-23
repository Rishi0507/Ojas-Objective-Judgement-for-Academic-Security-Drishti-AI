import { NextRequest, NextResponse } from 'next/server'
import { readStatus } from '@/lib/pipelineJobs'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('job')
  if (!jobId) {
    return NextResponse.json({ error: 'Missing job id' }, { status: 400 })
  }

  const status = readStatus(jobId)
  if (!status) {
    return NextResponse.json({ error: 'Unknown job id' }, { status: 404 })
  }

  return NextResponse.json(status)
}
