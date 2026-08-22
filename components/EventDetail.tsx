'use client'

import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Play, Pause, CheckCircle, AlertTriangle, Eye, EyeOff, CheckSquare, XCircle, AlertCircle, Copy, Flag, Zap, Camera, Gauge, Link2, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

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

/**
 * Colour for an uncertainty band. "unavailable" is deliberately styled as
 * neutral rather than green: Module 6 never measured that factor, and showing
 * it as if it scored well would overstate what the pipeline knows.
 */
const BAND_STYLES: Record<string, string> = {
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  unavailable: 'bg-muted text-muted-foreground border-border',
}

function bandStyle(band: string): string {
  return BAND_STYLES[band] ?? BAND_STYLES.unavailable
}

function humanizeKey(key: string): string {
  return key
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

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
  uncertaintyReasons?: UncertaintyReasons
  explanations?: ExplanationData[]
}

/** Feature 10.3 — Module 6's quality signals as readable bands. */
interface UncertaintyReasons {
  camera_shake: string
  blur: string
  lighting_change: string
  occlusion: string
}

/** Feature 10.6 — one claim bound to the evidence it rests on. */
interface ExplanationData {
  event_id: string
  claim: string
  timestamp: number
  track_id?: string
  roi: number[]
  object_bbox?: number[]
  supporting_frame_urls: string[]
  uncertainty_reason: string
  // How well the claim is anchored (10.6). The backend drops anything that
  // reaches neither, so "full" | "spatial" | "temporal" are the only values
  // that arrive here.
  grounding?: 'full' | 'spatial' | 'temporal'
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
  // Feature 10.4 — the grid cell this offence sits in, and how far that cell
  // departed from its own learned baseline at this moment.
  region?: string
  regionZ?: number
}

const OFFENCE_STYLES: Record<string, { label: string; cls: string }> = {
  prohibited_object: { label: 'Prohibited Object', cls: 'bg-red-50 text-red-700 border-red-200' },
  object_exchange: { label: 'Object Exchange', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  loitering: { label: 'Loitering', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  crowd_disturbance: { label: 'Crowd Disturbance', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  head_turn: { label: 'Head Turn', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  hand_gesture: { label: 'Hand Gesture', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
}

const feedbackOptions = [
  { id: 'relevant', label: 'Relevant Segment', icon: CheckCircle },
  { id: 'normal', label: 'Normal Behavior', icon: CheckSquare },
  { id: 'wrong_roi', label: 'Wrong ROI', icon: AlertCircle },
  { id: 'wrong_object', label: 'Wrong Object', icon: XCircle },
  { id: 'duplicate', label: 'Duplicate', icon: Copy },
]

function formatTime(seconds: number): string {
  const totalSecs = Math.floor(seconds)
  const hrs = Math.floor(totalSecs / 3600)
  const mins = Math.floor((totalSecs % 3600) / 60)
  const secs = totalSecs % 60
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
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
  const [selectedOffence, setSelectedOffence] = useState<OffenceData | null>(null)
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
    // activeSrc MUST stay in this list: the <video> carries key={activeSrc},
    // so switching between the plain and annotated clip unmounts the element
    // and mounts a fresh one. Without re-running, this listener stays bound to
    // the destroyed node and the time readout, scrubber and frame index all
    // freeze the moment the user toggles bounding boxes.
  }, [eventData, videoFps, usingEventClip, clipOffset, activeSrc])

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
    // Use floored seconds so the dot jumps once per second, not smoothly
    const displayTime = Math.floor(currentTime)
    return ((displayTime - eventData.start) / eventData.duration) * 100
  }

  // Integer-second time for display — updates once per second
  const displayTime = Math.floor(currentTime)

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
                  <span className="text-foreground font-semibold tabular-nums">{formatTime(displayTime)}</span>
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
                  const percentage = Math.round((1 - item.value) * 100)
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

          {eventData.uncertaintyReasons && (
            <div className="card p-6">
              <div className="flex items-center gap-2 mb-1">
                <Gauge className="w-4 h-4 text-muted-foreground" strokeWidth={2} />
                <h2 className="text-lg font-semibold">Uncertainty</h2>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                How much to trust this reading, per camera factor.
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(eventData.uncertaintyReasons).map(([key, band]) => (
                  <span
                    key={key}
                    className={cn(
                      'px-2.5 py-1 rounded-md border text-xs font-medium',
                      bandStyle(band)
                    )}
                    title={
                      band === 'unavailable'
                        ? `${humanizeKey(key)} is not measured by the current pipeline`
                        : `${humanizeKey(key)}: ${band}`
                    }
                  >
                    {humanizeKey(key)}: {band}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="card p-6">
            <h2 className="text-lg font-semibold mb-4">Investigator Feedback</h2>
            <div className="space-y-2">
              {feedbackOptions.map((option) => {
                const isSelected = selectedFeedback === option.id
                const Icon = option.icon
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

        {/* Right Column (lg:col-span-1): Detected Offences ONLY */}
        <div className="lg:col-span-1 space-y-6">
          {!!eventData.offences?.length ? (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">
                  Detected Offences
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {eventData.offences.length} finding{eventData.offences.length === 1 ? '' : 's'}
                  </span>
                </h2>
              </div>

              {/* Vertical List for Right Column: Thumbnail + Offence Name + Time */}
              <div className="space-y-4 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
                {eventData.offences.map((off, i) => {
                  return (
                    <div
                      key={i}
                      onClick={() => setSelectedOffence(off)}
                      className="p-4 card rounded-2xl flex items-center gap-4 cursor-pointer transition-all hover:scale-[1.01] hover:border-carbon-black group border border-ash/40"
                    >
                      {off.snapshot ? (
                        <img
                          src={`/api/snapshot?path=${encodeURIComponent(off.snapshot)}`}
                          alt={off.label}
                          className="w-36 h-24 object-cover rounded-xl flex-shrink-0 border border-border group-hover:opacity-95 transition-opacity shadow-sm"
                        />
                      ) : (
                        <div className="w-36 h-24 rounded-xl bg-muted/60 border border-dashed border-border flex items-center justify-center flex-shrink-0">
                          <AlertTriangle className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="font-bold text-base text-carbon-black line-clamp-3 leading-snug group-hover:text-primary transition-colors">
                          {off.label}
                        </div>
                        <div className="text-sm font-mono text-slate flex items-center gap-1.5 flex-wrap">
                          <Clock className="w-4 h-4 text-slate" />
                          <span>{formatTime(off.startSec)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="card p-6 text-center text-muted-foreground">
              <div className="text-sm font-medium mb-1">No Offences Detected</div>
              <p className="text-xs">No behavioral anomalies flagged for this segment.</p>
            </div>
          )}
        </div>
      </div>

        {/* Grounded Explanation Modal for Selected Offence */}
        {selectedOffence && (() => {
          const off = selectedOffence
          const style = OFFENCE_STYLES[off.type] ?? { label: off.type, cls: 'bg-muted text-foreground border-border' }
          const grounded = getGroundedExplanation(off.type, off.label, off.trackId, off.confidence)

          return (
            <div
              className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6 overflow-y-auto"
              onClick={() => setSelectedOffence(null)}
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
                      {off.trackId && (
                        <span className="px-2 py-0.5 bg-muted rounded-md text-xs font-mono">{off.trackId}</span>
                      )}
                      <span className="text-xs text-muted-foreground font-mono">
                        {(off.confidence * 100).toFixed(0)}% confidence
                      </span>
                    </div>
                    <h3 className="text-xl font-bold leading-snug text-foreground">{off.label}</h3>
                  </div>
                  <button
                    onClick={() => setSelectedOffence(null)}
                    className="p-2 hover:bg-accent rounded-full transition-colors flex-shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Close"
                  >
                    <XCircle className="w-5 h-5" strokeWidth={2} />
                  </button>
                </div>

                {/* Evidence Snapshot Image Preview */}
                {off.snapshot ? (
                  <div className="bg-black/90 relative flex items-center justify-center">
                    <img
                      src={`/api/snapshot?path=${encodeURIComponent(off.snapshot)}`}
                      alt={off.label}
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
                  {(() => {
                    const matchedEx = eventData.explanations?.find(
                      (ex) => Math.abs(ex.timestamp - off.startSec) < 4 || ex.claim.toLowerCase().includes(off.type.replace('_', ' '))
                    )

                    return (
                      <div className="space-y-3 p-4 bg-muted/30 border border-border rounded-xl">
                        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-primary">
                          <span className="flex items-center gap-2">
                            <Link2 className="w-4 h-4 text-primary" />
                            <span>Grounded AI Observation & Evidence Claims</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            {/* What this claim is actually anchored to. Shown
                                rather than assumed: "spatial" means there is a
                                box but no frame to display, "temporal" means the
                                reverse — a reviewer should weigh those
                                differently from a fully evidenced finding. */}
                            {matchedEx?.grounding && matchedEx.grounding !== 'full' && (
                              <span
                                title={
                                  matchedEx.grounding === 'spatial'
                                    ? 'Located in the frame, but no still is available to display'
                                    : 'A still is available, but nothing locates the subject within it'
                                }
                                className="px-2.5 py-0.5 rounded border text-[11px] font-mono bg-amber-500/10 text-amber-600 border-amber-500/30 font-normal"
                              >
                                partial grounding: {matchedEx.grounding}
                              </span>
                            )}
                            {matchedEx?.uncertainty_reason && (
                              <span className="px-2.5 py-0.5 rounded border text-[11px] font-mono bg-muted text-muted-foreground font-normal">
                                {matchedEx.uncertainty_reason}
                              </span>
                            )}
                          </span>
                        </div>

                        <div className="space-y-2 text-xs text-foreground leading-relaxed">
                          <div>
                            <strong className="text-foreground">Visual Observation:</strong>{' '}
                            <span className="text-muted-foreground">{matchedEx?.claim || grounded.observation}</span>
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

                        {/* Technical Evidence Coordinates (t=..., track=..., roi=[...], bbox=[...]) */}
                        <div className="pt-2 border-t border-border/50 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-mono text-muted-foreground">
                          <span>t={formatTime(matchedEx?.timestamp ?? off.startSec)}</span>
                          {(matchedEx?.track_id || off.trackId) && <span>track={matchedEx?.track_id || off.trackId}</span>}
                          <span>roi=[{(matchedEx?.roi ?? eventData.roi).join(', ')}]</span>
                          {(off.bbox || matchedEx?.object_bbox) && (
                            <span>bbox=[{(off.bbox || matchedEx?.object_bbox)?.join(', ')}]</span>
                          )}
                        </div>

                        {/* Supporting Evidence Frame Buttons (Evidence 1, Evidence 2, etc.) */}
                        {matchedEx?.supporting_frame_urls && matchedEx.supporting_frame_urls.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 pt-2">
                            {matchedEx.supporting_frame_urls.map((url, j) => (
                              <a
                                key={j}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-accent transition-colors text-xs font-mono font-medium text-foreground shadow-xs"
                              >
                                <Camera className="w-3.5 h-3.5" strokeWidth={2} />
                                Evidence {j + 1}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {/* Key Technical Details Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 border border-border rounded-xl bg-background text-xs font-mono">
                    <div>
                      <div className="text-muted-foreground mb-1">Occurred at</div>
                      <div className="font-bold text-sm text-foreground">{formatTime(off.startSec)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">Track Subject</div>
                      <div className="font-bold text-sm text-foreground">{off.trackId || 'Examinee'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">Confidence</div>
                      <div className="font-bold text-sm text-foreground">{(off.confidence * 100).toFixed(0)}%</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">Time Range</div>
                      <div className="font-bold text-sm text-foreground">{formatTime(off.startSec)}–{formatTime(off.endSec)}</div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      onClick={() => {
                        jumpTo(off.startSec)
                        setSelectedOffence(null)
                      }}
                      className="btn-primary py-2 px-4 text-xs font-medium flex items-center gap-2"
                    >
                      <span>Jump to video timestamp ({formatTime(off.startSec)})</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

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
