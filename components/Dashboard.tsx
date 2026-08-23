'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Video, Activity, AlertTriangle, CheckCircle, Clock, Eye, Upload, Play, ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { JobStatus } from '@/lib/useUploadJob'
import { PageSkeleton } from './Skeleton'

interface DashboardProps {
  onVideoSelect: (videoId: string) => void
  job: JobStatus | null
  onUploadFile: (file: File) => void
}

interface VideoData {
  video_id: string
  video_path: string
  metadata: {
    resolution: string
    fps: number
    sampling: string
    frames: number
    processingTime: string
  }
  quality_metrics: {
    observability: number
    cameraShake: number
    blur: number
    lighting: number
    occlusion: number
  }
  event_count: number
  events: any[]
}

export default function Dashboard({ onVideoSelect, job, onUploadFile }: DashboardProps) {
  const [videoData, setVideoData] = useState<VideoData | null>(null)
  const [verdicts, setVerdicts] = useState<Record<string, string>>({})
  const [library, setLibrary] = useState<any[]>([])
  const [switching, setSwitching] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadVideoData = () => {
    fetch('/api/video')
      .then(res => res.json())
      .then(data => {
        // 404 ("No data available") comes back as { error: '...' } with a
        // 200-parseable body — treat it as "no video yet", not a crash.
        setVideoData(data && !data.error ? data : null)
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to load video data:', err)
        setVideoData(null)
        setLoading(false)
      })
  }

  // Reviewer verdicts, so the "Reviewed" tile reflects work actually done.
  // It was previously hardcoded to 0 with a "0%" caption, which meant the
  // dashboard kept reporting nothing reviewed no matter how much an
  // invigilator had got through - a stat that is always wrong is worse than
  // no stat, because people act on it.
  const loadVerdicts = () => {
    fetch('/api/offence-review')
      .then((r) => r.json())
      .then((d) => setVerdicts(d?.verdicts ?? {}))
      .catch(() => setVerdicts({}))
  }

  // Every processed run, not just the active one. Uploads used to overwrite a
  // single pointer, so each new video hid the previous one even though all of
  // its output was still on disk.
  const loadLibrary = () => {
    fetch('/api/videos')
      .then((r) => r.json())
      .then((d) => setLibrary(d?.videos ?? []))
      .catch(() => setLibrary([]))
  }

  const selectVideo = async (jobId: string) => {
    setSwitching(jobId)
    try {
      const res = await fetch('/api/videos/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      if (res.ok) {
        // Every other view resolves through the active pointer, so refresh the
        // dashboard's own data as well as the list.
        loadVideoData()
        loadVerdicts()
        loadLibrary()
      }
    } finally {
      setSwitching(null)
    }
  }

  useEffect(() => {
    loadVideoData()
    loadVerdicts()
    loadLibrary()
  }, [])

  // job/upload polling now lives in page.tsx (via useUploadJob) so it
  // survives switching tabs — this just reacts to the prop when it flips
  // to "done" and refreshes with the newly processed video's results.
  useEffect(() => {
    if (job?.state === 'done') {
      loadVideoData()
      loadVerdicts()
      loadLibrary()
    }
  }, [job?.state, job?.jobId])

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    onUploadFile(file)
  }

  if (loading) {
    <PageSkeleton variant="dashboard" label="Loading dashboard" />
  }

  // Calculate stats from real data (all zero when no video has been processed yet)
  const totalVideos = library.length
  const totalEvents = videoData?.event_count ?? 0
  const highPriorityCount = videoData ? videoData.events.filter(e => e.priority === 'high').length : 0

  // Findings a reviewer will actually see. Suppressed ones (CLIP contradicted
  // them - see clip_verify.py --filter) are excluded so this tile agrees with
  // the Findings list; counting them here would show a total the reviewer
  // could never work through.
  const totalOffences = videoData
    ? videoData.events.reduce(
        (n, e) => n + ((e.offences ?? []).filter((o: any) => !o.suppressed).length),
        0
      )
    : 0
  const reviewedCount = Object.keys(verdicts).length
  const reviewedPct = totalOffences > 0 ? Math.round((reviewedCount / totalOffences) * 100) : 0

  const stats = [
    { label: 'Videos Processed', value: totalVideos.toString(), icon: Video, change: totalVideos > 0 ? 'On this machine' : 'None yet' },
    { label: 'Motion Segments', value: totalEvents.toString(), icon: Activity, change: 'Windows of activity' },
    { label: 'Findings', value: totalOffences.toString(), icon: AlertTriangle, change: `${highPriorityCount} high priority` },
    {
      label: 'Reviewed',
      value: reviewedCount.toString(),
      icon: CheckCircle,
      change: totalOffences > 0 ? `${reviewedPct}% of findings` : 'Nothing to review yet',
    },
  ]

  /**
   * Activity per time slot.
   *
   * Bucket width is derived from the video's own length rather than fixed at
   * 10s: a fixed width gives 14 points on a 143s clip and over a thousand on a
   * three-hour recording, so the same chart is either too coarse to read or too
   * dense to render. Targeting a constant number of buckets keeps the shape
   * legible at any duration.
   *
   * Duration comes from the last event's end, falling back to 60s, because an
   * axis that stops before the footage does misrepresents where activity sat.
   */
  const TARGET_BUCKETS = 48
  const activityData = (() => {
    if (!videoData?.events?.length) return []
    const duration = Math.max(...videoData.events.map((e) => e.end), 60)
    const bucket = Math.max(1, duration / TARGET_BUCKETS)
    return Array.from({ length: Math.ceil(duration / bucket) }, (_, i) => {
      const from = i * bucket
      const to = from + bucket
      // An event counts in every bucket it spans, so a long event reads as a
      // plateau rather than a single spike at its start.
      const active = videoData.events.filter((e) => e.start < to && e.end > from)
      return {
        t: from,
        events: active.length,
        // Peak motion in the slot: distinguishes "four quiet events overlap"
        // from "one violent event", which a bare count cannot.
        intensity: active.length ? Math.max(...active.map((e) => e.motionScore ?? 0)) : 0,
      }
    })
  })()

  const fmtClock = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  // Format video for display
  const video = videoData ? {
    id: videoData.video_id,
    name: videoData.video_id,
    // The end of the last detected segment, NOT the video's length - the
    // backend's metadata carries no duration field. Labelled accordingly
    // rather than presented as a runtime it is not: on footage that goes
    // quiet before the end, the two differ by minutes.
    lastActivity: `${Math.floor(videoData.events[videoData.events.length - 1]?.end / 60)}:${Math.floor(videoData.events[videoData.events.length - 1]?.end % 60).toString().padStart(2, '0')}`,
    status: 'completed',
    events: videoData.event_count,
    quality: videoData.quality_metrics.observability,
    timestamp: 'Recently processed'
  } : null

  const isBusy = !!job && job.state !== 'done' && job.state !== 'error'

  return (
    <div className="p-8 space-y-8 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">
            Analytics <span className="font-normal text-muted-foreground">Dashboard</span>
          </h1>
          <p className="text-muted-foreground">Stats below are for the video currently being viewed</p>
        </div>

        <div className="flex-shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,.mp4,.mkv,.mov,.avi,.webm"
            onChange={handleFileSelected}
            className="hidden"
          />
          {/* The button reports the pipeline's state instead of going grey and
              silent: a fifteen-minute job that disables its own trigger with no
              explanation reads as a broken button. */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            className={cn(
              'relative flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium overflow-hidden',
              'transition-all duration-200 active:scale-[0.98]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              isBusy
                ? 'bg-primary/10 text-primary cursor-progress'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-sm'
            )}
          >
            {isBusy && (
              <span
                className="absolute inset-0 bg-primary/15 transition-[width] duration-700 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, job?.percent ?? 0))}%` }}
              />
            )}
            <span className="relative flex items-center gap-2">
              {isBusy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                  <span className="tabular-nums">
                    Processing {Math.round(job?.percent ?? 0)}%
                  </span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" strokeWidth={2} />
                  Upload Video
                </>
              )}
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => {
          const Icon = stat.icon
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="card p-6 card-hover"
            >
              {/* Icon and value share a row and a baseline: the number is the
                  content, so it should not sit a block below its own label. */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {stat.change}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/5 rounded-xl flex-shrink-0">
                  <Icon className="w-6 h-6 text-primary" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="text-3xl font-bold leading-none tabular-nums">{stat.value}</div>
                  <div className="text-sm text-muted-foreground mt-1.5 truncate">{stat.label}</div>
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold">Activity Timeline</h2>
              <p className="text-sm text-muted-foreground">Peak motion over time · last activity at {video?.lastActivity ?? '—'}</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={activityData}>
              <defs>
                <linearGradient id="colorEvents" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(215 25% 27%)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="hsl(215 25% 27%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 89%)" />
              <XAxis
                dataKey="t"
                stroke="hsl(215 16% 47%)"
                tick={{ fontSize: 11 }}
                tickFormatter={fmtClock}
                minTickGap={28}
              />
              {/* Motion is 0-1, so a fixed domain keeps the shape comparable
                  between videos instead of auto-scaling each one to fill the
                  panel and making every clip look equally active. */}
              <YAxis
                stroke="hsl(215 16% 47%)"
                tick={{ fontSize: 11 }}
                domain={[0, 1]}
                ticks={[0, 0.25, 0.5, 0.75, 1]}
                tickFormatter={(v: number) => v.toFixed(2)}
                width={36}
              />
              <Tooltip
                cursor={{ stroke: 'hsl(215 16% 47%)', strokeDasharray: '3 3' }}
                labelFormatter={(v) => `At ${fmtClock(Number(v))}`}
                formatter={(value: any, _name: string, entry: any) => [
                  `${Number(value).toFixed(2)} peak motion · ${entry?.payload?.events ?? 0} segment${entry?.payload?.events === 1 ? '' : 's'} active`,
                  '',
                ]}
                contentStyle={{
                  background: 'hsl(0 0% 100%)',
                  border: '1px solid hsl(0 0% 89%)',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              {/* Peak motion per bucket, not segment count. Counting overlapping
                  segments produced a flat line at 1 for the whole video - true,
                  but it showed nothing about where the activity actually was.
                  stepAfter rather than a smoothed curve: each bucket is a
                  measured value, and interpolating between them would draw
                  motion that was never recorded. */}
              <Area
                type="stepAfter"
                dataKey="intensity"
                stroke="hsl(215 25% 27%)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorEvents)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-semibold mb-6">System Health</h2>
          <div className="space-y-6">
            {[
              { label: 'Processing Queue', value: '0/1', percent: 0 },
              { label: 'Segments Detected', value: totalEvents.toString(), percent: (totalEvents / 10) * 100 },
              { label: 'Quality Score', value: videoData ? (videoData.quality_metrics.observability * 100).toFixed(0) + '%' : '—', percent: (videoData?.quality_metrics.observability ?? 0) * 100 },
            ].map((item, i) => (
              <div key={i}>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-mono font-medium">{item.value}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, item.percent)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold">Recent Videos</h2>
            <p className="text-sm text-muted-foreground">Every video processed on this machine. Switching changes what the other tabs show.</p>
          </div>
        </div>
        {library.length > 0 ? (
          <div className="space-y-3">
            {library.map((v) => {
              const isSwitching = switching === v.jobId
              const done = v.state === 'done' && v.hasResults
              return (
                <div
                  key={v.jobId}
                  className={cn(
                    'group w-full p-4 rounded-xl border bg-card text-left transition-all',
                    v.isActive
                      ? 'border-primary/50 bg-primary/[0.03] shadow-sm'
                      : 'border-border hover:border-primary/30 hover:shadow-sm'
                  )}
                >
                  <div className="flex items-center gap-4">
                    {/* The active video shows its own heatmap; the rest use a
                        placeholder, since /api/heatmap only ever serves whatever
                        is currently selected and would otherwise label every row
                        with the same image. */}
                    <div className="relative w-28 h-16 rounded-lg overflow-hidden bg-muted flex-shrink-0 border border-border">
                      {v.isActive && done ? (
                        <img
                          src="/api/heatmap"
                          alt=""
                          className="w-full h-full object-cover opacity-90 transition-transform duration-300 group-hover:scale-105"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Video className="w-5 h-5 text-muted-foreground" strokeWidth={2} />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="font-medium truncate">{v.filename}</span>
                        {v.isActive && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[11px] rounded-full font-medium border border-emerald-200 flex-shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Viewing
                          </span>
                        )}
                        {!done && (
                          <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-[11px] rounded-full font-medium border border-amber-200 flex-shrink-0">
                            {v.state}
                          </span>
                        )}
                      </div>

                      {/* Labelled metrics: a bare "18" beside a bare "4" does not
                          tell a reviewer which is which. */}
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Activity className="w-3.5 h-3.5" />
                          <span className="font-mono tabular-nums text-foreground">{v.eventCount}</span>
                          segments
                        </span>
                        {v.offenceCount !== null && (
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span className="font-mono tabular-nums text-foreground">{v.offenceCount}</span>
                            findings
                          </span>
                        )}
                        {v.sizeMb !== null && (
                          <span className="text-muted-foreground">
                            <span className="font-mono tabular-nums text-foreground">{v.sizeMb}</span> MB
                          </span>
                        )}
                        {v.startedAt && (
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Clock className="w-3.5 h-3.5" />
                            {new Date(v.startedAt).toLocaleString('en-GB', {
                              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!v.isActive && done && (
                        <button
                          onClick={() => selectVideo(v.jobId)}
                          disabled={isSwitching}
                          className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium transition-all hover:bg-accent active:scale-[0.98] disabled:opacity-50 disabled:cursor-wait"
                        >
                          {isSwitching ? 'Switching…' : 'View'}
                        </button>
                      )}
                      {v.isActive && done && (
                        <button
                          onClick={() => onVideoSelect(v.videoId ?? v.jobId)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium transition-all hover:bg-primary/90 active:scale-[0.98]"
                        >
                          Analyse
                          <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2.5} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="py-12 flex flex-col items-center justify-center text-center">
            <div className="w-14 h-14 bg-muted rounded-lg flex items-center justify-center mb-4">
              <Video className="w-6 h-6 text-muted-foreground" strokeWidth={2} />
            </div>
            <div className="font-medium mb-1">No videos processed yet</div>
            <p className="text-sm text-muted-foreground mb-4">Upload a video to run it through the analytics pipeline.</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-all duration-200 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload className="w-4 h-4" strokeWidth={2} />
              Upload Video
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
