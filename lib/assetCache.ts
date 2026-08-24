import fs from 'fs'

/**
 * Cache headers for per-video assets served from stable, video-independent
 * URLs (/api/heatmap, /api/annotated?frame=N, /api/snapshot?path=...).
 *
 * These URLs do not identify which video they belong to -  /api/heatmap is the
 * same URL whatever the active video is, and frame numbers repeat across
 * videos. With a plain `max-age`, switching the active video left the browser
 * showing the PREVIOUS video's heatmap and frames until the TTL expired.
 *
 * `no-cache` does not mean "don't cache": it means "revalidate before use".
 * The browser keeps the bytes and sends If-None-Match, so an unchanged asset
 * still costs a 304 with no body -  nearly as cheap as a hit -  while a changed
 * one is refetched immediately.
 */
export function assetHeaders(filePath: string, contentType: string): HeadersInit {
  const stat = fs.statSync(filePath)
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
    ETag: `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
  }
}

/** ETag for a file, matching what assetHeaders sends. */
export function assetETag(filePath: string): string {
  const stat = fs.statSync(filePath)
  return `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
}

/** True when the client already holds this exact version. */
export function isFresh(request: Request, etag: string): boolean {
  const ifNoneMatch = request.headers.get('if-none-match')
  return !!ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim() === etag)
}
