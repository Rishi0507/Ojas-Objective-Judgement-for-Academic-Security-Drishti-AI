import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getCurrentPipelineDir } from '@/lib/currentVideo';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const frame = searchParams.get('frame');

    if (!frame) {
      return NextResponse.json({ error: 'Frame parameter required' }, { status: 400 });
    }

    const pipelineDir = getCurrentPipelineDir();

    // Path to annotated frame
    const framePath = path.join(
      process.cwd(),
      `pipeline_out/${pipelineDir}/backend_output/annotated`,
      `annotated_frame_${frame.padStart(7, '0')}.jpg`
    );

    // Check if file exists
    if (!fs.existsSync(framePath)) {
      // Return original frame if annotated doesn't exist. Frame filenames
      // follow `<videoID>__f<7-digit idx>__t<timestamp>.jpg` (Module 2) —
      // match by substring instead of a glob dependency.
      const framesDir = path.join(process.cwd(), `pipeline_out/${pipelineDir}/frames`);
      const needle = `__f${frame.padStart(7, '0')}__`;
      const match = fs.existsSync(framesDir)
        ? fs.readdirSync(framesDir).find((f) => f.includes(needle) && f.endsWith('.jpg'))
        : undefined;

      if (match) {
        const imageBuffer = fs.readFileSync(path.join(framesDir, match));
        return new NextResponse(imageBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }

      return NextResponse.json({ error: 'Frame not found' }, { status: 404 });
    }
    
    // Serve annotated frame
    const imageBuffer = fs.readFileSync(framePath);
    
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
        'X-Annotated': 'true',
      },
    });
  } catch (error) {
    console.error('Error serving annotated frame:', error);
    return NextResponse.json({ error: 'Failed to load frame' }, { status: 500 });
  }
}
