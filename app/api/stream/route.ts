import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const clipPath = searchParams.get('path');
    
    if (!clipPath) {
      return NextResponse.json({ error: 'No path specified' }, { status: 400 });
    }
    
    // Construct full path
    const fullPath = path.join(process.cwd(), clipPath);
    
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }
    
    const stat = fs.statSync(fullPath);
    const fileSize = stat.size;
    const range = request.headers.get('range');
    const contentType = CONTENT_TYPES[path.extname(fullPath).toLowerCase()] ?? 'application/octet-stream';

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(fullPath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize.toString(),
        'Content-Type': contentType,
      };

      return new NextResponse(file as any, { status: 206, headers: head });
    } else {
      const head = {
        'Content-Length': fileSize.toString(),
        'Content-Type': contentType,
      };
      const file = fs.createReadStream(fullPath);
      return new NextResponse(file as any, { status: 200, headers: head });
    }
  } catch (error) {
    console.error('Error streaming video:', error);
    return NextResponse.json({ error: 'Failed to stream video' }, { status: 500 });
  }
}
