'use client'

import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Play, Pause, CheckCircle, AlertTriangle, Eye, EyeOff, CheckSquare, XCircle, AlertCircle, Copy, Flag, Zap, Camera } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EventDetailProps {
  eventId: string
  onBack: () => void
}

interface EventData {
  id: string
  videoId: string
  start: number
  end: number
  duration: number
  motionScore: number
  cameraShake: number
  priority: string
  type: string
  description: string
  trackId: string
  roi: number[]
  clipUrl: string
  annotatedClipUrl?: string
  detection: {
    confidence: number
    object: string
  }
  observability: number
  qualityFactors: {
    observability: number
    cameraShake: number
    blur: number
    lighting: number
    occlusion: number
  }
  evidence?: string[]
  person_tracks?: any[]
  object_detections?: any[]
  motionCharacter?: string
  jerkScore?: number
  offences?: OffenceData[]
  snapshots?: string[]
}

interface OffenceData {
  type: string
  label: string
  trackId?: string
  startSec: number
  endSec: number
  frameIdx: number
  confidence: number
  bbox?: number[]
  durationSec?: number
  count?: number
  snapshot?: string
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

const feedbackOptions = [
  { id: 'relevant', label: 'Relevant Segment', icon: CheckCircle },
  { id: 'normal', label: 'Normal Behavior', icon: CheckSquare },
  { id: 'wrong_roi', label: 'Wrong ROI', icon: AlertCircle },
  { id: 'wrong_object', label: 'Wrong Object', icon: XCircle },
  { id: 'duplicate', label: 'Duplicate', icon: Copy },
]

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = (seconds % 60).toFixed(1)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(4, '0')}`
}

export default function EventDetail({ eventId, onBack }: EventDetailProps) {
  const [selectedFeedback, setSelectedFeedback] = useState<string | null>(null)
  const [showExplanation, setShowExplanation] = useState(true)
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(false)
  const [eventData, setEventData] = useState<EventData | null>(null)
  const [sourceVideoPath, setSourceVideoPath] = useState<string | null>(null)
  const [videoFps, setVideoFps] = useState<number>(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [currentFrameIdx, setCurrentFrameIdx] = useState(0)
  const [snapshotNote, setSnapshotNote] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    // Load event data
    fetch('/api/video')
      .then(res => res.json())
      .then(data => {
        setSourceVideoPath(data.source_video_path ?? null)
        setVideoFps(Number(data?.metadata?.fps) || 0)
        const event = data.events.find((e: EventData) => e.id === eventId)
        if (event) setEventData(event)
      })
      .catch(err => console.error('Failed to load event:', err))
  }, [eventId])

  // When a per-event clip exists we play that directly, so its timeline
  // starts at 0 rather than at the event's offset within the full video.
  const usingEventClip = !!eventData?.clipUrl
  const clipOffset = usingEventClip ? (eventData?.start ?? 0) : 0

  // Prefer the burned-in annotated clip when the user wants boxes, then the
  // plain event clip, and only fall back to the full recording if neither
  // was generated (e.g. ffmpeg unavailable during processing).
  const activeSrc = (showBoundingBoxes && eventData?.annotatedClipUrl)
    || eventData?.clipUrl
    || sourceVideoPath

  // Sync isPlaying with the native video element play/pause events.
  // This is kept separate from the timeupdate effect so it also picks up
  // play/pause triggered by clicking the video element directly.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  })

  useEffect(() => {
    const video = videoRef.current
    if (!video || !eventData) return

    const handleTimeUpdate = () => {
      const absoluteTime = clipOffset + video.currentTime
      setCurrentTime(absoluteTime)

      if (videoFps > 0) {
        setCurrentFrameIdx(Math.floor(absoluteTime * videoFps))
      }

      if (!usingEventClip && absoluteTime >= eventData.end) {
        video.pause()
        setIsPlaying(false)
      }
    }

    video.addEventListener('timeupdate', handleTimeUpdate)
    return () => video.removeEventListener('timeupdate', handleTimeUpdate)
  }, [eventData, videoFps, usingEventClip, clipOffset])

  const handlePlayPause = () => {
    if (!videoRef.current || !eventData) return

    if (isPlaying) {
      videoRef.current.pause()
    } else {
      // Restart from the beginning of the event once it has run to the end.
      const atEnd = usingEventClip
        ? videoRef.current.ended || videoRef.current.currentTime >= eventData.duration - 0.05
        : videoRef.current.currentTime >= eventData.end
      if (atEnd) {
        videoRef.current.currentTime = usingEventClip ? 0 : eventData.start
      }
      videoRef.current.play()
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current || !eventData) return
    const fraction = parseFloat(e.target.value) / 100
    videoRef.current.currentTime = usingEventClip
      ? fraction * eventData.duration
      : eventData.start + fraction * eventData.duration
  }

  const getSeekPosition = () => {
    if (!eventData || !eventData.duration) return 0
    return ((currentTime - eventData.start) / eventData.duration) * 100
  }

  /** Seeks the player to an absolute time in the source recording. */
  const jumpTo = (absoluteSec: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = usingEventClip
      ? Math.max(0, absoluteSec - clipOffset)
      : absoluteSec
    video.play().catch(() => {})
    video.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  /**
   * Grabs the current frame as a PNG the investigator can attach to a report.
   * Drawing the <video> straight onto a canvas keeps whatever is on screen,
   * and when the annotated clip is selected that includes the detection boxes.
   */
  const handleSnapshot = () => {
    const video = videoRef.current
    if (!video || !eventData) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx || !canvas.width || !canvas.height) {
      setSnapshotNote('Snapshot failed — video not ready yet')
      return
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    canvas.toBlob((blob) => {
      if (!blob) {
        setSnapshotNote('Snapshot failed')
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${eventData.id}_${formatTime(currentTime).replace(':', 'm')}s.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setSnapshotNote(`Saved snapshot at ${formatTime(currentTime)}`)
      setTimeout(() => setSnapshotNote(null), 4000)
    }, 'image/png')
  }

  const handleSubmitFeedback = () => {
    if (selectedFeedback) {
      console.log('Feedback submitted:', { eventId, feedback: selectedFeedback })
      alert(`Feedback "${selectedFeedback}" submitted for ${eventId}`)
    }
  }

  if (!eventData) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-muted-foreground">Loading event details...</div>
      </div>
    )
  }

  const priorityColor = eventData.priority === 'high' ? 'red' : eventData.priority === 'medium' ? 'yellow' : 'blue'

  return (
    <div className="p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-accent rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" strokeWidth={2} />
          </button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Segment <span className="font-serif italic">Details</span>
            </h1>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="font-mono">{eventData.id}</span>
              <span>•</span>
              <span>{eventData.trackId}</span>
              <span>•</span>
              <span className={cn(
                selectedFeedback ? 'text-green-600' : `text-${priorityColor}-600`
              )}>
                {selectedFeedback ? 'Reviewed' : eventData.priority.charAt(0).toUpperCase() + eventData.priority.slice(1) + ' Priority'}
              </span>
              {eventData.motionCharacter === 'sudden' && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1 text-purple-700 font-medium">
                    <Zap className="w-4 h-4" strokeWidth={2.5} />
                    Sudden Onset
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <span className={cn(
          "px-4 py-2 rounded-lg font-bold text-sm",
          selectedFeedback 
            ? 'bg-green-50 text-green-700 border border-green-200' 
            : `bg-${priorityColor}-50 text-${priorityColor}-700 border border-${priorityColor}-200`
        )}>
          {selectedFeedback ? '✓ REVIEWED' : '⚠ UNREVIEWED'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card overflow-hidden">
            <div className="relative aspect-video bg-muted">
              <video
                ref={videoRef}
                key={activeSrc ?? 'none'}
                className="w-full h-full object-contain cursor-pointer"
                crossOrigin="anonymous"
                src={activeSrc ? `/api/stream?path=${encodeURIComponent(activeSrc)}` : undefined}
                onClick={handlePlayPause}
              >
                Your browser does not support video playback.
              </video>
              {/* Frame overlay is only needed as a fallback: when a burned-in
                  annotated clip exists, the boxes are already in the video. */}
              {showBoundingBoxes && !eventData.annotatedClipUrl && currentFrameIdx > 0 && (
                <div className="absolute inset-0 pointer-events-none">
                  <img
                    src={`/api/annotated?frame=${currentFrameIdx}`}
                    alt="Annotated frame"
                    className="w-full h-full object-contain"
                    style={{ mixBlendMode: 'normal' }}
                  />
                </div>
              )}
              <div className="absolute top-4 right-4 px-3 py-1 bg-card/90 backdrop-blur-sm rounded-lg border border-border font-mono text-sm">
                {formatTime(eventData.start)} - {formatTime(eventData.end)}
              </div>

            </div>
            <div className="p-4 border-t border-border space-y-3">
              <div className="flex items-center gap-3">
                <button 
                  onClick={handlePlayPause}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-4 h-4" strokeWidth={2} />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" strokeWidth={2} />
                      Play Segment
                    </>
                  )}
                </button>
                <button
                  onClick={() => setShowBoundingBoxes(!showBoundingBoxes)}
                  className={cn(
                    "px-4 py-2 rounded-lg transition-colors flex items-center gap-2 border",
                    showBoundingBoxes
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-accent"
                  )}
                >
                  {showBoundingBoxes ? (
                    <>
                      <Eye className="w-4 h-4" strokeWidth={2} />
                      Showing Boxes
                    </>
                  ) : (
                    <>
                      <EyeOff className="w-4 h-4" strokeWidth={2} />
                      Show Bounding Boxes
                    </>
                  )}
                </button>
                <button
                  onClick={handleSnapshot}
                  className="px-4 py-2 rounded-lg transition-colors flex items-center gap-2 border bg-background border-border hover:bg-accent"
                  title="Save the current frame as a PNG"
                >
                  <Camera className="w-4 h-4" strokeWidth={2} />
                  Snapshot
                </button>
                <div className="flex-1" />
                <span className="font-mono text-sm text-muted-foreground">{eventData.duration.toFixed(1)}s</span>
              </div>
              {snapshotNote && (
                <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">
                  {snapshotNote}
                </div>
              )}
              {!usingEventClip && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  No extracted clip for this segment — playing the full recording. Re-process the
                  video to generate per-segment clips.
                </div>
              )}
              {showBoundingBoxes && (
                <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded border border-border">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-green-500 rounded" />
                      Person
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-red-500 rounded" />
                      Phone
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-orange-500 rounded" />
                      Book
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-yellow-400 rounded" />
                      Other
                    </span>
                    <span className="ml-auto font-mono">Frame: {currentFrameIdx}</span>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={getSeekPosition()}
                  onChange={handleSeek}
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, hsl(215 25% 27%) 0%, hsl(215 25% 27%) ${getSeekPosition()}%, hsl(0 0% 96%) ${getSeekPosition()}%, hsl(0 0% 96%) 100%)`
                  }}
                />
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-foreground font-semibold tabular-nums">{formatTime(currentTime)}</span>
                  <span className="text-muted-foreground">{formatTime(eventData.end)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Evidence & Analysis</h2>
              <button
                onClick={() => setShowExplanation(!showExplanation)}
                className="px-3 py-1 card card-hover text-sm flex items-center gap-2"
              >
                {showExplanation ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {showExplanation ? 'Hide' : 'Show'}
              </button>
            </div>

            {showExplanation && (
              <div className="space-y-4">
                <div className={cn(
                  "p-4 border rounded-lg",
                  eventData.priority === 'high' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'
                )}>
                  <div className="flex items-start gap-3">
                    <AlertTriangle className={cn(
                      "w-5 h-5 flex-shrink-0 mt-0.5",
                      eventData.priority === 'high' ? 'text-red-600' : 'text-blue-600'
                    )} strokeWidth={2} />
                    <div>
                      <div className="font-semibold mb-2">{eventData.type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</div>
                      <p className="text-sm text-foreground/80 leading-relaxed">
                        {eventData.description}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Detection Confidence', value: (eventData.detection.confidence * 100).toFixed(0) + '%' },
                    { label: 'Motion Intensity', value: eventData.motionScore.toFixed(2) },
                    { label: 'Observability', value: eventData.observability.toFixed(2) },
                    { label: 'Camera Shake', value: eventData.cameraShake.toFixed(4) },
                    ...(eventData.jerkScore !== undefined
                      ? [{ label: 'Jerk Saliency (FFT)', value: eventData.jerkScore.toFixed(2) }]
                      : []),
                  ].map((item) => (
                    <div key={item.label} className="card p-4">
                      <div className="text-xs text-muted-foreground mb-1">{item.label}</div>
                      <div className="text-2xl font-bold font-mono">{item.value}</div>
                    </div>
                  ))}
                </div>

                <div className="card p-4">
                  <div className="text-sm font-semibold mb-3">Supporting Evidence</div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    {[
                      `Motion score: ${eventData.motionScore.toFixed(2)} (peak), ${eventData.detection.confidence.toFixed(2)} (mean)`,
                      `Observability: ${eventData.observability.toFixed(2)}`,
                      `ROI coordinates: [${eventData.roi.join(', ')}]`,
                      `Detection object: ${eventData.detection.object}`,
                      `Camera motion: ${(eventData.cameraShake * 100).toFixed(1)}% of frames`,
                      ...(eventData.person_tracks && eventData.person_tracks.length > 0 
                        ? [`Person tracks detected: ${eventData.person_tracks.length}`]
                        : []
                      ),
                      ...(eventData.object_detections && eventData.object_detections.length > 0
                        ? [`Object detections: ${eventData.object_detections.length}`]
                        : []
                      ),
                    ].map((item, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" strokeWidth={2} />
                    <div className="text-sm text-foreground/80">
                      <span className="font-semibold text-amber-900">Note:</span> This alert identifies behavioral patterns only. Human review required.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-4">Metadata</h2>
            <div className="space-y-2 text-sm">
              {[
                ['Video ID', eventData.videoId],
                ['Event ID', eventData.id],
                ['Start', formatTime(eventData.start)],
                ['End', formatTime(eventData.end)],
                ['Duration', eventData.duration.toFixed(1) + 's'],
                ['Track ID', eventData.trackId],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono text-xs">{value}</span>
                </div>
              ))}
            </div>
          </div>

            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-4">Quality Factors</h2>
            <div className="space-y-4">
              {[
                { label: 'Camera Shake', value: eventData.qualityFactors.cameraShake },
                { label: 'Blur Score', value: eventData.qualityFactors.blur },
                { label: 'Occlusion', value: eventData.qualityFactors.occlusion },
                { label: 'Lighting', value: eventData.qualityFactors.lighting },
              ].map((item) => {
                const percentage = Math.round((1 - item.value) * 100) // Invert so higher quality = higher percentage
                return (
                  <div key={item.label}>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="font-mono text-xs">{item.value.toFixed(2)}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          </div>

          <div className="card p-6">
            <h2 className="text-lg font-semibold mb-4">Investigator Feedback</h2>
            <div className="space-y-2">
              {feedbackOptions.map((option) => {
                const Icon = option.icon
                const isSelected = selectedFeedback === option.id
                return (
                  <button
                    key={option.id}
                    onClick={() => setSelectedFeedback(option.id)}
                    className={cn(
                      "w-full p-3 rounded-lg border transition-all text-left flex items-center gap-3",
                      isSelected
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'card card-hover'
                    )}
                  >
                    <Icon className="w-4 h-4" strokeWidth={2} />
                    <span className="text-sm font-medium">{option.label}</span>
                    {isSelected && <CheckCircle className="w-4 h-4 ml-auto" strokeWidth={2} />}
                  </button>
                )
              })}
            </div>
            <button 
              onClick={handleSubmitFeedback}
              className="w-full mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              disabled={!selectedFeedback}
            >
              Submit Feedback
            </button>
          </div>
        </div>

        <div className="space-y-6">
          {!!eventData.offences?.length && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">
                  Detected Offences
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {eventData.offences.length} finding{eventData.offences.length === 1 ? '' : 's'}
                  </span>
                </h2>
              </div>

              <div className="space-y-3">
                {eventData.offences.map((off, i) => {
                  const style = OFFENCE_STYLES[off.type] ?? {
                    label: off.type,
                    cls: 'bg-muted text-foreground border-border',
                  }
                  return (
                    <div key={i} className="flex gap-4 p-3 rounded-lg border border-border bg-background">
                      {off.snapshot ? (
                        <button
                          onClick={() => setLightbox(off.snapshot!)}
                          className="flex-shrink-0 w-32 aspect-video rounded overflow-hidden border border-border hover:ring-2 hover:ring-primary transition-all"
                          title="Click to enlarge the auto-captured evidence"
                        >
                          <img
                            src={`/api/snapshot?path=${encodeURIComponent(off.snapshot)}`}
                            alt={off.label}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ) : (
                        <div className="flex-shrink-0 w-32 aspect-video rounded border border-dashed border-border flex items-center justify-center text-[10px] text-muted-foreground text-center px-2">
                          No still captured
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={cn('px-2 py-0.5 rounded text-xs font-bold border', style.cls)}>
                            {style.label}
                          </span>
                          {off.trackId && (
                            <span className="px-2 py-0.5 bg-muted rounded text-xs font-mono">{off.trackId}</span>
                          )}
                          <span className="text-xs text-muted-foreground font-mono">
                            {(off.confidence * 100).toFixed(0)}% confidence
                          </span>
                        </div>
                        <div className="font-medium text-sm mb-1">{off.label}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {formatTime(off.startSec)}
                          {off.endSec > off.startSec && ` – ${formatTime(off.endSec)}`}
                          {off.durationSec ? ` · ${off.durationSec.toFixed(0)}s stationary` : ''}
                          {off.count ? ` · ${off.count} involved` : ''}
                        </div>
                        <button
                          onClick={() => jumpTo(off.startSec)}
                          className="mt-2 text-xs text-primary hover:underline font-medium"
                        >
                          Jump to this moment
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
          onClick={() => setLightbox(null)}
        >
          <div className="max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={`/api/snapshot?path=${encodeURIComponent(lightbox)}`}
              alt="Offence evidence"
              className="w-full rounded-lg border border-border"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-white/70 font-mono truncate">{lightbox.split('/').pop()}</span>
              <div className="flex gap-2">
                <a
                  href={`/api/snapshot?path=${encodeURIComponent(lightbox)}`}
                  download
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
                >
                  Download
                </a>
                <button
                  onClick={() => setLightbox(null)}
                  className="px-3 py-1.5 bg-card border border-border rounded-lg text-sm font-medium hover:bg-accent"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
