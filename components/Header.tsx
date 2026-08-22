'use client'

import { useState, useEffect } from 'react'
import { Search, Bell, User } from 'lucide-react'
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
    <header className="h-16 bg-card border-b border-border px-6 flex items-center justify-between">
      <div className="flex-1 max-w-2xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" strokeWidth={2} />
          <input
            type="text"
            placeholder="Search offences, segments, videos..."
            className="w-full pl-10 pr-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center gap-4 ml-6">
        <div className="relative">
          <button 
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2.5 hover:bg-accent rounded-lg transition-colors"
          >
            <Bell className="w-5 h-5 text-muted-foreground" strokeWidth={2} />
            {unreviewedEvents.length > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full" />
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
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 mt-2 w-80 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden"
                >
                  <div className="p-4 border-b border-border bg-muted/30">
                    <h3 className="font-semibold text-foreground">Notifications</h3>
                  </div>
                  {unreviewedEvents.length > 0 ? (
                    <div className="max-h-[300px] overflow-y-auto">
                      {unreviewedEvents.map((ev, i) => (
                        <div 
                          key={ev.id || i} 
                          className="p-4 border-b border-border hover:bg-accent/50 transition-colors cursor-pointer"
                          onClick={() => {
                            if (ev.id && onNotificationClick) {
                              onNotificationClick(ev.id)
                              setShowNotifications(false)
                            }
                          }}
                        >
                          <div className="flex items-start justify-between mb-1">
                            <span className="font-medium text-sm text-red-600">{ev.primary_label || 'Offence Detected'}</span>
                            <span className="text-xs text-muted-foreground">
                              {Math.floor(ev.start / 60)}:{(Math.floor(ev.start) % 60).toString().padStart(2, '0')}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">{ev.summary || 'Unreviewed activity requires your attention.'}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center flex flex-col items-center">
                      <Bell className="w-8 h-8 text-muted-foreground/30 mb-3" />
                      <p className="text-sm font-medium text-foreground">All caught up!</p>
                      <p className="text-xs text-muted-foreground mt-1">Check back later for new alerts.</p>
                    </div>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
        
        <div className="h-8 w-px bg-border" />
        
        <button className="flex items-center gap-3 px-3 py-2 hover:bg-accent rounded-lg transition-colors">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <User className="w-4 h-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-medium">Investigator</span>
        </button>
      </div>
    </header>
  )
}
