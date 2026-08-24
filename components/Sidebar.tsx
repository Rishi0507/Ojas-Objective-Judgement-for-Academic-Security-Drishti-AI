'use client'

import { useState } from 'react'
import { LayoutDashboard, Video, FileSearch, ShieldCheck, Radio, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import SettingsModal from './SettingsModal'

interface SidebarProps {
  activeView: string
  onViewChange: (view: 'dashboard' | 'analysis' | 'events' | 'ledger' | 'fleet') => void
}

const navItems = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Overview' },
  { id: 'analysis', icon: Video, label: 'Analysis' },
  // "Findings", not "Segments": this view lists individual offences, which is
  // what a reviewer works through. The motion segments they sit inside are a
  // pipeline concept and appear under Analysis.
  { id: 'events', icon: FileSearch, label: 'Findings' },
  { id: 'ledger', icon: ShieldCheck, label: 'Ledger' },
  // Camera readiness across centres - operations, not review, so it sits last.
  { id: 'fleet', icon: Radio, label: 'Cameras' },
]

export default function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  return (
    <aside className="w-20 bg-warm-canvas border-r border-ash flex flex-col items-center py-6 gap-6 font-sans text-caption select-none">
      {/* Brand Icon Mark */}
      <div className="mb-2">
        <button 
          onClick={() => onViewChange('dashboard')}
          className="w-10 h-10 bg-paper-white rounded-[16px] flex items-center justify-center overflow-hidden transition-transform hover:scale-105"
          title="OJAS -  Objective Judgement for Academic Sincerity"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ojas-logo.png" alt="OJAS" width={32} height={32} style={{ width: '32px', height: '32px', objectFit: 'contain' }} className="w-8 h-8 object-contain flex-shrink-0" />
        </button>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 flex flex-col gap-3 w-full px-2">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = activeView === item.id
          
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id as any)}
              className={cn(
                "relative w-full py-3.5 flex flex-col items-center justify-center gap-1.5 rounded-[20px] transition-all border",
                isActive 
                  ? 'bg-carbon-black text-paper-white border-carbon-black font-medium' 
                  : 'bg-transparent text-slate border-transparent hover:text-carbon-black hover:bg-paper-white'
              )}
              title={item.label}
            >
              <Icon className="w-4 h-4" strokeWidth={1.5} />
              <span className="text-[10px] tracking-tight uppercase font-mono">{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Settings Action */}
      <button 
        onClick={() => setIsSettingsOpen(true)}
        className="w-9 h-9 text-slate hover:text-carbon-black hover:bg-paper-white border border-transparent rounded-[16px] flex items-center justify-center transition-colors" 
        title="Settings"
      >
        <Settings className="w-4 h-4" strokeWidth={1.5} />
      </button>

      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
      />
    </aside>
  )
}
