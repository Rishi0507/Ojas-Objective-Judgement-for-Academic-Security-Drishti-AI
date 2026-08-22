'use client'

import { motion } from 'framer-motion'
import { LayoutDashboard, Video, FileSearch, Settings, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SidebarProps {
  activeView: string
  onViewChange: (view: 'dashboard' | 'analysis' | 'events') => void
}

const navItems = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Overview' },
  { id: 'analysis', icon: Video, label: 'Analysis' },
  { id: 'events', icon: FileSearch, label: 'Events' },
]

export default function Sidebar({ activeView, onViewChange }: SidebarProps) {
  return (
    <aside className="w-20 bg-card border-r border-border flex flex-col items-center py-6 gap-6">
      <div className="mb-4">
        <button 
          onClick={() => onViewChange('dashboard')}
          className="w-12 h-12 bg-primary hover:bg-primary/90 transition-colors rounded-xl flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          title="Go to Dashboard"
        >
          <Eye className="w-6 h-6 text-primary-foreground" strokeWidth={2.5} />
        </button>
      </div>

      <nav className="flex-1 flex flex-col gap-2">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activeView === item.id
          
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id as any)}
              className={cn(
                "relative p-4 rounded-xl transition-colors",
                isActive ? 'text-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )}
              title={item.label}
            >
              <Icon className="w-6 h-6" strokeWidth={2} />
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r" />
              )}
            </button>
          )
        })}
      </nav>

      <button 
        className="p-4 text-muted-foreground hover:text-foreground hover:bg-accent rounded-xl transition-colors" 
        title="Settings"
      >
        <Settings className="w-6 h-6" strokeWidth={2} />
      </button>
    </aside>
  )
}
