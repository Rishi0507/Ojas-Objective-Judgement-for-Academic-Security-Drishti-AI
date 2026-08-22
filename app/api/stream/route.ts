import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
/**
 * Bridges a Node fs.ReadStream to a web ReadableStream for NextResponse.
 *
 * Neither handing NextResponse the raw fs.ReadStream nor Readable.toWeb is
 * safe here: both end up calling close() on an already-closed controller when
 * the client goes away mid-response, and that surfaces as an
 * `uncaughtException: ERR_INVALID_STATE` outside the route handler (harmless
 * in dev, process-fatal in production without a global handler). A <video>
 * element aborts a range request on every seek, so this is a normal event,
 * not an edge case.
 *
 * So: guard every close/enqueue behind a `closed` latch, and destroy the fd on
 * cancel so aborted requests don't leak file handles. desiredSize/pull give
 * backpressure, keeping a large file from buffering into memory.
 */
function fileStream(
  fullPath: string,
  opts?: { start: number; end: number },
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const node = fs.createReadStream(fullPath, opts);
  let closed = false;

  // Belt and braces alongside cancel(): if the client goes away, the request's
  // abort signal fires even in cases where the stream's own cancel() does not,
  // and a paused fs stream would otherwise sit holding its fd forever. Leaked
  // readers accumulate across seeks and reloads until the dev server stops
  // serving media at all - observed as a player stuck at readyState 0 with the
  // requests never reaching the route.
  signal?.addEventListener('abort', () => {
    closed = true;
    node.destroy();
  });

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const finish = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed by cancel */ }
      };

      node.on('data', (chunk: string | Buffer) => {
        if (closed) return;
        try {
          controller.enqueue(new Uint8Array(chunk as Buffer));
        } catch {
          closed = true;
          node.destroy();
          return;
        }
        if ((controller.desiredSize ?? 1) <= 0) node.pause();
      });
      node.on('end', finish);
      node.on('close', finish);
      node.on('error', (err) => {
        if (closed) return;
        closed = true;
        try { controller.error(err); } catch { /* consumer already gone */ }
      });
    },
    pull() {
      node.resume();
    },
    cancel() {
      closed = true;
      node.destroy();
    },
  });
}

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
      const file = fileStream(fullPath, { start, end }, request.signal);
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize.toString(),
        'Content-Type': contentType,
      };

      return new NextResponse(file, { status: 206, headers: head });
    } else {
      const head = {
        'Content-Length': fileSize.toString(),
        'Content-Type': contentType,
      };
      const file = fileStream(fullPath, undefined, request.signal);
      return new NextResponse(file, { status: 200, headers: head });
    }
  } catch (error) {
    console.error('Error streaming video:', error);
    return NextResponse.json({ error: 'Failed to stream video' }, { status: 500 });
  }
}
