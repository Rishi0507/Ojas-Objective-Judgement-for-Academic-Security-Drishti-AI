'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Video, Activity, AlertTriangle, CheckCircle, Clock, TrendingUp, Eye, Upload } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { JobStatus } from '@/lib/useUploadJob'

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

  useEffect(() => {
    loadVideoData()
  }, [])

  // job/upload polling now lives in page.tsx (via useUploadJob) so it
  // survives switching tabs — this just reacts to the prop when it flips
  // to "done" and refreshes with the newly processed video's results.
  useEffect(() => {
    if (job?.state === 'done') {
      loadVideoData()
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
  const totalVideos = videoData ? 1 : 0
  const totalEvents = videoData?.event_count ?? 0
  const highPriorityCount = videoData ? videoData.events.filter(e => e.priority === 'high').length : 0
  const reviewedCount = 0 // None reviewed yet

  const stats = [
    { label: 'Total Videos', value: totalVideos.toString(), icon: Video, change: videoData ? 'Processed' : 'None yet' },
    { label: 'Segments Detected', value: totalEvents.toString(), icon: Activity, change: 'Motion windows' },
    { label: 'High Priority', value: highPriorityCount.toString(), icon: AlertTriangle, change: 'Unreviewed' },
    { label: 'Reviewed', value: reviewedCount.toString(), icon: CheckCircle, change: '0%' },
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
    duration: `${Math.floor(videoData.events[videoData.events.length - 1]?.end / 60)}:${Math.floor(videoData.events[videoData.events.length - 1]?.end % 60).toString().padStart(2, '0')}`,
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
          <p className="text-muted-foreground">Real-time insights from CCTV monitoring</p>
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
              <p className="text-sm text-muted-foreground">Video duration: {video?.duration ?? '—'}</p>
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
            <p className="text-sm text-muted-foreground">Click to view analysis</p>
          </div>
        </div>
        {video ? (
          <div className="space-y-3">
            <button
              onClick={() => onVideoSelect(video.id)}
              className="w-full p-4 card card-hover text-left"
            >
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-primary/5 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Video className="w-6 h-6 text-primary" strokeWidth={2} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-medium mb-1">{video.name}</div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {video.duration}
                    </span>
                    <span>•</span>
                    <span>{video.events} segments</span>
                    <span>•</span>
                    <span className="flex items-center gap-1 font-mono">
                      <Eye className="w-4 h-4" />
                      {video.quality.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <div className="text-xs text-muted-foreground mb-2">{video.timestamp}</div>
                  <span className="inline-flex items-center px-3 py-1 bg-green-50 text-green-700 text-xs rounded-full font-medium border border-green-200">
                    Completed
                  </span>
                </div>
              </div>
            </button>
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
