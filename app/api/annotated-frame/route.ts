import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
import { getCurrentPipelineDir } from '@/lib/currentVideo';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const frameIdx = searchParams.get('frame');

    if (!frameIdx) {
      return NextResponse.json({ error: 'Frame index required' }, { status: 400 });
    }

    // Path to annotated frame
    const framePath = path.join(
      process.cwd(),
      `pipeline_out/${getCurrentPipelineDir()}/backend_output/annotated`,
      `annotated_frame_${frameIdx.padStart(5, '0')}.jpg`
    );
    
    if (!fs.existsSync(framePath)) {
      // Return 204 No Content if annotated frame doesn't exist
      return new NextResponse(null, { status: 204 });
    }
    
    const imageBuffer = fs.readFileSync(framePath);
    
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Error serving annotated frame:', error);
    return NextResponse.json({ error: 'Failed to load frame' }, { status: 500 });
  }
}
