'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Compact custody-chain status, for the views a reviewer actually spends time in.
 *
 * The full picture lives in the Ledger tab; this is the one-line version that
 * says whether the evidence on screen is still what was recorded. It states the
 * limitation inline rather than only in the detail view - a green tick with the
 * caveats a click away would overstate exactly the thing the chain exists to
 * make checkable.
 */

interface Verify {
  ok: boolean
  entriesChecked: number
  signedEntries: number
  headHash: string | null
  guarantees?: { anchored?: boolean }
  split?: { localEntries: number; databaseEntries: number } | null
}

export default function IntegrityStrip({ onOpenLedger }: { onOpenLedger?: () => void }) {
  const [d, setD] = useState<Verify | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/ledger/verify')
      .then((r) => r.json())
      .then((v) => setD(v?.error ? null : v))
      .catch(() => setD(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Checking custody chain…
      </div>
    )
  }
  if (!d) return null

  const empty = d.entriesChecked === 0
  const good = d.ok && !empty

  return (
    <button
      onClick={onOpenLedger}
      disabled={!onOpenLedger}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-2.5 rounded-lg border text-left transition-colors',
        onOpenLedger && 'hover:bg-accent/50 cursor-pointer',
        good
          ? 'border-emerald-300/60 bg-emerald-50/40'
          : empty
          ? 'border-border bg-muted/30'
          : 'border-red-300 bg-red-50/50'
      )}
    >
      {good ? (
        <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" strokeWidth={2} />
      ) : (
        <ShieldAlert
          className={cn('w-4 h-4 flex-shrink-0', empty ? 'text-muted-foreground' : 'text-red-600')}
          strokeWidth={2}
        />
      )}

      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium">
          {empty
            ? 'Custody chain empty'
            : d.ok
            ? 'Evidence unaltered since recording'
            : 'Custody chain FAILED verification'}
        </span>
        {!empty && (
          <span className="text-xs text-muted-foreground ml-2 font-mono tabular-nums">
            {d.entriesChecked} entries · {d.signedEntries} signed
            {d.headHash ? ` · ${d.headHash.slice(0, 10)}…` : ''}
          </span>
        )}
      </div>

      {!empty && d.guarantees?.anchored === false && (
        <span
          title="The chain is verifiable here, but not published anywhere outside this server, so it cannot yet be checked by someone who does not trust this machine."
          className="hidden sm:inline text-[11px] font-mono text-muted-foreground border border-border rounded px-2 py-0.5 flex-shrink-0"
        >
          not externally anchored
        </span>
      )}
    </button>
  )
}
