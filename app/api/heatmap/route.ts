import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const heatmapPath = path.join(process.cwd(), 'pipeline_out/cctv_video/events/heatmap.png');
    
    if (!fs.existsSync(heatmapPath)) {
      return NextResponse.json({ error: 'Heatmap not found' }, { status: 404 });
    }
    
    const imageBuffer = fs.readFileSync(heatmapPath);
    
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Error serving heatmap:', error);
    return NextResponse.json({ error: 'Failed to load heatmap' }, { status: 500 });
  }
}
