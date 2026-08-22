'use client'

import { useState } from 'react'
import { Search, Bell, User } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export default function Header() {
  const [showNotifications, setShowNotifications] = useState(false)

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
            <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full" />
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
                  <div className="p-8 text-center flex flex-col items-center">
                    <Bell className="w-8 h-8 text-muted-foreground/30 mb-3" />
                    <p className="text-sm font-medium text-foreground">All caught up!</p>
                    <p className="text-xs text-muted-foreground mt-1">Check back later for new alerts.</p>
                  </div>
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
