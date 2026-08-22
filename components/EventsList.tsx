'use client'

import { useState, useEffect, useMemo } from 'react'
import { Search, Clock, ListFilter, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  status?: string
  motionCharacter?: string
  jerkScore?: number
}

interface VideoData {
  video_id: string
  event_count: number
  events: EventData[]
}

interface EventsListProps {
  onEventSelect: (eventId: string) => void
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = (seconds % 60).toFixed(1)
  return `${mins}:${secs.padStart(4, '0')}`
}

function formatType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

export default function EventsList({ onEventSelect }: EventsListProps) {
  const [videoData, setVideoData] = useState<VideoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [motionFilter, setMotionFilter] = useState('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    fetch('/api/video')
      .then((res) => res.json())
      .then((data) => {
        setVideoData(data)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load events:', err)
        setLoading(false)
      })
  }, [])

  const types = useMemo(() => {
    if (!videoData) return []
    return Array.from(new Set(videoData.events.map((e) => e.type)))
  }, [videoData])

  const priorityCounts = useMemo(() => {
    const counts: Record<string, number> = { high: 0, medium: 0, low: 0 }
    videoData?.events.forEach((e) => {
      counts[e.priority] = (counts[e.priority] ?? 0) + 1
    })
    return counts
  }, [videoData])

  const hasMotionCharacter = useMemo(
    () => !!videoData?.events.some((e) => e.motionCharacter),
    [videoData]
  )

  const filteredEvents = useMemo(() => {
    if (!videoData) return []
    const q = query.trim().toLowerCase()
    return videoData.events
      .filter((e) => priorityFilter === 'all' || e.priority === priorityFilter)
      .filter((e) => typeFilter === 'all' || e.type === typeFilter)
      .filter((e) => motionFilter === 'all' || e.motionCharacter === motionFilter)
      .filter((e) =>
        !q ||
        e.id.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.trackId?.toLowerCase().includes(q)
      )
      .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3) || a.start - b.start)
  }, [videoData, priorityFilter, typeFilter, motionFilter, query])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-muted-foreground">Loading events...</div>
      </div>
    )
  }

  if (!videoData) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-muted-foreground">Failed to load events</div>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-4xl font-bold tracking-tight mb-2">
          All <span className="font-serif italic">Events</span>
        </h1>
        <p className="text-muted-foreground">
          {videoData.event_count} events detected across processed footage
        </p>
      </div>

      <div className="card p-4 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" strokeWidth={2} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by event ID, description, or track..."
            className="w-full pl-10 pr-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground transition-colors"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
            <ListFilter className="w-3.5 h-3.5" strokeWidth={2} />
            Priority
          </span>
          {['all', 'high', 'medium', 'low'].map((p) => (
            <button
              key={p}
              onClick={() => setPriorityFilter(p)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors capitalize',
                priorityFilter === p
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-accent'
              )}
            >
              {p} {p !== 'all' && `(${priorityCounts[p] ?? 0})`}
            </button>
          ))}
        </div>

        {types.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
              <ListFilter className="w-3.5 h-3.5" strokeWidth={2} />
              Type
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
              All
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
                {formatType(t)}
              </button>
            ))}
          </div>
        )}

        {hasMotionCharacter && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
              <Zap className="w-3.5 h-3.5" strokeWidth={2} />
              Motion
            </span>
            {['all', 'sudden', 'gradual'].map((mc) => (
              <button
                key={mc}
                onClick={() => setMotionFilter(mc)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors capitalize',
                  motionFilter === mc
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:bg-accent'
                )}
              >
                {mc}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {filteredEvents.length} {filteredEvents.length === 1 ? 'Event' : 'Events'}
          </h2>
        </div>

        {filteredEvents.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No events match these filters.</div>
        ) : (
          <div className="space-y-3">
            {filteredEvents.map((event) => (
              <button
                key={event.id}
                onClick={() => onEventSelect(event.id)}
                className="w-full p-4 card card-hover text-left"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="font-mono font-bold">{event.id}</span>
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded text-xs font-bold',
                          event.priority === 'high'
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : event.priority === 'medium'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                        )}
                      >
                        {event.priority.toUpperCase()}
                      </span>
                      <span className="px-2 py-0.5 bg-muted rounded text-xs font-mono">{formatType(event.type)}</span>
                      <span className="px-2 py-0.5 bg-muted rounded text-xs font-mono">{event.trackId}</span>
                      {event.motionCharacter === 'sudden' && (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded text-xs font-bold">
                          <Zap className="w-3 h-3" strokeWidth={2.5} />
                          SUDDEN
                        </span>
                      )}
                    </div>
                    <div className="font-medium mb-2">{event.description}</div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground font-mono flex-wrap">
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {formatTime(event.start)} - {formatTime(event.end)}
                      </span>
                      <span>Duration: {event.duration.toFixed(1)}s</span>
                      <span>Motion: {event.motionScore.toFixed(2)}</span>
                      <span className="text-xs">{event.videoId}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
