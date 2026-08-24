'use client'

import { useState } from 'react'
import Hero from '@/components/Hero'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import Dashboard from '@/components/Dashboard'
import VideoAnalysis from '@/components/VideoAnalysis'
import EventsList from '@/components/EventsList'
import EventDetail from '@/components/EventDetail'
import LedgerView from '@/components/LedgerView'
import FleetCalibration from '@/components/FleetCalibration'
import { X, Loader2, XCircle } from 'lucide-react'
import { useUploadJob } from '@/lib/useUploadJob'

export default function Home() {
  const [showHero, setShowHero] = useState(true)
  const [activeView, setActiveView] = useState<
    'dashboard' | 'analysis' | 'events' | 'event' | 'ledger' | 'fleet'
  >('dashboard')
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null)
  const [eventOrigin, setEventOrigin] = useState<'analysis' | 'events'>('events')

  // Lives here (not inside Dashboard) so switching tabs never interrupts
  // polling or loses track of an in-progress upload -  the pipeline itself
  // runs server-side regardless, this just keeps the UI in sync with it
  // no matter which view is active.
  const { job, uploadError, uploadFile, dismissJob, dismissError, cancelJob } = useUploadJob(() => {})

  if (showHero) {
    return (
      <div className="relative min-h-screen">
        <Hero onLaunch={() => setShowHero(false)} />
      </div>
    )
  }

  return (
    <div className="h-screen overflow-hidden bg-background flex flex-col">
      <div className="flex flex-1 overflow-hidden">
      <Sidebar
        activeView={activeView === 'event' ? eventOrigin : activeView}
        onViewChange={setActiveView}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header 
          onNotificationClick={(eventId) => {
            setSelectedEvent(eventId)
            setEventOrigin('events')
            setActiveView('event')
          }}
        />

        {job && (job.state === 'queued' || job.state === 'processing') && (
          <div className="relative px-6 py-3 bg-primary/5 border-b border-primary/20 flex items-center gap-3 flex-shrink-0 banner-enter">
            {/* Progress also runs along the banner's bottom edge, so it stays
                visible while scrolled and reads as one continuous motion
                instead of a bar that jumps between poll responses. */}
            <div
              className="absolute bottom-0 left-0 h-[2px] bg-primary/70 transition-[width] duration-1000 ease-linear"
              style={{ width: `${Math.min(100, Math.max(0, job.percent ?? 0))}%` }}
            />
            <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" strokeWidth={2} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium truncate">Processing &ldquo;{job.filename}&rdquo;</span>
                {job.percent !== undefined && (
                  <span className="font-mono text-xs text-muted-foreground flex-shrink-0 tabular-nums">
                    {Math.round(job.percent)}%
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground truncate">{job.message}</div>
              {job.percent !== undefined && (
                <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1.5">
                  {/* 1s linear, matching the 1.5s status poll: an ease that
                      finishes early leaves the bar visibly parked between
                      updates, which reads as a stall. */}
                  <div
                    className="h-full bg-primary rounded-full transition-[width] duration-1000 ease-linear"
                    style={{ width: `${Math.min(100, Math.max(0, job.percent))}%` }}
                  />
                </div>
              )}
            </div>
            <button 
              onClick={cancelJob} 
              className="flex items-center gap-1 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-md transition-colors text-xs font-medium flex-shrink-0"
              title="Stop processing"
            >
              <XCircle className="w-3.5 h-3.5" />
              Stop
            </button>
          </div>
        )}

        {job && job.state === 'error' && (
          <div className="px-6 py-3 bg-red-50 border-b border-red-200 flex items-start gap-3 flex-shrink-0">
            <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" strokeWidth={2} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-red-700">Failed to process "{job.filename}"</div>
              <div className="text-xs text-red-600 mt-0.5 break-words">{job.error || job.message}</div>
            </div>
            <button onClick={dismissJob} className="text-red-600 hover:text-red-800 text-xs font-medium flex-shrink-0">
              Dismiss
            </button>
          </div>
        )}

        {uploadError && (
          <div className="px-6 py-3 bg-red-50 border-b border-red-200 flex items-start gap-3 flex-shrink-0 banner-enter">
            <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" strokeWidth={2} />
            <div className="min-w-0 flex-1 text-sm text-red-600">{uploadError}</div>
            <button onClick={dismissError} className="text-red-600 hover:text-red-800 text-xs font-medium flex-shrink-0">
              Dismiss
            </button>
          </div>
        )}

        {/* keyed on the active view so React remounts the wrapper on every
            change, which restarts the enter animation. Without the key the
            class is already applied and the transition never replays. */}
        <main key={activeView} className="flex-1 overflow-y-auto view-enter">
          {activeView === 'dashboard' && (
            <Dashboard
              job={job}
              onUploadFile={uploadFile}
              onVideoSelect={(videoId) => {
                setSelectedVideo(videoId)
                setActiveView('analysis')
              }}
            />
          )}

          {activeView === 'analysis' && selectedVideo && (
            <VideoAnalysis
              videoId={selectedVideo}
              onEventSelect={(eventId) => {
                setSelectedEvent(eventId)
                setEventOrigin('analysis')
                setActiveView('event')
              }}
              onBack={() => setActiveView('dashboard')}
            />
          )}

          {activeView === 'events' && (
            <EventsList
              onEventSelect={(eventId) => {
                setSelectedEvent(eventId)
                setEventOrigin('events')
                setActiveView('event')
              }}
            />
          )}

          {activeView === 'ledger' && <LedgerView />}

          {activeView === 'fleet' && <FleetCalibration />}

          {activeView === 'event' && selectedEvent && (
            <EventDetail
              eventId={selectedEvent}
              onBack={() => setActiveView(eventOrigin)}
            />
          )}
        </main>
      </div>
      </div>
    </div>
  )
}
