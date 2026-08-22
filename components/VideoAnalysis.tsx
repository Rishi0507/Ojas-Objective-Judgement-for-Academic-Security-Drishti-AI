'use client'

import { useState, useEffect } from 'react'
import { ArrowLeft, Activity, Phone, Users, TrendingUp, Filter, Download, Eye, Clock, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

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

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = (seconds % 60).toFixed(1)
  return `${mins}:${secs.padStart(4, '0')}`
}

export default function VideoAnalysis({ videoId, onEventSelect, onBack }: VideoAnalysisProps) {
  const [activeFilter, setActiveFilter] = useState('all')
  const [videoData, setVideoData] = useState<VideoData | null>(null)
  const [loading, setLoading] = useState(true)

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

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-muted-foreground">Loading video analysis...</div>
      </div>
    )
  }

  if (!videoData) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-muted-foreground">Failed to load video data</div>
      </div>
    )
  }

  const filteredEvents = videoData.events.filter(event => {
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
    { id: 'all', label: 'All Events', count: videoData.event_count, icon: Activity },
    { id: 'phone', label: 'Phone Activity', count: phoneCount, icon: Phone },
    { id: 'proximity', label: 'Proximity', count: proximityCount, icon: Users },
    { id: 'unusual', label: 'Unusual Motion', count: unusualCount, icon: TrendingUp },
  ]

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
              <span>{videoData.event_count} events</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 card card-hover flex items-center gap-2">
            <Filter className="w-4 h-4" strokeWidth={2} />
            Filters
          </button>
          <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2">
            <Download className="w-4 h-4" strokeWidth={2} />
            Export
          </button>
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
                  <span className="font-mono font-bold text-green-600">{videoData.quality_metrics.observability.toFixed(2)}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-green-600 rounded-full" style={{ width: `${videoData.quality_metrics.observability * 100}%` }} />
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

      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4">
          Detected Events 
          {activeFilter !== 'all' && <span className="text-muted-foreground ml-2 text-sm">({filteredEvents.length} filtered)</span>}
        </h2>
        <div className="space-y-3">
          {filteredEvents.map((event) => (
            <button
              key={event.id}
              onClick={() => onEventSelect(event.id)}
              className="w-full p-4 card card-hover text-left"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono font-bold">{event.id}</span>
                    <span className={cn(
                      "px-2 py-0.5 rounded text-xs font-bold",
                      event.priority === 'high' 
                        ? 'bg-red-50 text-red-700 border border-red-200' 
                        : event.priority === 'medium'
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-blue-50 text-blue-700 border border-blue-200'
                    )}>
                      {event.priority.toUpperCase()}
                    </span>
                    <span className="px-2 py-0.5 bg-muted rounded text-xs font-mono">{event.trackId}</span>
                    {event.motionCharacter === 'sudden' && (
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded text-xs font-bold">
                        <Zap className="w-3 h-3" strokeWidth={2.5} />
                        SUDDEN
                      </span>
                    )}
                  </div>
                  <div className="font-medium mb-2">{event.description}</div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground font-mono">
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {formatTime(event.start)} - {formatTime(event.end)}
                    </span>
                    <span>Duration: {event.duration.toFixed(1)}s</span>
                    <span>Motion: {event.motionScore.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
