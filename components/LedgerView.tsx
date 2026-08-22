'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, RefreshCw, AlertTriangle, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Custody ledger view.
 *
 * The ledger's whole purpose is to let someone check a claim rather than
 * accept it, so this screen is built to show the check being performed and its
 * result — including when the result is bad. Two things follow from that:
 *
 *   * The limitations are rendered as prominently as the guarantees. An
 *     unanchored chain can be rebuilt from genesis by whoever runs the
 *     database, and a screen that displayed a green tick without saying so
 *     would be overstating exactly the thing it exists to establish.
 *
 *   * A failed verification is not an error state to hide behind a toast. It
 *     is the most important thing this page can ever display, so a broken
 *     chain renders the specific entries and reasons, not "something went
 *     wrong".
 */

interface LedgerEntry {
  seq: number
  kind: string
  subject: string
  jobId: string | null
  timestamp: string
  payloadHash: string
  entryHash: string
  signed: boolean
  payload: Record<string, unknown>
}

interface VerifyResponse {
  ok: boolean
  summary: string
  entriesChecked: number
  signedEntries: number
  headHash: string | null
  merkleRoot: string | null
  problems: { seq: number; problem: string; detail: string }[]
  guarantees: {
    integrity: string
    attribution: string
    anchored: boolean
    limitation: string | null
    notProvenance: string
  }
  entries: LedgerEntry[]
}

const KIND_LABELS: Record<string, string> = {
  video_uploaded: 'Video uploaded',
  artifact_derived: 'Artifact derived',
  verdict_recorded: 'Verdict recorded',
  anchor_published: 'Anchor published',
}

const KIND_STYLES: Record<string, string> = {
  video_uploaded: 'bg-blue-50 text-blue-700 border-blue-200',
  artifact_derived: 'bg-muted text-muted-foreground border-border',
  verdict_recorded: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  anchor_published: 'bg-purple-50 text-purple-700 border-purple-200',
}

/** First 16 hex chars. Enough to compare by eye, short enough to read. */
function shortHash(h: string | null): string {
  if (!h) return '—'
  return `${h.slice(0, 16)}…`
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch {
    return ts
  }
}

export default function LedgerView() {
  const [data, setData] = useState<VerifyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    fetch('/api/ledger/verify')
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) {
          setError(d.error)
          setData(null)
        } else {
          setData(d)
          setError(null)
        }
        setLoading(false)
      })
      .catch((e) => {
        setError(String(e))
        setLoading(false)
      })
  }

  useEffect(load, [])

  if (loading && !data) {
    return <div className="p-8 text-muted-foreground">Verifying custody chain…</div>
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="card p-6 border-red-200 bg-red-50">
          <div className="font-semibold text-red-700 mb-1">Could not verify the chain</div>
          <div className="text-sm text-red-600 font-mono">{error}</div>
        </div>
      </div>
    )
  }

  if (!data) return null

  const empty = data.entriesChecked === 0

  return (
    <div className="p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">
            Custody <span className="font-serif italic">Ledger</span>
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            An append-only, hash-linked record of every act performed on this evidence: each
            upload, each derived artifact, and each reviewer decision. Every entry carries the
            hash of the one before it, so altering or removing any of them breaks every hash
            that follows.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 border border-border rounded-lg font-medium hover:bg-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} strokeWidth={2} />
          Re-verify
        </button>
      </div>

      {/* Verification result. The single most important thing on the page. */}
      <div
        className={cn(
          'card p-6 border-2',
          empty
            ? 'border-border'
            : data.ok
            ? 'border-emerald-300 bg-emerald-50/40'
            : 'border-red-300 bg-red-50/50'
        )}
      >
        <div className="flex items-start gap-4">
          {data.ok ? (
            <ShieldCheck
              className={cn('w-8 h-8 flex-shrink-0', empty ? 'text-muted-foreground' : 'text-emerald-600')}
              strokeWidth={1.5}
            />
          ) : (
            <ShieldAlert className="w-8 h-8 text-red-600 flex-shrink-0" strokeWidth={1.5} />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold mb-1">
              {empty
                ? 'No entries yet'
                : data.ok
                ? 'Chain verifies from genesis'
                : 'Chain verification FAILED'}
            </div>
            <p className="text-sm text-muted-foreground">
              {empty
                ? 'Upload a video to start the chain. Entries are written for the upload, each derived artifact, and every review decision.'
                : data.summary}
            </p>

            {!data.ok && (
              <div className="mt-4 space-y-2">
                {data.problems.map((p, i) => (
                  <div key={i} className="p-3 bg-background border border-red-200 rounded-lg">
                    <div className="font-mono text-xs font-bold text-red-700">
                      entry {p.seq} · {p.problem}
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">{p.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {!empty && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Entries', value: String(data.entriesChecked) },
            { label: 'Signed', value: `${data.signedEntries} / ${data.entriesChecked}` },
            { label: 'Head hash', value: shortHash(data.headHash), mono: true },
            { label: 'Merkle root', value: shortHash(data.merkleRoot), mono: true },
          ].map((s) => (
            <div key={s.label} className="card p-5">
              <div className={cn('text-lg font-bold mb-1 break-all', s.mono && 'font-mono text-sm')}>
                {s.value}
              </div>
              <div className="text-sm text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* What this does and does not establish. Deliberately not buried. */}
      <div className="card p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Link2 className="w-4 h-4 text-primary" strokeWidth={2} />
          What this proves
        </h2>

        <div className="space-y-3 text-sm">
          <div>
            <div className="font-medium mb-0.5">Integrity</div>
            <p className="text-muted-foreground">{data.guarantees.integrity}</p>
          </div>
          <div>
            <div className="font-medium mb-0.5">Attribution</div>
            <p className="text-muted-foreground">{data.guarantees.attribution}</p>
          </div>
        </div>

        <div className="pt-2 border-t border-border space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-amber-700">
            <AlertTriangle className="w-4 h-4" strokeWidth={2} />
            What it does not prove
          </h3>
          <p className="text-sm text-muted-foreground">{data.guarantees.notProvenance}</p>
          {data.guarantees.limitation && (
            <p className="text-sm text-muted-foreground">{data.guarantees.limitation}</p>
          )}
        </div>
      </div>

      {!empty && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold mb-4">
            {data.entries.length} {data.entries.length === 1 ? 'Entry' : 'Entries'}
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="pb-2 pr-4 font-medium">#</th>
                  <th className="pb-2 pr-4 font-medium">Event</th>
                  <th className="pb-2 pr-4 font-medium">Subject</th>
                  <th className="pb-2 pr-4 font-medium">Recorded</th>
                  <th className="pb-2 pr-4 font-medium">Content hash</th>
                  <th className="pb-2 font-medium">Signed</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.seq} className="border-b border-border/50 last:border-0 align-top">
                    <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground">{e.seq}</td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-md text-xs font-medium border whitespace-nowrap',
                          KIND_STYLES[e.kind] ?? KIND_STYLES.artifact_derived
                        )}
                      >
                        {KIND_LABELS[e.kind] ?? e.kind}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs break-all max-w-[26rem]">
                      {e.subject}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                      {formatTime(e.timestamp)}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground" title={e.payloadHash}>
                      {shortHash(e.payloadHash)}
                    </td>
                    <td className="py-2.5 text-xs">
                      {e.signed ? (
                        <span className="text-emerald-600">yes</span>
                      ) : (
                        <span className="text-muted-foreground">no</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
