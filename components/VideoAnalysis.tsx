'use client'

import { useState, useEffect } from 'react'
import { ChevronRight, ArrowLeft, Activity, Phone, Users, TrendingUp, FileText, Loader2, Eye, Clock, Zap, Target, Network } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageSkeleton } from './Skeleton'

/**
 * Feature 10.1 -  investigator profiles. Labels/blurbs live here rather than
 * being derived from the API's snake_case names, so the UI reads properly
 * without the backend having to carry presentation strings.
 */
const INVESTIGATION_PROFILES: { id: string; label: string; blurb: string }[] = [
  { id: 'none', label: 'Pipeline order', blurb: 'Events as detected, chronological' },
  { id: 'phone_activity', label: 'Phone activity', blurb: 'Weights prohibited-item detections highest' },
  { id: 'seat_exchange', label: 'Seat exchange', blurb: 'Weights movement, then proximity' },
  { id: 'neighbor_interaction', label: 'Neighbour interaction', blurb: 'Weights how tightly people cluster' },
  { id: 'camera_disturbance', label: 'Camera disturbance', blurb: 'Surfaces poorly-observed footage' },
  { id: 'all_unusual', label: 'All unusual', blurb: 'Balanced across every signal' },
]

/** Feature 10.2 -  a cluster of events linked into one story. */
interface EvidenceGroup {
  group_id: string
  event_ids: string[]
  size: number
  span_sec: number
  shared_track_ids: string[]
  reasons: string[]
}

interface VideoAnalysisProps {
  videoId: string
  onEventSelect: (eventId: string) => void
  onBack: () => void
}

interface EventData {
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
  motionCharacter?: string
  jerkScore?: number
  profileScore?: number
  profileSignals?: Record<string, number>
}

interface VideoData {
  video_id: string
  metadata: {
    resolution: string
    fps: number
    sampling: string
    frames: number
  }
  quality_metrics: {
    observability: number
    cameraShake: number
    blur: number
    lighting: number
    occlusion: number
  }
  event_count: number
  events: EventData[]
}

/**
 * Observability colour bands.
 *
 * Thresholds match the uncertainty bands used elsewhere (>0.6 good,
 * 0.3-0.6 middling, <0.3 poor) so the same number never reads as reassuring in
 * one panel and alarming in another. Amber rather than yellow, and emerald
 * rather than lime: both hold contrast against the light canvas.
 */
function observabilityTone(v: number) {
  if (v >= 0.6) return { bar: 'bg-emerald-500', text: 'text-emerald-700' }
  if (v >= 0.3) return { bar: 'bg-amber-500', text: 'text-amber-700' }
  return { bar: 'bg-red-500', text: 'text-red-700' }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = (seconds % 60).toFixed(1)
  return `${mins}:${secs.padStart(4, '0')}`
}

export default function VideoAnalysis({ videoId, onEventSelect, onBack }: VideoAnalysisProps) {
  const [activeFilter, setActiveFilter] = useState('all')
  const [videoData, setVideoData] = useState<VideoData | null>(null)
  const [loading, setLoading] = useState(true)
  // Features 10.1 / 10.2. The base /api/video fetch below is left exactly as
  // it was; profile ranking and grouping come from /api/events, so the page
  // still renders normally if that call fails.
  const [profile, setProfile] = useState('none')
  const [rankedEvents, setRankedEvents] = useState<EventData[] | null>(null)
  const [groups, setGroups] = useState<EvidenceGroup[]>([])
  const [ranking, setRanking] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [issueResult, setIssueResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Same dispatch the ledger view uses: n8n renders the document, records its
  // hash in the custody chain and mails it. Named for what it does - the old
  // "Export" label with a download icon promised a file that never arrived in
  // the browser, and the button was not wired to anything at all.
  const issueReport = async () => {
    setIssuing(true)
    setIssueResult(null)
    try {
      const res = await fetch('/api/report/dispatch', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      setIssueResult(
        res.ok
          ? { ok: true, message: 'Report issued, recorded in the ledger and sent to the workflow.' }
          : { ok: false, message: data.error ?? `Failed (${res.status})` }
      )
    } catch (e) {
      setIssueResult({ ok: false, message: String(e) })
    } finally {
      setIssuing(false)
    }
  }

  useEffect(() => {
    fetch('/api/video')
      .then(res => res.json())
      .then(data => {
        setVideoData(data)
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to load video data:', err)
        setLoading(false)
      })
  }, [])

  // Evidence groups don't depend on the chosen profile, so they're fetched once.
  useEffect(() => {
    fetch('/api/events?groups=1')
      .then(res => res.json())
      .then(data => setGroups(Array.isArray(data.groups) ? data.groups : []))
      .catch(err => console.error('Failed to load evidence groups:', err))
  }, [])

  useEffect(() => {
    if (profile === 'none') {
      setRankedEvents(null)
      return
    }
    let cancelled = false
    setRanking(true)
    fetch(`/api/events?mode=${encodeURIComponent(profile)}`)
      .then(res => res.json())
      .then(data => {
        // A late response from a previously-selected profile must not
        // overwrite the current one.
        if (cancelled) return
        setRankedEvents(Array.isArray(data.events) ? data.events : null)
      })
      .catch(err => {
        if (!cancelled) console.error('Failed to re-rank events:', err)
      })
      .finally(() => {
        if (!cancelled) setRanking(false)
      })
    return () => { cancelled = true }
  }, [profile])

  if (loading) {
    <PageSkeleton variant="analysis" label="Loading video analysis" />
  }

  if (!videoData) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-muted-foreground">Failed to load video data</div>
      </div>
    )
  }

  // Profile ranking replaces only the ORDER of the list; the existing type
  // filter below is untouched and still applies on top.
  const baseEvents = rankedEvents ?? videoData.events
  const filteredEvents = baseEvents.filter(event => {
    if (activeFilter === 'all') return true
    if (activeFilter === 'phone' && event.type === 'phone_activity') return true
    if (activeFilter === 'proximity' && event.type === 'proximity') return true
    if (activeFilter === 'unusual' && event.type === 'unusual_motion') return true
    return false
  })

  const phoneCount = videoData.events.filter(e => e.type === 'phone_activity').length
  const proximityCount = videoData.events.filter(e => e.type === 'proximity').length
  const unusualCount = videoData.events.filter(e => e.type === 'unusual_motion').length

  const filterProfiles = [
    { id: 'all', label: 'All Segments', count: videoData.event_count, icon: Activity },
    { id: 'phone', label: 'Phone Activity', count: phoneCount, icon: Phone },
    { id: 'proximity', label: 'Proximity', count: proximityCount, icon: Users },
    { id: 'unusual', label: 'Unusual Motion', count: unusualCount, icon: TrendingUp },
  ]

  const obsTone = observabilityTone(videoData.quality_metrics.observability)

  const videoDuration = videoData.events.length > 0 
    ? videoData.events[videoData.events.length - 1].end 
    : 143

  return (
    <div className="p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-accent rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" strokeWidth={2} />
          </button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {videoData.video_id.replace('.mkv', '')}
            </h1>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="font-mono">{videoData.video_id}</span>
              <span>•</span>
              <span>{formatTime(videoDuration)}</span>
              <span>•</span>
              <span>{videoData.event_count} segments</span>
            </div>
          </div>
        </div>
        {/* The "Filters" button that used to sit here did nothing - the
            investigation profiles directly below are the actual filter
            control, so it was a second, dead entry point to them. */}
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={issueReport}
            disabled={issuing}
            title="Renders the incident report, records its hash in the custody ledger, and mails it"
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {issuing ? (
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
            ) : (
              <FileText className="w-4 h-4" strokeWidth={2} />
            )}
            {issuing ? 'Issuing…' : 'Issue report'}
          </button>
          {issueResult && (
            <p className={cn('text-xs max-w-xs text-right', issueResult.ok ? 'text-emerald-600' : 'text-red-600')}>
              {issueResult.message}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {filterProfiles.map((profile) => {
          const Icon = profile.icon
          return (
            <button
              key={profile.id}
              onClick={() => setActiveFilter(profile.id)}
              className={cn(
                "p-6 rounded-lg text-left transition-all",
                activeFilter === profile.id 
                  ? 'bg-primary text-primary-foreground' 
                  : 'card card-hover'
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <Icon className="w-5 h-5" strokeWidth={2} />
              </div>
              <div className="text-3xl font-bold mb-1">{profile.count}</div>
              <div className="text-sm opacity-80">{profile.label}</div>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6">
            <h2 className="text-lg font-semibold mb-4">Motion Heatmap</h2>
            <div className="aspect-video bg-muted rounded-lg flex items-center justify-center border border-border overflow-hidden">
              <img 
                src="/api/heatmap" 
                alt="Motion Heatmap" 
                className="w-full h-full object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  e.currentTarget.parentElement!.innerHTML = '<div class="text-center"><svg class="w-12 h-12 text-muted-foreground mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg><div class="text-muted-foreground text-sm">Motion heatmap visualization</div></div>'
                }}
              />
            </div>
            <div className="mt-4 flex items-center justify-between text-xs">
              <div className="flex items-center gap-4">
                {[
                  { label: 'Low', color: 'bg-blue-500' },
                  { label: 'Medium', color: 'bg-yellow-500' },
                  { label: 'High', color: 'bg-red-500' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div className={cn("w-4 h-4 rounded", item.color)} />
                    <span className="text-muted-foreground">{item.label}</span>
                  </div>
                ))}
              </div>
              <span className="text-muted-foreground font-mono">{formatTime(videoDuration)}</span>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="text-lg font-semibold mb-4">Activity Timeline</h2>
            <div className="relative h-32 bg-muted rounded-lg border border-border">
              {videoData.events.map((event) => (
                <div
                  key={event.id}
                  className={cn(
                    "absolute h-full rounded cursor-pointer transition-all hover:opacity-80",
                    event.priority === 'high' ? 'bg-red-500' : event.priority === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
                  )}
                  style={{
                    left: `${(event.start / videoDuration) * 100}%`,
                    width: `${Math.max((event.duration / videoDuration) * 100, 1)}%`,
                  }}
                  onClick={() => onEventSelect(event.id)}
                  title={`${event.id}: ${formatTime(event.start)} - ${formatTime(event.end)}`}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-3 font-mono">
              <span>0:00</span>
              <span>{formatTime(videoDuration / 4)}</span>
              <span>{formatTime(videoDuration / 2)}</span>
              <span>{formatTime(videoDuration * 3 / 4)}</span>
              <span>{formatTime(videoDuration)}</span>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-6">
            <h2 className="text-lg font-semibold mb-6">Quality Metrics</h2>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Observability</span>
                  <span className={cn('font-mono font-bold tabular-nums', obsTone.text)}>
                    {videoData.quality_metrics.observability.toFixed(2)}
                  </span>
                </div>
                {/* Colour tracks the value rather than being fixed green: a bar
                    that is green at 0.31 tells a reviewer the footage is
                    trustworthy when it is not. Track darkened from bg-muted so
                    the fill is legible on the warm canvas at any width. */}
                <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-[width] duration-700 ease-out', obsTone.bar)}
                    style={{ width: `${Math.max(2, videoData.quality_metrics.observability * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1 font-mono">
                  <span>0.0 unusable</span>
                  <span>1.0 clear</span>
                </div>
              </div>
              <div className="pt-4 space-y-2 border-t border-border">
                {[
                  ['Camera Shake', videoData.quality_metrics.cameraShake.toFixed(4)],
                  ['Blur Score', videoData.quality_metrics.blur.toFixed(2)],
                  ['Lighting', videoData.quality_metrics.lighting.toFixed(2)],
                  ['Occlusion', videoData.quality_metrics.occlusion.toFixed(2)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="text-lg font-semibold mb-4">Processing Info</h2>
            <div className="space-y-2 text-sm">
              {[
                ['Resolution', videoData.metadata.resolution],
                ['Frame Rate', `${videoData.metadata.fps} fps`],
                ['Sampling', videoData.metadata.sampling],
                ['Frames', videoData.metadata.frames.toLocaleString()],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {groups.length > 0 && (
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-1">
            <Network className="w-5 h-5 text-muted-foreground" strokeWidth={2} />
            <h2 className="text-lg font-semibold">Evidence Groups</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Events linked into a single pattern by recurring people, or by sharing a
            region close together in time.
          </p>
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.group_id} className="p-4 rounded-lg border border-border bg-muted/30">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="font-mono font-bold">{g.group_id}</span>
                  <span className="px-2 py-0.5 bg-primary text-primary-foreground rounded text-xs font-bold">
                    {g.size} linked events
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    spans {g.span_sec.toFixed(1)}s
                  </span>
                  {g.shared_track_ids.map((t) => (
                    <span key={t} className="px-2 py-0.5 bg-muted rounded text-xs font-mono">{t}</span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mb-2">
                  {g.event_ids.map((id) => (
                    <button
                      key={id}
                      onClick={() => onEventSelect(id)}
                      className="px-2 py-1 rounded border border-border bg-background hover:bg-accent transition-colors text-xs font-mono"
                    >
                      {id}
                    </button>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground">
                  {g.reasons.join(' · ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-6">
        <div className="flex items-center gap-2 mb-1">
          <Target className="w-5 h-5 text-muted-foreground" strokeWidth={2} />
          <h2 className="text-lg font-semibold">Investigation Focus</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Re-rank the same events for what you are actually looking for. Nothing is
          re-analysed -  only the weighting of existing signals changes.
        </p>
        <div className="flex flex-wrap gap-2">
          {INVESTIGATION_PROFILES.map((prof) => (
            <button
              key={prof.id}
              onClick={() => setProfile(prof.id)}
              title={prof.blurb}
              className={cn(
                'px-3 py-2 rounded-lg border text-sm transition-colors text-left',
                profile === prof.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'card card-hover'
              )}
            >
              {prof.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">
          Detected Segments
          {activeFilter !== 'all' && <span className="text-muted-foreground ml-2 text-sm">({filteredEvents.length} filtered)</span>}
          {profile !== 'none' && (
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              {ranking ? '· re-ranking…' : `· ranked by ${INVESTIGATION_PROFILES.find(p => p.id === profile)?.label}`}
            </span>
          )}
        </h2>
        <div className="space-y-2.5">
          {filteredEvents.map((event) => (
            <button
              key={event.id}
              onClick={() => onEventSelect(event.id)}
              className="group relative w-full pl-5 pr-4 py-4 rounded-xl border border-border bg-card text-left transition-all hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {/* Priority as a spine rather than only a pill: scanning a long
                  list, colour down the edge is readable at a glance where a
                  badge among six other badges is not. */}
              <span
                className={cn(
                  'absolute left-0 top-3 bottom-3 w-1 rounded-full',
                  event.priority === 'high'
                    ? 'bg-red-500'
                    : event.priority === 'medium'
                      ? 'bg-amber-500'
                      : 'bg-slate-300'
                )}
              />

              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="font-mono font-semibold text-sm">{event.id}</span>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wide',
                        event.priority === 'high'
                          ? 'bg-red-50 text-red-700'
                          : event.priority === 'medium'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-slate-100 text-slate-600'
                      )}
                    >
                      {event.priority}
                    </span>
                    <span className="px-2 py-0.5 bg-muted rounded-md text-[11px] font-mono text-muted-foreground">
                      {event.trackId}
                    </span>
                    {event.motionCharacter === 'sudden' && (
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded-md text-[11px] font-semibold">
                        <Zap className="w-3 h-3" strokeWidth={2.5} />
                        Sudden
                      </span>
                    )}
                  </div>

                  <div className="font-medium mb-2 truncate">{event.description}</div>

                  {/* Metrics labelled, and the motion value carries a small
                      inline bar - a bare "0.44" gives no sense of scale. */}
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      <span className="font-mono tabular-nums text-foreground">
                        {formatTime(event.start)}–{formatTime(event.end)}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono tabular-nums text-foreground">
                        {event.duration.toFixed(1)}s
                      </span>
                      long
                    </span>
                    <span className="flex items-center gap-2">
                      motion
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-14 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <span
                            className="block h-full bg-slate-500 rounded-full"
                            style={{ width: `${Math.min(100, event.motionScore * 100)}%` }}
                          />
                        </span>
                        <span className="font-mono tabular-nums text-foreground">
                          {event.motionScore.toFixed(2)}
                        </span>
                      </span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0 pt-0.5">
                  {event.profileScore !== undefined && (
                    <span
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-lg text-xs font-bold font-mono tabular-nums"
                      title={
                        event.profileSignals
                          ? Object.entries(event.profileSignals)
                              .map(([k, v]) => `${k}: ${Number(v).toFixed(2)}`)
                              .join(String.fromCharCode(10))
                          : undefined
                      }
                    >
                      <Target className="w-3 h-3" strokeWidth={2.5} />
                      {event.profileScore.toFixed(2)}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                </div>
              </div>
            </button>
          ))}

          {filteredEvents.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No segments match this filter.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
