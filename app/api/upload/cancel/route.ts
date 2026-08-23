import { NextRequest, NextResponse } from 'next/server'
import { cancelJob } from '@/lib/pipelineJobs'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const jobId = request.nextUrl.searchParams.get('job')
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    }

    cancelJob(jobId)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Error cancelling job:', err)
    return NextResponse.json({ error: 'Failed to cancel job' }, { status: 500 })
  }
}
