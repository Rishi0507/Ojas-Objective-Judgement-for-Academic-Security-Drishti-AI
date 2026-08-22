import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    // public/api/events.json is the single "currently active video" pointer —
    // both the initial demo seed and every completed upload (see
    // lib/pipelineJobs.ts) write here, so it always reflects the most
    // recently processed video.
    const currentDataPath = path.join(process.cwd(), 'public', 'api', 'events.json');
    if (fs.existsSync(currentDataPath)) {
      const data = JSON.parse(fs.readFileSync(currentDataPath, 'utf-8'));
      return NextResponse.json(data);
    }

    // Fallback: the original demo clip's output directory, in case
    // public/api/events.json was never seeded.
    const demoDataPath = path.join(process.cwd(), 'pipeline_out', 'cctv_video', 'api_response.json');
    if (fs.existsSync(demoDataPath)) {
      const data = JSON.parse(fs.readFileSync(demoDataPath, 'utf-8'));
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: 'No data available' }, { status: 404 });
  } catch (error) {
    console.error('Error reading video data:', error);
    return NextResponse.json({ error: 'Failed to load data' }, { status: 500 });
  }
}
