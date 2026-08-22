import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const frame = searchParams.get('frame');
    
    if (!frame) {
      return NextResponse.json({ error: 'Frame parameter required' }, { status: 400 });
    }
    
    // Path to annotated frame
    const framePath = path.join(
      process.cwd(),
      'pipeline_out/cctv_video/backend_output/annotated',
      `annotated_frame_${frame.padStart(7, '0')}.jpg`
    );
    
    // Check if file exists
    if (!fs.existsSync(framePath)) {
      // Return original frame if annotated doesn't exist
      const originalPattern = path.join(
        process.cwd(),
        `pipeline_out/cctv_video/frames/*__f${frame.padStart(7, '0')}__*.jpg`
      );
      
      // Try to find original frame
      const glob = require('glob');
      const matches = glob.sync(originalPattern);
      
      if (matches.length > 0 && fs.existsSync(matches[0])) {
        const imageBuffer = fs.readFileSync(matches[0]);
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
