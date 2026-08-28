import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
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

/**
 * Roots a `path` parameter may resolve inside.
 *
 * Two, because playback legitimately spans both: clipUrl and annotatedClipUrl
 * are rewritten app-root relative into pipeline_out/ (lib/pipelineJobs.ts), and
 * the full-recording fallback is source_video_path, which is the uploaded file
 * under uploads/ whenever no playback proxy was generated.
 */
const ALLOWED_ROOTS = ['pipeline_out', 'uploads'];

/**
 * Resolves a caller-supplied relative path and confines it to ALLOWED_ROOTS.
 *
 * path.join() alone does not do this: it normalises `../` rather than rejecting
 * it, so a crafted `path` resolved out of the working directory and this route
 * served the file back, for any file type, to anyone who could reach it. The
 * containment test is the one already used by app/api/snapshot/route.ts.
 *
 * Comparing against `root + sep` rather than `root` matters: a bare prefix test
 * would also accept a sibling directory whose name merely starts with an
 * allowed one.
 */
function resolveWithinAllowedRoots(rel: string): string | null {
  const cwd = process.cwd();
  const full = path.resolve(cwd, rel);

  for (const root of ALLOWED_ROOTS) {
    const allowed = path.resolve(cwd, root);
    if (full === allowed || full.startsWith(allowed + path.sep)) {
      return full;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const clipPath = searchParams.get('path');
    
    if (!clipPath) {
      return NextResponse.json({ error: 'No path specified' }, { status: 400 });
    }

    const fullPath = resolveWithinAllowedRoots(clipPath);
    if (!fullPath) {
      // Deliberately not echoing the path back, and not distinguishing this
      // from a miss beyond the status code: a traversal attempt should learn
      // nothing about the filesystem it was aimed at.
      console.warn(`[stream] rejected out-of-bounds path: ${clipPath}`);
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // A directory has a size and would otherwise reach the range logic below.
    if (!fs.statSync(fullPath).isFile()) {
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
