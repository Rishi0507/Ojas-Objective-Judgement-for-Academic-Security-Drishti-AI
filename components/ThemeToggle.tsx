'use client'

import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'

/**
 * Light / dark switch. Light is the default, so "dark" is the only state
 * persisted — an absent key means light, which keeps the pre-paint script in
 * layout.tsx to a single class addition.
 */
export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  const toggle = () => {
    const next = !isDark
    setIsDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      if (next) localStorage.setItem('drishti-theme', 'dark')
      else localStorage.removeItem('drishti-theme')
    } catch {
      // Private browsing — the toggle still works for this session.
    }
  }

  return (
    <button
      onClick={toggle}
      className="ghost-pill flex items-center gap-2 text-body-sm"
      title={isDark ? 'Switch to light' : 'Switch to dark'}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? <Sun className="w-4 h-4" strokeWidth={1.5} /> : <Moon className="w-4 h-4" strokeWidth={1.5} />}
      {isDark ? 'Light' : 'Dark'}
    </button>
  )
}
