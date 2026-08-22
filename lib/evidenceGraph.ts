/**
 * Feature 10.2 — evidence graph.
 *
 * Four isolated clips are weaker evidence than one framed pattern: "this
 * person had 4 related incidents around the same desk". Events are linked
 * into a similarity graph and grouped by connected component, so related
 * incidents can be presented together.
 *
 * Reads only fields the Go backend already emits (trackIds, roi, start) —
 * nothing is recomputed and no event is mutated.
 */

export interface EvidenceGroup {
  group_id: string
  event_ids: string[]
  size: number
  /** Seconds from the first to the last event in the group. */
  span_sec: number
  /** Track IDs common to at least two events in the group. */
  shared_track_ids: string[]
  /** Why these events were linked, for display alongside the group. */
  reasons: string[]
}

/** Intersection-over-union of two [x1,y1,x2,y2] boxes. 0 when either is absent. */
export function iou(a?: number[], b?: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 4 || b.length !== 4) return 0

  const [ax1, ay1, ax2, ay2] = a
  const [bx1, by1, bx2, by2] = b

  const ix1 = Math.max(ax1, bx1)
  const iy1 = Math.max(ay1, by1)
  const ix2 = Math.min(ax2, bx2)
  const iy2 = Math.min(ay2, by2)

  const iw = ix2 - ix1
  const ih = iy2 - iy1
  if (iw <= 0 || ih <= 0) return 0

  const inter = iw * ih
  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1)
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1)
  const union = areaA + areaB - inter
  return union > 0 ? inter / union : 0
}

interface Link {
  reason: string
}

/**
 * Decides whether two events belong to the same story, and says why.
 *
 * A shared person track links them outright — the same individual recurring is
 * the strongest signal available, regardless of when it happened. Otherwise
 * they must be both close in time AND overlapping in space; either alone is
 * too weak, since a fixed camera makes almost every pair of events overlap
 * spatially, and a busy hall makes almost every pair close in time.
 */
function linkBetween(
  e1: any,
  e2: any,
  timeWindow: number,
  spatialThresh: number
): Link | null {
  const t1 = Array.isArray(e1?.trackIds) ? e1.trackIds : []
  const t2 = Array.isArray(e2?.trackIds) ? e2.trackIds : []
  const shared = t1.filter((t: string) => t2.includes(t))
  if (shared.length > 0) {
    return { reason: `shared track ${shared.join(', ')}` }
  }

  const closeInTime = Math.abs(Number(e1?.start ?? 0) - Number(e2?.start ?? 0)) < timeWindow
  const overlap = iou(e1?.roi, e2?.roi)
  if (closeInTime && overlap > spatialThresh) {
    return { reason: `same region (IoU ${overlap.toFixed(2)}) within ${timeWindow}s` }
  }

  return null
}

/**
 * Groups events into connected components of the similarity graph.
 *
 * Implemented as union-find rather than pulling in networkx's JS equivalent:
 * connected components are the only graph operation needed here, and the event
 * count per video is small enough that the pairwise scan is trivial.
 * Single-event components are dropped — a "group" of one is just the event.
 */
export function buildEvidenceGraph(
  events: any[],
  timeWindow = 300,
  spatialThresh = 0.3
): EvidenceGroup[] {
  const n = events.length
  if (n === 0) return []

  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  const reasonsByRoot = new Map<number, Set<string>>()
  const pendingReasons: Array<{ a: number; b: number; reason: string }> = []

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const link = linkBetween(events[i], events[j], timeWindow, spatialThresh)
      if (link) {
        union(i, j)
        pendingReasons.push({ a: i, b: j, reason: link.reason })
      }
    }
  }

  // Reasons are collected after all unions, so each lands on its final root.
  for (const { a, reason } of pendingReasons) {
    const root = find(a)
    if (!reasonsByRoot.has(root)) reasonsByRoot.set(root, new Set())
    reasonsByRoot.get(root)!.add(reason)
  }

  const members = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    if (!members.has(root)) members.set(root, [])
    members.get(root)!.push(i)
  }

  const groups: EvidenceGroup[] = []
  let counter = 0
  for (const [root, idxs] of members) {
    if (idxs.length < 2) continue

    const groupEvents = idxs.map((i) => events[i])
    const starts = groupEvents.map((e) => Number(e?.start ?? 0))
    const ends = groupEvents.map((e) => Number(e?.end ?? 0))

    // A track counts as shared only if more than one event in the group has it.
    const trackCounts = new Map<string, number>()
    for (const e of groupEvents) {
      for (const t of new Set<string>(Array.isArray(e?.trackIds) ? e.trackIds : [])) {
        trackCounts.set(t, (trackCounts.get(t) ?? 0) + 1)
      }
    }

    groups.push({
      group_id: `G${String(counter).padStart(2, '0')}`,
      event_ids: groupEvents.map((e) => String(e?.id ?? '')),
      size: idxs.length,
      span_sec: Number((Math.max(...ends) - Math.min(...starts)).toFixed(2)),
      shared_track_ids: [...trackCounts.entries()]
        .filter(([, c]) => c > 1)
        .map(([t]) => t)
        .sort(),
      reasons: [...(reasonsByRoot.get(root) ?? [])].sort(),
    })
    counter++
  }

  return groups.sort((a, b) => b.size - a.size)
}
