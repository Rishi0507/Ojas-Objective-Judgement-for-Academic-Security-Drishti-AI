'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Video, Activity, AlertTriangle, CheckCircle, Clock, Eye, Upload } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { JobStatus } from '@/lib/useUploadJob'
import { cn } from '@/lib/utils'

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
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-muted-foreground">Loading dashboard...</div>
      </div>
    )
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

  // Generate activity data from events
  const activityData = videoData ? Array.from({ length: Math.ceil(videoData.events[videoData.events.length - 1]?.end / 10) || 24 }, (_, i) => {
    const timeSlot = i * 10
    const eventsInSlot = videoData.events.filter(e =>
      e.start <= timeSlot + 10 && e.end >= timeSlot
    ).length
    return {
      hour: timeSlot,
      events: eventsInSlot
    }
  }) : []

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

  return (
    <div className="p-8 space-y-8 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">
            Analytics <span className="font-serif italic">Dashboard</span>
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
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!!job && job.state !== 'done' && job.state !== 'error'}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload className="w-4 h-4" strokeWidth={2} />
            Upload Video
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
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 bg-primary/5 rounded-lg">
                  <Icon className="w-6 h-6 text-primary" strokeWidth={2} />
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  {stat.change}
                </div>
              </div>
              <div className="text-3xl font-bold mb-1">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </motion.div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold">Activity Timeline</h2>
              <p className="text-sm text-muted-foreground">Last activity at {video?.lastActivity ?? '—'}</p>
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
                dataKey="hour" 
                stroke="hsl(215 16% 47%)" 
                tick={{ fontSize: 12 }}
                tickFormatter={(val) => `${val}s`}
              />
              <YAxis stroke="hsl(215 16% 47%)" tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{ 
                  background: 'hsl(0 0% 100%)', 
                  border: '1px solid hsl(0 0% 89%)', 
                  borderRadius: '8px',
                  fontSize: '12px'
                }}
              />
              <Area 
                type="monotone" 
                dataKey="events" 
                stroke="hsl(215 25% 27%)" 
                strokeWidth={2}
                fillOpacity={1} 
                fill="url(#colorEvents)" 
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
                    'w-full p-4 card text-left transition-colors',
                    v.isActive && 'border-primary bg-primary/5'
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-primary/5 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Video className="w-6 h-6 text-primary" strokeWidth={2} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="font-medium mb-1 truncate">{v.filename}</div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                        <span>{v.eventCount} segments</span>
                        {v.offenceCount !== null && (
                          <>
                            <span>&middot;</span>
                            <span>{v.offenceCount} findings</span>
                          </>
                        )}
                        {v.sizeMb !== null && (
                          <>
                            <span>&middot;</span>
                            <span className="font-mono text-xs">{v.sizeMb} MB</span>
                          </>
                        )}
                        {v.startedAt && (
                          <>
                            <span>&middot;</span>
                            <span className="text-xs">
                              {new Date(v.startedAt).toLocaleString('en-GB', {
                                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!done && (
                        <span className="px-3 py-1 bg-amber-50 text-amber-700 text-xs rounded-full font-medium border border-amber-200">
                          {v.state}
                        </span>
                      )}
                      {v.isActive ? (
                        <span className="px-3 py-1 bg-green-50 text-green-700 text-xs rounded-full font-medium border border-green-200">
                          Viewing
                        </span>
                      ) : (
                        done && (
                          <button
                            onClick={() => selectVideo(v.jobId)}
                            disabled={isSwitching}
                            className="px-3 py-1.5 border border-border rounded-md text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
                          >
                            {isSwitching ? 'Switching…' : 'View'}
                          </button>
                        )
                      )}
                      {v.isActive && done && (
                        <button
                          onClick={() => onVideoSelect(v.videoId ?? v.jobId)}
                          className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:bg-primary/90 transition-colors"
                        >
                          Analyse
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
              disabled={!!job && job.state !== 'done' && job.state !== 'error'}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
