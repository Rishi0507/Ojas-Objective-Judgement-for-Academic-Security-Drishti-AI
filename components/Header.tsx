'use client'

import { Search, Bell, User } from 'lucide-react'

export default function Header() {
  return (
    <header className="h-16 bg-card border-b border-border px-6 flex items-center justify-between">
      <div className="flex-1 max-w-2xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" strokeWidth={2} />
          <input
            type="text"
            placeholder="Search events, videos, objects..."
            className="w-full pl-10 pr-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center gap-4 ml-6">
        <button className="relative p-2.5 hover:bg-accent rounded-lg transition-colors">
          <Bell className="w-5 h-5 text-muted-foreground" strokeWidth={2} />
          <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full" />
        </button>
        
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
