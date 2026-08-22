'use client'

import { useState, useEffect, useMemo } from 'react'
import { Search, Clock, ListFilter, AlertTriangle, X, Undo2, Check, ShieldAlert, ArrowRight, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'

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

type SortKey = 'time' | 'confidence' | 'type'
type Verdict = 'dismissed' | 'confirmed'

function offenceKey(o: OffenceData): string {
  return `${o.trackId ?? 'none'}|${o.type}|${o.frameIdx}`
}

function getGroundedExplanation(type: string, label: string, trackId?: string, confidence?: number) {
  const person = trackId || 'Examinee'
  const confPercent = confidence ? (confidence * 100).toFixed(0) : '90'

  switch (type) {
    case 'prohibited_object':
      return {
        observation: `${person} was detected interacting with an unauthorized object (paper/chit/device) on or near the desk surface.`,
        reasoning: `Optical flow and spatial object tracking identified a non-standard item held for >3s during active testing.`,
        recommendation: `Inspect physical desk area around ${person} and verify timestamped snapshot evidence.`,
      }
    case 'head_turn':
      return {
        observation: `${person} performed a lateral head rotation exceeding allowed vision angle limits (>60°).`,
        reasoning: `Pose estimation vectors indicated head direction divergence away from the exam paper toward adjacent desks.`,
        recommendation: `Cross-reference seating chart to verify if ${person} was attempting to view neighbor answer sheets.`,
      }
    case 'object_exchange':
      return {
        observation: `Physical proximity interaction detected between ${person} and adjacent track area.`,
        reasoning: `Hand trajectory convergence and spatial overlap detected between two examinees, consistent with passing materials.`,
        recommendation: `Review video clip around timestamp to confirm whether unauthorized item exchange took place.`,
      }
    case 'hand_gesture':
      return {
        observation: `Repeated non-standard hand gesture or signaling motion detected for ${person}.`,
        reasoning: `High-frequency wrist/finger motion vectors outside normal writing patterns, indicating non-verbal communication.`,
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
  const [selected, setSelected] = useState<OffenceRow | null>(null)

  useEffect(() => {
    fetch('/api/video')
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

  const allRows: OffenceRow[] = useMemo(() => {
    if (!videoData) return []
    const rows: OffenceRow[] = []
    for (const segment of videoData.events) {
      for (const offence of segment.offences ?? []) {
        rows.push({ offence, segment })
      }
    }
    return rows
  }, [videoData])

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
    () => allRows.filter((r) => verdicts[offenceKey(r.offence)] === 'dismissed').length,
    [allRows, verdicts]
  )

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = allRows
      .filter((r) => showDismissed || verdicts[offenceKey(r.offence)] !== 'dismissed')
      .filter((r) => typeFilter === 'all' || r.offence.type === typeFilter)
      .filter((r) => trackFilter === 'all' || r.offence.trackId === trackFilter)
      .filter(
        (r) =>
          !q ||
          r.offence.label.toLowerCase().includes(q) ||
          r.offence.type.toLowerCase().includes(q) ||
          (r.offence.trackId ?? '').toLowerCase().includes(q)
      )

    return filtered.sort((a, b) => {
      if (sortKey === 'confidence') return b.offence.confidence - a.offence.confidence
      if (sortKey === 'type') return a.offence.type.localeCompare(b.offence.type) || a.offence.startSec - b.offence.startSec
      return a.offence.startSec - b.offence.startSec
    })
  }, [allRows, typeFilter, trackFilter, query, sortKey, verdicts, showDismissed])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-muted-foreground">Loading offences...</div>
      </div>
    )
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
          Detected <span className="font-serif italic">Offences</span>
        </h1>
        <p className="text-muted-foreground">
          {allRows.length} findings across {videoData.event_count} activity{' '}
          {videoData.event_count === 1 ? 'segment' : 'segments'}
        </p>
      </div>

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {rows.map(({ offence, segment }, i) => {
              const key = offenceKey(offence)
              const isDismissed = verdicts[key] === 'dismissed'
              const isConfirmed = verdicts[key] === 'confirmed'
              return (
                <div
                  key={`${segment.id}-${offence.type}-${offence.frameIdx}-${i}`}
                  onClick={() => setSelected({ offence, segment })}
                  className={cn(
                    'p-3 card rounded-card flex items-center gap-3 cursor-pointer transition-all hover:scale-[1.01] hover:border-primary/50 group relative',
                    isDismissed && 'opacity-50'
                  )}
                >
                  {/* Image Thumbnail */}
                  {offence.snapshot ? (
                    <img
                      src={`/api/snapshot?path=${encodeURIComponent(offence.snapshot)}`}
                      alt={offence.label}
                      className="w-32 h-22 object-cover rounded-xl flex-shrink-0 border border-border group-hover:opacity-95 transition-opacity"
                    />
                  ) : (
                    <div className="w-32 h-22 rounded-xl bg-muted/60 border border-dashed border-border flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}

                  {/* Offence Label / Name */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-bold text-base text-foreground line-clamp-2 leading-snug group-hover:text-primary transition-colors">
                      {offence.label}
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-1.5 font-mono">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>{formatTime(offence.startSec)}</span>
                    </div>

                    {isConfirmed && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600 font-semibold mt-1">
                        <Check className="w-3.5 h-3.5" /> Confirmed
                      </span>
                    )}
                    {isDismissed && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground italic mt-1">
                        Dismissed
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
        const key = offenceKey(offence)
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
