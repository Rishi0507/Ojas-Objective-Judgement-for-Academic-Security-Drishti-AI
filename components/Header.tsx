'use client'

import { useState, useEffect } from 'react'
import { Bell, Eye, ArrowUpRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface HeaderProps {
  onNotificationClick?: (eventId: string) => void
}

export default function Header({ onNotificationClick }: HeaderProps) {
  const [showNotifications, setShowNotifications] = useState(false)
  const [unreviewedEvents, setUnreviewedEvents] = useState<any[]>([])

  useEffect(() => {
    const loadData = () => {
      fetch('/api/video')
        .then(res => res.json())
        .then(data => {
          if (data && !data.error && data.events) {
            const highPriority = data.events.filter((e: any) => e.priority === 'high')
            setUnreviewedEvents(highPriority)
          } else {
            setUnreviewedEvents([])
          }
        })
        .catch(() => setUnreviewedEvents([]))
    }
    loadData()
    const interval = setInterval(loadData, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <header className="h-32 px-8 bg-warm-canvas font-sans text-body select-none flex items-center justify-between">
      {/* Wordmark in Uppercase Condensed */}
      <div className="flex items-center gap-3">
        <span className="font-condensed text-3xl font-bold tracking-tight text-carbon-black uppercase leading-none">
          AI FOR BUSINESS
        </span>
        <span className="tag-mint">
          live v2.4
        </span>
      </div>

      {/* Centered Floating White Nav Pill (48px Radius) */}
      <nav className="nav-pill flex items-center gap-8 shadow-none border border-ash/30">
        {['Solutions', 'Technology', 'Case Studies', 'Pricing'].map((item) => (
          <button
            key={item}
            className="text-body font-medium text-slate hover:text-carbon-black transition-colors"
          >
            {item}
          </button>
        ))}
      </nav>

      {/* Right Controls: Notification Pill + Primary Black Button (8px Radius) */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <button 
            onClick={() => setShowNotifications(!showNotifications)}
            className="btn-ghost py-2.5 px-4 text-body font-medium flex items-center gap-2 border-slate"
          >
            <Bell className="w-4 h-4 text-carbon-black" strokeWidth={1.5} />
            <span>Alerts</span>
            {unreviewedEvents.length > 0 && (
              <span className="px-2 py-0.5 text-xs bg-voltage-yellow text-black font-mono font-bold rounded-full">
                {unreviewedEvents.length}
              </span>
            )}
          </button>

          <AnimatePresence>
            {showNotifications && (
              <>
                <div 
                  className="fixed inset-0 z-40"
                  onClick={() => setShowNotifications(false)}
                />
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.1 }}
                  className="absolute right-0 mt-2 w-80 bg-paper-white text-carbon-black rounded-[24px] z-50 overflow-hidden text-body-sm shadow-none border border-ash/50"
                >
                  <div className="p-4 bg-mist-gray flex items-center justify-between">
                    <span className="font-condensed text-xl font-bold uppercase tracking-tight">System Events</span>
                    <span className="font-mono text-xs text-smoke">{unreviewedEvents.length} Pending</span>
                  </div>
                  {unreviewedEvents.length > 0 ? (
                    <div className="max-h-[300px] overflow-y-auto">
                      {unreviewedEvents.map((ev, i) => (
                        <div 
                          key={ev.id || i} 
                          className="p-4 border-b border-mist-gray hover:bg-warm-canvas/60 transition-colors cursor-pointer"
                          onClick={() => {
                            if (ev.id && onNotificationClick) {
                              onNotificationClick(ev.id)
                              setShowNotifications(false)
                            }
                          }}
                        >
                          <div className="flex items-start justify-between mb-1">
                            <span className="font-bold text-carbon-black uppercase text-sm">{ev.primary_label || 'Offence Detected'}</span>
                            <span className="font-mono text-xs text-smoke">
                              {Math.floor(ev.start / 60)}:{(Math.floor(ev.start) % 60).toString().padStart(2, '0')}
                            </span>
                          </div>
                          <p className="text-slate text-xs line-clamp-2">{ev.summary || 'Unreviewed anomaly.'}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-6 text-center text-smoke">
                      <Eye className="w-5 h-5 mx-auto mb-2 text-ash" />
                      <p className="font-bold text-carbon-black text-xs uppercase">No active alerts</p>
                    </div>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Primary CTA Button (8px Radius, Solid Black Fill) */}
        <button className="btn-primary">
          <span>Schedule Demo</span>
          <ArrowUpRight className="w-4 h-4 text-paper-white" />
        </button>
      </div>
    </header>
  )
}
