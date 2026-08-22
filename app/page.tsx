'use client'

import { useState } from 'react'
import Hero from '@/components/Hero'
import Sidebar from '@/components/Sidebar'
import Header from '@/components/Header'
import Dashboard from '@/components/Dashboard'
import VideoAnalysis from '@/components/VideoAnalysis'
import EventsList from '@/components/EventsList'
import EventDetail from '@/components/EventDetail'
import { X } from 'lucide-react'

export default function Home() {
  const [showHero, setShowHero] = useState(true)
  const [activeView, setActiveView] = useState<'dashboard' | 'analysis' | 'events' | 'event'>('dashboard')
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null)
  const [eventOrigin, setEventOrigin] = useState<'analysis' | 'events'>('events')

  if (showHero) {
    return (
      <div className="relative min-h-screen">
        <Hero onLaunch={() => setShowHero(false)} />
        <button
          onClick={() => setShowHero(false)}
          className="fixed bottom-8 right-8 z-50 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold shadow-lg hover:bg-primary/90 transition-colors flex items-center gap-2"
        >
          Skip to Dashboard
          <X className="w-5 h-5" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        activeView={activeView === 'event' ? eventOrigin : activeView}
        onViewChange={setActiveView}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />

        <main className="flex-1 overflow-y-auto">
          {activeView === 'dashboard' && (
            <Dashboard
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

          {activeView === 'event' && selectedEvent && (
            <EventDetail
              eventId={selectedEvent}
              onBack={() => setActiveView(eventOrigin)}
            />
          )}
        </main>
      </div>
    </div>
  )
}
