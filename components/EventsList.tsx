'use client'

import { useState, useEffect, useMemo } from 'react'
import { Search, Clock, ListFilter, AlertTriangle, X, Undo2, Check } from 'lucide-react'
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
  motion_anomaly: { label: 'Motion Anomaly', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  head_turn: { label: 'Head Turn', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  hand_gesture: { label: 'Hand Gesture', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  neighbour_reach: { label: 'Neighbour Reach', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
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

/**
 * Stable identity for one finding, so a reviewer's verdict survives a reload
 * and re-running the pipeline on the same video. Deliberately not the array
 * index, which changes with sorting and filtering.
 */
function offenceKey(o: OffenceData): string {
  return `${o.trackId ?? 'none'}|${o.type}|${o.frameIdx}`
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
        // 404 ("No data available") comes back as { error: '...' } —
        // treat it as "no video yet", not a crash.
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

  // Optimistic: reflect the verdict immediately, then persist. A reviewer
  // working through a list should never wait on a round-trip per decision.
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

  // Offences are the unit of review, so flatten them out of their segments
  // rather than making the investigator open a time window to find them.
  // A segment only means "motion crossed a threshold here" — it is a
  // compute-saving device for the pipeline, not a finding in itself, and a
  // single 34s segment routinely holds unrelated offences by different people.
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

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">Sort</span>
          {([
            ['confidence', 'Strongest first'],
            ['time', 'Chronological'],
            ['type', 'By offence type'],
          ] as [SortKey, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSortKey(key)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                sortKey === key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-accent'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

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
          <div className="space-y-3">
            {rows.map(({ offence, segment }, i) => {
              const style = styleFor(offence.type)
              const key = offenceKey(offence)
              const isDismissed = verdicts[key] === 'dismissed'
              return (
                <div
                  key={`${segment.id}-${offence.type}-${offence.frameIdx}-${i}`}
                  onClick={() => setSelected({ offence, segment })}
                  className={cn(
                    'w-full p-4 card text-left flex gap-4 transition-opacity cursor-pointer',
                    isDismissed ? 'opacity-50' : 'card-hover'
                  )}
                >
                  {offence.snapshot ? (
                    <img
                      src={`/api/snapshot?path=${encodeURIComponent(offence.snapshot)}`}
                      alt={offence.label}
                      className="flex-shrink-0 w-28 aspect-video object-cover rounded border border-border"
                    />
                  ) : (
                    <div className="flex-shrink-0 w-28 aspect-video rounded border border-dashed border-border flex items-center justify-center">
                      <AlertTriangle className="w-4 h-4 text-muted-foreground" strokeWidth={2} />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className={cn('px-2 py-0.5 rounded text-xs font-bold border', style.cls)}>
                        {style.label}
                      </span>
                      {offence.trackId && (
                        <span className="px-2 py-0.5 bg-muted rounded text-xs font-mono">{offence.trackId}</span>
                      )}
                      <span className="text-xs text-muted-foreground font-mono">
                        {(offence.confidence * 100).toFixed(0)}% confidence
                      </span>
                    </div>

                    <div className="font-medium mb-1.5">{offence.label}</div>

                    <div className="flex items-center gap-3 text-sm text-muted-foreground font-mono flex-wrap">
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {formatTime(offence.startSec)}
                      </span>
                      {offence.durationSec ? <span>{offence.durationSec.toFixed(1)}s</span> : null}
                      {offence.count ? <span>{offence.count} involved</span> : null}
                      {/* The segment is provenance, not the headline. */}
                      <span className="text-xs opacity-70">
                        segment {segment.id.replace('event-', '')} · {formatTime(segment.start)}–{formatTime(segment.end)}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-primary font-medium">Open to review →</span>
                      {verdicts[key] === 'confirmed' && (
                        <span className="text-xs text-green-700 font-medium flex items-center gap-1">
                          <Check className="w-3 h-3" strokeWidth={2.5} />
                          Confirmed offence
                        </span>
                      )}
                      {isDismissed && (
                        <span className="text-xs text-muted-foreground italic">
                          Dismissed as false positive
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selected && (() => {
        const { offence, segment } = selected
        const key = offenceKey(offence)
        const verdict = verdicts[key]
        const style = styleFor(offence.type)

        return (
          <div
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6 overflow-y-auto"
            onClick={() => setSelected(null)}
          >
            <div
              className="bg-card border border-border rounded-xl max-w-3xl w-full my-auto overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 p-5 border-b border-border">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={cn('px-2 py-0.5 rounded text-xs font-bold border', style.cls)}>
                      {style.label}
                    </span>
                    {offence.trackId && (
                      <span className="px-2 py-0.5 bg-muted rounded text-xs font-mono">{offence.trackId}</span>
                    )}
                    <span className="text-xs text-muted-foreground font-mono">
                      {(offence.confidence * 100).toFixed(0)}% confidence
                    </span>
                  </div>
                  <h3 className="text-xl font-semibold leading-snug">{offence.label}</h3>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="p-2 hover:bg-accent rounded-lg transition-colors flex-shrink-0"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" strokeWidth={2} />
                </button>
              </div>

              {offence.snapshot ? (
                <img
                  src={`/api/snapshot?path=${encodeURIComponent(offence.snapshot)}`}
                  alt={offence.label}
                  className="w-full bg-muted object-contain max-h-[45vh]"
                />
              ) : (
                <div className="w-full aspect-video bg-muted flex items-center justify-center text-sm text-muted-foreground">
                  No still captured for this finding
                </div>
              )}

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  {[
                    ['Occurred at', formatTime(offence.startSec)],
                    ['Person', offence.trackId || '—'],
                    ['Confidence', `${(offence.confidence * 100).toFixed(0)}%`],
                    ['Segment', `${formatTime(segment.start)}–${formatTime(segment.end)}`],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
                      <div className="font-mono text-sm">{value}</div>
                    </div>
                  ))}
                </div>

                {/* State plainly what the system did and did not observe, so a
                    reviewer is judging the evidence rather than a verdict. */}
                <div className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg p-3 leading-relaxed">
                  Automated detection is heuristic — it reports what was observed, not intent.
                  Confirm only if the footage supports it.
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={() => setVerdict(key, verdict === 'confirmed' ? null : 'confirmed')}
                    className={cn(
                      'px-4 py-2.5 rounded-lg font-medium text-sm flex items-center gap-2 border transition-colors',
                      verdict === 'confirmed'
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-background border-border hover:bg-green-50 hover:text-green-700 hover:border-green-200'
                    )}
                  >
                    <Check className="w-4 h-4" strokeWidth={2.5} />
                    {verdict === 'confirmed' ? 'Confirmed as offence' : 'Confirm as offence'}
                  </button>

                  <button
                    onClick={() => setVerdict(key, verdict === 'dismissed' ? null : 'dismissed')}
                    className={cn(
                      'px-4 py-2.5 rounded-lg font-medium text-sm flex items-center gap-2 border transition-colors',
                      verdict === 'dismissed'
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-background border-border hover:bg-red-50 hover:text-red-700 hover:border-red-200'
                    )}
                  >
                    <X className="w-4 h-4" strokeWidth={2.5} />
                    {verdict === 'dismissed' ? 'Discarded as false positive' : 'Discard as false positive'}
                  </button>

                  {verdict && (
                    <button
                      onClick={() => setVerdict(key, null)}
                      className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground font-medium flex items-center gap-1"
                    >
                      <Undo2 className="w-4 h-4" strokeWidth={2} />
                      Undo
                    </button>
                  )}

                  <div className="flex-1" />

                  <button
                    onClick={() => {
                      setSelected(null)
                      onEventSelect(segment.id)
                    }}
                    className="px-4 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors"
                  >
                    Watch the clip
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
