import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getCurrentPipelineDir } from '@/lib/currentVideo';
import { assetETag, isFresh } from '@/lib/assetCache';

export async function GET(request: Request) {
  try {
    // ?job= serves one specific video's heatmap. Without it the URL is the
    // same string for every video and can only mean "whatever is selected",
    // which is why the library list could not show a thumbnail per row.
    const jobId = new URL(request.url).searchParams.get('job');
    if (jobId !== null && (jobId === '' || path.basename(jobId) !== jobId)) {
      return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
    }

    const dir = jobId ?? getCurrentPipelineDir();
    const heatmapPath = path.join(process.cwd(), 'pipeline_out', dir, 'events/heatmap.png');

    if (!fs.existsSync(heatmapPath)) {
      return NextResponse.json({ error: 'Heatmap not found' }, { status: 404 });
    }

    // Revalidate rather than blind-cache: the un-scoped URL is identical for
    // every video, so a plain max-age served the previous video's heatmap
    // after the active video changed.
    const etag = assetETag(heatmapPath);
    if (isFresh(request, etag)) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-cache' } });
    }

    const imageBuffer = fs.readFileSync(heatmapPath);

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache', ETag: etag },
    });
  } catch (error) {
    console.error('Error serving heatmap:', error);
    return NextResponse.json({ error: 'Failed to load heatmap' }, { status: 500 });
  }
}
