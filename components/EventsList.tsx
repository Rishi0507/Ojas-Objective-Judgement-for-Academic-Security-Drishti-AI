'use client'

import { useState, useEffect, useMemo } from 'react'
import { Search, Clock, ListFilter, AlertTriangle, X, Undo2, Check, ShieldAlert, ArrowRight, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import { offenceKey } from '@/lib/offenceKey'
import IntegrityStrip from './IntegrityStrip'
import { PageSkeleton } from './Skeleton'

interface OffenceData {
  type: string
  label: string
  trackId?: string
  startSec: number
  endSec: number
  frameIdx: number
  confidence: number
  durationSec?: number
  count?: number
  snapshot?: string
  /** CLIP's second opinion on the crop. Advisory - see clip_verify.py. */
  clip?: {
    verdict: 'supported' | 'contradicted' | 'unjudgeable'
    topLabel?: string
    topScore?: number
    margin?: number
    reason?: string
  }
  // Feature 10.4 -  the grid cell this finding sits in, and how far that cell
  // departed from its own learned baseline at this moment.
  region?: string
  regionZ?: number
  /** Present when a reviewer added this rather than the detector finding it. */
  source?: string
  sourceNote?: string
  /** Set by clip_verify.py --filter when CLIP contradicted the finding. */
  suppressed?: boolean
  suppressedBy?: string
  suppressedReason?: string
}

interface SegmentData {
  id: string
  videoId: string
  start: number
  end: number
  duration: number
  motionScore: number
  priority: string
  type: string
  description: string
  trackId: string
  offences?: OffenceData[]
}

interface VideoData {
  video_id: string
  event_count: number
  events: SegmentData[]
  /** Present only on the aggregated response from /api/offences. */
  videos?: { jobId: string; filename: string; offenceCount: number; isActive: boolean }[]
}

interface EventsListProps {
  onEventSelect: (eventId: string) => void
}

/** An offence paired with the segment it was found in. */
interface OffenceRow {
  offence: OffenceData
  segment: SegmentData
}

const OFFENCE_STYLES: Record<string, { label: string; cls: string }> = {
  prohibited_object: { label: 'Prohibited Object', cls: 'bg-red-50 text-red-700 border-red-200' },
  object_exchange: { label: 'Object Exchange', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  loitering: { label: 'Loitering', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  crowd_disturbance: { label: 'Crowd Disturbance', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  head_turn: { label: 'Head Turn', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  hand_gesture: { label: 'Hand Gesture', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
}

function styleFor(type: string) {
  return OFFENCE_STYLES[type] ?? { label: type.replace(/_/g, ' '), cls: 'bg-muted text-foreground border-border' }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = (seconds % 60).toFixed(1)
  return `${mins}:${secs.padStart(4, '0')}`
}

/**
 * Feature 10.4 -  how unusual this finding's own part of the frame was.
 *
 * Rendered for both outcomes, because both carry information. A high z-score
 * says the scene corroborates the geometry. A zero says the detector fired
 * while that region was behaving exactly as it normally does for this video -
 * the more interesting case, and the one a reviewer should weigh hardest.
 *
 * Which group a finding lands in varies by footage, so neither is a proxy for
 * "true" or "false": on one test clip every head turn sat in a normal region,
 * on another most sat in abnormal ones. It is context for a human, not a
 * verdict.
 */
function RegionBadge({ offence }: { offence: { region?: string; regionZ?: number } }) {
  if (!offence.region) return null
  const z = offence.regionZ ?? 0

  if (z !== 0) {
    // Module 10.4 floors sigma at 1e-3, so a region that barely moved during
    // calibration yields enormous z-scores - this footage produces 47.9 in a
    // near-static cell. That is not 48 standard deviations of a well-estimated
    // distribution, it is a division by an almost-zero baseline, and printing
    // the figure would be false precision. Past 10 the magnitude stops meaning
    // anything, so it is banded instead.
    const extreme = Math.abs(z) >= 10
    return (
      <span
        title={
          extreme
            ? `Region ${offence.region} was far outside its normal range. The exact multiple (${z.toFixed(1)}) is not meaningful here: this region was almost completely static during calibration, so its baseline variance sits at the floor and any motion divides into a very large number.`
            : `Region ${offence.region} departed from its own learned baseline by ${z.toFixed(1)} standard deviations at this moment.`
        }
        className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono border bg-primary/5 text-primary border-primary/20"
      >
        {offence.region} · {extreme ? 'well above normal' : `${z.toFixed(1)}σ above normal`}
      </span>
    )
  }

  return (
    <span
      title={`Region ${offence.region} was within its normal range for this video when this was flagged. The detector fired, but the scene itself was not behaving unusually.`}
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono border bg-muted text-muted-foreground border-border"
    >
      {offence.region} · region normal
    </span>
  )
}

/**
 * Provenance badge for findings that did not come from the detector.
 *
 * A reviewer can add what they see at native resolution, where a small object is
 * legible and the 640px pipeline frame has only a few pixels of it. Those are
 * real observations and belong in the record - but they must not read as model
 * output, because the difference matters the moment anyone asks what the system
 * itself found.
 */
function SourceBadge({ offence }: { offence: { source?: string; sourceNote?: string } }) {
  if (offence.source !== 'manual_review') return null
  return (
    <span
      title={offence.sourceNote ?? 'Added by a reviewer, not detected by the pipeline.'}
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono border bg-indigo-50 text-indigo-700 border-indigo-200"
    >
      added on review
    </span>
  )
}

/**
 * CLIP's second opinion, rendered as a badge.
 *
 * Deliberately not shown for "supported": a green tick on most of the list
 * would read as corroboration the model cannot give. What is worth a
 * reviewer's attention is the two cases where CLIP disagrees with the
 * geometry, or where it had no view at all - a small subject the model
 * genuinely cannot resolve is different from one it examined and cleared.
 */
function ClipBadge({ offence }: { offence: OffenceData }) {
  const clip = offence.clip
  if (!clip) return null

  if (offence.suppressed || clip.verdict === 'contradicted') {
    return (
      <span
        title={offence.suppressedReason ?? clip.topLabel ?? 'CLIP contradicted this finding'}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono border bg-amber-500/10 text-amber-600 border-amber-500/30"
      >
        CLIP disagrees
      </span>
    )
  }

  if (clip.verdict === 'unjudgeable') {
    return (
      <span
        title={clip.reason ?? 'CLIP could not resolve this crop'}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono border bg-muted text-muted-foreground border-border"
      >
        CLIP unsure
      </span>
    )
  }

  return null
}

type SortKey = 'time' | 'confidence' | 'type'
type Verdict = 'dismissed' | 'confirmed'

/** Local wrapper: every row knows the video it came from, so scope by it. */
function rowKey(offence: OffenceData, segment: SegmentData): string {
  return offenceKey(offence, (segment as any).sourceJobId)
}

function getGroundedExplanation(type: string, label: string, trackId?: string, confidence?: number) {
  const person = trackId || 'Examinee'
  const confPercent = confidence ? (confidence * 100).toFixed(0) : '90'

  switch (type) {
    case 'prohibited_object':
      return {
        observation: `A prohibited object was detected near ${person} - a phone or a paper/chit.`,
        reasoning: `YOLO detected the object above the 0.35 confidence floor, inside or overlapping this person's box. Overlay artefacts near the frame edges are rejected, and there is no minimum hold time - a single confident frame is enough to flag it.`,
        recommendation: `Inspect physical desk area around ${person} and verify timestamped snapshot evidence.`,
      }
    case 'head_turn':
      return {
        observation: `${person} turned their head away from the direction they normally hold it.`,
        reasoning: `Head yaw is estimated from the offsets between nose, eyes and ears, then compared against this person's OWN median yaw across the video rather than a fixed angle - people sit at an angle, so absolute orientation is not evidence of anything. Flagged past 0.35 deviation on a scale of -1 to 1. This is not a measured degree value.`,
        recommendation: `Cross-reference seating chart to verify if ${person} was attempting to view neighbor answer sheets.`,
      }
    case 'object_exchange':
      return {
        observation: `Physical proximity interaction detected between ${person} and adjacent track area.`,
        reasoning: `Two tracked people's wrist keypoints came within reaching distance of each other, scaled to their torso length so distance in pixels is not confused with distance in the room.`,
        recommendation: `Review video clip around timestamp to confirm whether unauthorized item exchange took place.`,
      }
    case 'hand_gesture':
      return {
        observation: `Repeated non-standard hand gesture or signaling motion detected for ${person}.`,
        reasoning: `A wrist keypoint rose above the shoulder line - the posture of signalling rather than writing. It cannot distinguish signalling from stretching or a hand resting against the head, which is the failure CLIP is used to catch.`,
        recommendation: `Check if signaling corresponds with head movement or gaze redirection from surrounding examinees.`,
      }
    case 'loitering':
    case 'crowd_disturbance':
      return {
        observation: `Unauthorized movement or loitering near examinee seating area detected.`,
        reasoning: `Trajectory tracking flagged sustained presence in aisle or restricted zone exceeding standard hall traversal limits.`,
        recommendation: `Confirm invigilator presence or verify if examinee left seat without permission.`,
      }
    default:
      return {
        observation: `Behavioral anomaly flagged by AI vision pipeline for ${label}.`,
        reasoning: `Motion score and posture heuristic threshold exceeded (${confPercent}% confidence).`,
        recommendation: `Perform manual review of video clip and evidence snapshot.`,
      }
  }
}

export default function EventsList({ onEventSelect }: EventsListProps) {
  const [videoData, setVideoData] = useState<VideoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [trackFilter, setTrackFilter] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('confidence')
  const [query, setQuery] = useState('')
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({})
  const [showDismissed, setShowDismissed] = useState(false)
  const [showSuppressed, setShowSuppressed] = useState(false)
  const [selected, setSelected] = useState<OffenceRow | null>(null)
  const [videoFilter, setVideoFilter] = useState<string>('all')

  useEffect(() => {
    // /api/offences walks pipeline_out/ rather than following the active-video
    // pointer, so this list is the whole backlog across every processed video.
    // A reviewer works through findings, not through videos, and having the
    // list silently show only whichever video happened to be selected meant
    // findings on the others were never seen.
    fetch('/api/offences')
      .then((res) => res.json())
      .then((data) => {
        setVideoData(data && !data.error ? data : null)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load offences:', err)
        setVideoData(null)
        setLoading(false)
      })

    fetch('/api/offence-review')
      .then((res) => res.json())
      .then((d) => setVerdicts(d?.verdicts ?? {}))
      .catch(() => setVerdicts({}))
  }, [])

  const setVerdict = (key: string, verdict: Verdict | null) => {
    setVerdicts((prev) => {
      const next = { ...prev }
      if (verdict === null) delete next[key]
      else next[key] = verdict
      return next
    })
    fetch('/api/offence-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, verdict }),
    }).catch((err) => console.error('Failed to save verdict:', err))
  }

  // Every finding, including ones CLIP suppressed. Kept whole so the counts
  // below can state how many were hidden rather than quietly shrinking.
  const everyRow: OffenceRow[] = useMemo(() => {
    if (!videoData) return []
    const rows: OffenceRow[] = []
    for (const segment of videoData.events) {
      for (const offence of segment.offences ?? []) {
        rows.push({ offence, segment })
      }
    }
    return rows
  }, [videoData])

  const sourceVideos = useMemo(
    () => Array.from(new Set(everyRow.map((r) => (r.segment as any).sourceVideo).filter(Boolean) as string[])).sort(),
    [everyRow]
  )

  const suppressedCount = useMemo(
    () => everyRow.filter((r) => r.offence.suppressed).length,
    [everyRow]
  )

  // What the reviewer actually works through. Suppressed findings are hidden
  // by default but reachable via the toggle - they are not deleted, and a
  // filter nobody can look behind is one nobody can correct.
  const allRows: OffenceRow[] = useMemo(
    () => (showSuppressed ? everyRow : everyRow.filter((r) => !r.offence.suppressed)),
    [everyRow, showSuppressed]
  )

  const types = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.offence.type))).sort(),
    [allRows]
  )

  const tracks = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.offence.trackId).filter(Boolean) as string[])).sort(),
    [allRows]
  )

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const r of allRows) counts[r.offence.type] = (counts[r.offence.type] ?? 0) + 1
    return counts
  }, [allRows])

  const dismissedCount = useMemo(
    () => allRows.filter((r) => verdicts[rowKey(r.offence, r.segment)] === 'dismissed').length,
    [allRows, verdicts]
  )

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = allRows
      .filter((r) => showDismissed || verdicts[rowKey(r.offence, r.segment)] !== 'dismissed')
      .filter((r) => typeFilter === 'all' || r.offence.type === typeFilter)
      .filter((r) => trackFilter === 'all' || r.offence.trackId === trackFilter)
      .filter((r) => videoFilter === 'all' || (r.segment as any).sourceVideo === videoFilter)
      .filter(
        (r) =>
          !q ||
          r.offence.label.toLowerCase().includes(q) ||
          r.offence.type.toLowerCase().includes(q) ||
          (r.offence.trackId ?? '').toLowerCase().includes(q) ||
          ((r.segment as any).sourceVideo ?? '').toLowerCase().includes(q)
      )

    return filtered.sort((a, b) => {
      if (sortKey === 'confidence') return b.offence.confidence - a.offence.confidence
      if (sortKey === 'type') return a.offence.type.localeCompare(b.offence.type) || a.offence.startSec - b.offence.startSec
      return a.offence.startSec - b.offence.startSec
    })
  }, [allRows, typeFilter, trackFilter, videoFilter, query, sortKey, verdicts, showDismissed])

  if (loading) {
    <PageSkeleton variant="list" label="Loading findings" />
  }

  if (!videoData) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-center">
        <div className="font-medium mb-1">No offences yet</div>
        <p className="text-sm text-muted-foreground">Upload a video from the Dashboard to detect offences.</p>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-4xl font-bold tracking-tight mb-2">
          Detected <span className="font-normal text-muted-foreground">Offences</span>
        </h1>
        <p className="text-muted-foreground">
          {allRows.length} findings across {videoData.event_count} activity{' '}
          {videoData.event_count === 1 ? 'segment' : 'segments'}
          {sourceVideos.length > 1 && ` in ${sourceVideos.length} videos`}
          {suppressedCount > 0 && (
            <>
              {' · '}
              <button
                onClick={() => setShowSuppressed(!showSuppressed)}
                className="underline underline-offset-2 hover:text-foreground transition-colors"
                title="CLIP read these crops as an innocent explanation. They are hidden, not deleted."
              >
                {showSuppressed ? 'hide' : 'show'} {suppressedCount} filtered by CLIP
              </button>
            </>
          )}
        </p>
      </div>

      <IntegrityStrip />

      {/* Filters Bar */}
      <div className="card p-4 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" strokeWidth={2} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search offences by description, type, or person..."
            className="w-full pl-10 pr-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground transition-colors"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
            <ListFilter className="w-3.5 h-3.5" strokeWidth={2} />
            Offence
          </span>
          <button
            onClick={() => setTypeFilter('all')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              typeFilter === 'all'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border hover:bg-accent'
            )}
          >
            All ({allRows.length})
          </button>
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                typeFilter === t
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-accent'
              )}
            >
              {styleFor(t).label} ({typeCounts[t]})
            </button>
          ))}
        </div>

        {/* Only worth showing once more than one video has been processed;
            with a single video every row would carry the same chip. */}
        {sourceVideos.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
              <ListFilter className="w-3.5 h-3.5" strokeWidth={2} />
              Video
            </span>
            <button
              onClick={() => setVideoFilter('all')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                videoFilter === 'all'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-accent'
              )}
            >
              All videos ({sourceVideos.length})
            </button>
            {sourceVideos.map((v) => (
              <button
                key={v}
                onClick={() => setVideoFilter(v)}
                title={v}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors max-w-[16rem] truncate',
                  videoFilter === v
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:bg-accent'
                )}
              >
                {v.replace(/\.(mkv|mp4|avi)$/i, '')}
              </button>
            ))}
          </div>
        )}

        {tracks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
              <ListFilter className="w-3.5 h-3.5" strokeWidth={2} />
              Person
            </span>
            <button
              onClick={() => setTrackFilter('all')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                trackFilter === 'all'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-accent'
              )}
            >
              Anyone
            </button>
            {tracks.map((t) => (
              <button
                key={t}
                onClick={() => setTrackFilter(t)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors font-mono',
                  trackFilter === t
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:bg-accent'
                )}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid View: Small Image + Offence Name only */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="text-lg font-semibold">
            {rows.length} {rows.length === 1 ? 'Offence' : 'Offences'}
          </h2>
          {dismissedCount > 0 && (
            <button
              onClick={() => setShowDismissed(!showDismissed)}
              className="text-xs text-muted-foreground hover:text-foreground font-medium underline"
            >
              {showDismissed ? 'Hide' : 'Show'} {dismissedCount} dismissed
            </button>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No offences match these filters.</div>
        ) : (
          // A single column, not a grid. Each row is built as a row - thumbnail
          // left, verdict pinned right, a status spine down the edge - and at
          // four columns each was ~250px wide, so the type badge and the region
          // badge wrapped mid-word and the label truncated to nothing. A dense
          // vertical list is also what a reviewer wants: one finding per line,
          // scannable straight down.
          <div className="flex flex-col gap-2.5">
            {rows.map(({ offence, segment }, i) => {
              const key = rowKey(offence, segment)
              const isDismissed = verdicts[key] === 'dismissed'
              const isConfirmed = verdicts[key] === 'confirmed'
              return (
                <div
                  key={`${segment.id}-${offence.type}-${offence.frameIdx}-${i}`}
                  onClick={() => setSelected({ offence, segment })}
                  className={cn(
                    'p-3 rounded-xl border bg-card flex items-center gap-4 cursor-pointer group relative',
                    // No scale on hover: these rows sit in a dense list and a
                    // transform makes neighbouring rows appear to shift. Border
                    // and shadow read as interactive without moving anything.
                    'transition-all duration-150 hover:border-primary/40 hover:shadow-sm',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    isDismissed ? 'opacity-45 border-dashed border-border' : 'border-border'
                  )}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelected({ offence, segment })
                    }
                  }}
                >
                  {/* Verdict as a spine, so reviewed and unreviewed rows are
                      distinguishable while scanning rather than only on read. */}
                  <span
                    className={cn(
                      'absolute left-0 top-3 bottom-3 w-1 rounded-full transition-colors',
                      isConfirmed ? 'bg-emerald-500' : isDismissed ? 'bg-slate-300' : 'bg-transparent'
                    )}
                  />
                  {/* Image Thumbnail */}
                  {offence.snapshot ? (
                    <img
                      src={`/api/snapshot?path=${encodeURIComponent(offence.snapshot)}`}
                      alt=""
                      loading="lazy"
                      className="w-36 h-20 object-cover rounded-lg flex-shrink-0 border border-border bg-muted transition-opacity group-hover:opacity-95"
                    />
                  ) : (
                    <div className="w-36 h-20 rounded-lg bg-muted/60 border border-dashed border-border flex flex-col items-center justify-center flex-shrink-0 gap-1">
                      <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground">no still</span>
                    </div>
                  )}

                  {/* Offence Label / Name */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-nowrap">
                      <span className={cn('px-2 py-0.5 rounded-md text-[11px] font-semibold border whitespace-nowrap', styleFor(offence.type).cls)}>
                        {styleFor(offence.type).label}
                      </span>
                      {offence.trackId && (
                        <span className="px-1.5 py-0.5 bg-muted rounded text-[11px] font-mono text-muted-foreground">
                          {offence.trackId}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono tabular-nums">
                        <Clock className="w-3 h-3" />
                        {formatTime(offence.startSec)}
                      </span>
                    </div>

                    <div className="font-medium text-sm text-foreground truncate leading-snug">
                      {offence.label}
                    </div>

                    <div className="flex items-center gap-1.5 flex-nowrap overflow-hidden">
                      {/* Which video this came from. The list spans every
                          processed video, so without this a reviewer cannot
                          tell two clips' findings apart. */}
                      {sourceVideos.length > 1 && (segment as any).sourceVideo && (
                        <span
                          title={(segment as any).sourceVideo}
                          className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground max-w-[10rem] truncate flex-shrink-0"
                        >
                          {String((segment as any).sourceVideo).replace(/\.(mkv|mp4|avi)$/i, '')}
                        </span>
                      )}
                      <ClipBadge offence={offence} />
                      <SourceBadge offence={offence} />
                      <RegionBadge offence={offence} />
                    </div>
                  </div>

                  {/* Verdict pinned right so the reviewed/unreviewed column is
                      scannable straight down the list. */}
                  <div className="flex-shrink-0 flex items-center gap-2 pl-1">
                    {isConfirmed && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-semibold">
                        <Check className="w-3 h-3" strokeWidth={2.5} /> Confirmed
                      </span>
                    )}
                    {isDismissed && (
                      <span className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 text-slate-500 text-[11px] font-medium">
                        Dismissed
                      </span>
                    )}
                    {!isConfirmed && !isDismissed && (
                      <span className="text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        Review →
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* POPUP MODAL CARD with Grounded Explanations & Detailed Information */}
      {selected && (() => {
        const { offence, segment } = selected
        const key = rowKey(offence, segment)
        const verdict = verdicts[key]
        const style = styleFor(offence.type)
        const grounded = getGroundedExplanation(offence.type, offence.label, offence.trackId, offence.confidence)

        return (
          <div
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6 overflow-y-auto"
            onClick={() => setSelected(null)}
          >
            <div
              className="bg-card border border-border rounded-2xl max-w-2xl w-full my-auto overflow-hidden shadow-2xl space-y-0"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-start justify-between gap-4 p-5 border-b border-border bg-muted/20">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-bold border', style.cls)}>
                      {style.label}
                    </span>
                    {offence.trackId && (
                      <span className="px-2 py-0.5 bg-muted rounded-md text-xs font-mono">{offence.trackId}</span>
                    )}
                    <span className="text-xs text-muted-foreground font-mono">
                      {(offence.confidence * 100).toFixed(0)}% confidence
                    </span>
                    <ClipBadge offence={offence} />
                      <SourceBadge offence={offence} />
                    <RegionBadge offence={offence} />
                  </div>
                  <h3 className="text-xl font-bold leading-snug text-foreground">{offence.label}</h3>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="p-2 hover:bg-accent rounded-full transition-colors flex-shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" strokeWidth={2} />
                </button>
              </div>

              {/* Evidence Snapshot Image Preview */}
              {offence.snapshot ? (
                <div className="bg-black/90 relative flex items-center justify-center">
                  <img
                    src={`/api/snapshot?path=${encodeURIComponent(offence.snapshot)}`}
                    alt={offence.label}
                    className="w-full object-contain max-h-[40vh]"
                  />
                </div>
              ) : (
                <div className="w-full aspect-video bg-muted flex items-center justify-center text-sm text-muted-foreground">
                  No still captured for this finding
                </div>
              )}

              <div className="p-6 space-y-6">
                
                {/* GROUNDED EXPLANATIONS & REASONING */}
                <div className="space-y-3 p-4 bg-muted/30 border border-border rounded-xl">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                    <ShieldAlert className="w-4 h-4 text-primary" />
                    <span>Grounded AI Observation & Reasoning</span>
                  </div>

                  <div className="space-y-2 text-xs text-foreground leading-relaxed">
                    <div>
                      <strong className="text-foreground">Visual Observation:</strong>{' '}
                      <span className="text-muted-foreground">{grounded.observation}</span>
                    </div>

                    <div>
                      <strong className="text-foreground">AI Logic & Heuristics:</strong>{' '}
                      <span className="text-muted-foreground">{grounded.reasoning}</span>
                    </div>

                    <div>
                      <strong className="text-foreground">Recommended Audit:</strong>{' '}
                      <span className="text-muted-foreground">{grounded.recommendation}</span>
                    </div>
                  </div>
                </div>

                {/* Key Technical Details Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 border border-border rounded-xl bg-background text-xs font-mono">
                  <div>
                    <div className="text-muted-foreground mb-1">Occurred at</div>
                    <div className="font-bold text-sm text-foreground">{formatTime(offence.startSec)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">Track Subject</div>
                    <div className="font-bold text-sm text-foreground">{offence.trackId || 'Examinee'}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">Confidence</div>
                    <div className="font-bold text-sm text-foreground">{(offence.confidence * 100).toFixed(0)}%</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1">Segment Range</div>
                    <div className="font-bold text-sm text-foreground">{formatTime(segment.start)}–{formatTime(segment.end)}</div>
                  </div>
                </div>

                {/* Review & Audit Actions */}
                <div className="flex items-center gap-3 flex-wrap pt-2">
                  <button
                    onClick={() => setVerdict(key, verdict === 'confirmed' ? null : 'confirmed')}
                    className={cn(
                      'px-4 py-2.5 rounded-lg font-medium text-xs flex items-center gap-2 border transition-colors',
                      verdict === 'confirmed'
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-background border-border hover:bg-green-50 hover:text-green-700 hover:border-green-200'
                    )}
                  >
                    <Check className="w-4 h-4" strokeWidth={2.5} />
                    {verdict === 'confirmed' ? 'Confirmed as Offence' : 'Confirm as Offence'}
                  </button>

                  <button
                    onClick={() => setVerdict(key, verdict === 'dismissed' ? null : 'dismissed')}
                    className={cn(
                      'px-4 py-2.5 rounded-lg font-medium text-xs flex items-center gap-2 border transition-colors',
                      verdict === 'dismissed'
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-background border-border hover:bg-red-50 hover:text-red-700 hover:border-red-200'
                    )}
                  >
                    <X className="w-4 h-4" strokeWidth={2.5} />
                    {verdict === 'dismissed' ? 'Discarded as False Positive' : 'Discard as False Positive'}
                  </button>

                  {verdict && (
                    <button
                      onClick={() => setVerdict(key, null)}
                      className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground font-medium flex items-center gap-1"
                    >
                      <Undo2 className="w-3.5 h-3.5" strokeWidth={2} />
                      Undo
                    </button>
                  )}

                  <div className="flex-1" />

                  <button
                    onClick={() => {
                      setSelected(null)
                      onEventSelect(segment.id)
                    }}
                    className="btn-primary py-2 px-4 text-xs font-medium flex items-center gap-2"
                  >
                    <span>Watch Clip</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
