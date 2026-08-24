/**
 * The identity of a single finding, used as the key a reviewer's verdict is
 * stored under.
 *
 * Scoped by job because the findings list now spans every processed video on
 * the machine. Track ids restart at Track-01 in each video and frame indices
 * restart at 0, so `Track-01|head_turn|64` is a key two different videos can
 * both produce - and confirming one would silently confirm the other. Nothing
 * in the current data collides, which is exactly why this is worth fixing now:
 * the failure would appear later as a verdict nobody set.
 *
 * Every reader and writer of the verdict store must use this one function.
 * The format was previously copy-pasted into EventsList, /api/report and
 * /api/calibration, which is how it came to be scoped wrongly in the first
 * place.
 */
export interface OffenceIdentity {
  trackId?: string | null
  /** Optional so callers with loosely-typed pipeline JSON can pass through. */
  type?: string
  frameIdx?: number | null
}

export function offenceKey(o: OffenceIdentity, jobId?: string | null): string {
  const base = `${o.trackId ?? 'none'}|${o.type}|${o.frameIdx}`
  return jobId ? `${jobId}::${base}` : base
}
