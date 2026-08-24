'use client'

import { useEffect, useState } from 'react'

/**
 * Site-wide status strip.
 *
 * This is the system's only monospace surface: Roboto Mono 11px uppercase with
 * bullet separators, on a tone one step beyond the canvas. The register is the
 * point -  machine data reads as a terminal log, distinct from the condensed
 * brand voice used everywhere else. A pipeline status line belongs here rather
 * than in a card, which would present it as brand communication.
 */
export default function NewsBar() {
  const [status, setStatus] = useState<string>('IDLE')

  useEffect(() => {
    const load = () => {
      fetch('/api/video')
        .then((r) => r.json())
        .then((d) => {
          if (!d || d.error || !d.events) return setStatus('NO VIDEO LOADED')
          const offences = d.events.reduce(
            (n: number, e: any) => n + ((e.offences || []).length), 0
          )
          setStatus(`${d.event_count} SEGMENTS • ${offences} OFFENCES`)
        })
        .catch(() => setStatus('NO VIDEO LOADED'))
    }
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])

  const date = new Date()
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase()

  return (
    <div
      className="w-full border-b border-border px-6 py-2 flex items-center justify-center"
      style={{ backgroundColor: 'var(--bar)' }}
    >
      <span className="font-mono text-caption text-muted-foreground">
        OJAS <span style={{ color: 'var(--accent)' }}>•</span> {date}{' '}
        <span style={{ color: 'var(--accent)' }}>•</span> {status}
      </span>
    </div>
  )
}
