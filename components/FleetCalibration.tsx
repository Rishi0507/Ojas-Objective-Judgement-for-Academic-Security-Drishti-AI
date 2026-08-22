'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Radio, AlertTriangle, CheckCircle2, HelpCircle, MoveDiagonal,
  RefreshCw, Search, ChevronDown, ChevronRight, Building2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Camera readiness across exam centres.
 *
 * Written for an operations person, not an engineer. The underlying measure is
 * a per-region statistical deviation, but nobody scheduling 800 exam halls
 * needs the word "sigma" - they need to know which rooms to walk into before
 * candidates sit down. Every label here is the plain-language version of a
 * verdict the API returns.
 *
 * Grouped by centre rather than listed flat, because that is the unit someone
 * acts on: you send a person to a building, not to a camera ID. A flat list of
 * 3,200 cameras is data, not a work queue.
 */

interface DriftReport {
  centre_id: string
  camera_id: string
  verdict: 'stable' | 'camera_moved' | 'scene_changed' | 'unusable' | 'no_baseline'
  regions_shifted: number
  regions_compared: number
  peak_shift: number
  reasoning: string
  worst_regions: { region: string; shift: number; was: number; now: number }[]
}

interface Camera {
  centre_id: string
  camera_id: string
  sessions: number
  regions: number
  grid: number[]
  frame_resolution: number[]
  updated_at: string
  last_drift: DriftReport | null
}

/**
 * Plain-language mapping. `action` is what someone should physically do -
 * a status with no action attached is just a colour.
 */
const STATUS = {
  stable: {
    label: 'Ready',
    blurb: 'Looks the same as last time',
    action: null,
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
    Icon: CheckCircle2,
    severity: 4,
  },
  no_baseline: {
    label: 'Still learning',
    blurb: 'First recording from this camera',
    action: 'Nothing to do - it will start checking from the next exam',
    cls: 'bg-slate-100 text-slate-600 border-slate-200',
    dot: 'bg-slate-400',
    Icon: HelpCircle,
    severity: 3,
  },
  scene_changed: {
    label: 'Room looks different',
    blurb: 'Part of the view changed',
    action: 'Check if desks or lighting were rearranged',
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
    Icon: AlertTriangle,
    severity: 2,
  },
  camera_moved: {
    label: 'Camera moved',
    blurb: 'The whole view shifted',
    action: 'Someone should check the camera is still pointing the right way',
    cls: 'bg-orange-50 text-orange-700 border-orange-200',
    dot: 'bg-orange-500',
    Icon: MoveDiagonal,
    severity: 1,
  },
  unusable: {
    label: 'Needs re-setup',
    blurb: 'Cannot be compared to before',
    action: 'Record a fresh reference clip for this camera',
    cls: 'bg-red-50 text-red-700 border-red-200',
    dot: 'bg-red-500',
    Icon: AlertTriangle,
    severity: 0,
  },
} as const

type StatusKey = keyof typeof STATUS
const statusOf = (c: Camera): StatusKey => (c.last_drift?.verdict ?? 'no_baseline') as StatusKey

/** How many centres to list before asking the user to narrow the search. */
const CENTRE_LIMIT = 30

export default function FleetCalibration() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [onlyProblems, setOnlyProblems] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const [centreId, setCentreId] = useState('CENTRE-001')
  const [cameraId, setCameraId] = useState('cam-01')
  const [pipelineDir, setPipelineDir] = useState('')

  const load = useCallback(() => {
    fetch('/api/centres')
      .then((r) => r.json())
      .then((d) => {
        setCameras(d.cameras ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    fetch('/api/video')
      .then((r) => r.json())
      .then((d) => d?.pipeline_dir && setPipelineDir(d.pipeline_dir))
      .catch(() => {})
  }, [load])

  /** Roll cameras up into the thing an operator acts on: a building. */
  const centres = useMemo(() => {
    const byCentre = new Map<string, Camera[]>()
    for (const c of cameras) {
      if (!byCentre.has(c.centre_id)) byCentre.set(c.centre_id, [])
      byCentre.get(c.centre_id)!.push(c)
    }
    return [...byCentre.entries()]
      .map(([id, cams]) => {
        const statuses = cams.map(statusOf)
        const worst = statuses.reduce<StatusKey>(
          (w, s) => (STATUS[s].severity < STATUS[w].severity ? s : w),
          'stable'
        )
        return {
          id,
          cameras: cams.sort((a, b) => a.camera_id.localeCompare(b.camera_id)),
          worst,
          problems: statuses.filter((s) => s !== 'stable' && s !== 'no_baseline').length,
        }
      })
      .sort(
        (a, b) => STATUS[a.worst].severity - STATUS[b.worst].severity || a.id.localeCompare(b.id)
      )
  }, [cameras])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const cam of cameras) c[statusOf(cam)] = (c[statusOf(cam)] ?? 0) + 1
    return c
  }, [cameras])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return centres.filter((c) => {
      if (q && !c.id.toLowerCase().includes(q)) return false
      if (onlyProblems && c.problems === 0) return false
      return true
    })
  }, [centres, search, onlyProblems])

  const register = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/centres', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ centre_id: centreId, camera_id: cameraId, pipeline_dir: pipelineDir }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not check this camera')
      const s = STATUS[(data.drift.verdict as StatusKey) ?? 'no_baseline']
      setMessage(`${centreId} / ${cameraId}: ${s.label} - ${s.blurb}.`)
      load()
    } catch (err: any) {
      setMessage(err?.message ?? 'Failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="p-8 text-muted-foreground">Loading camera health...</div>

  const total = cameras.length
  const ready = counts.stable ?? 0
  const needsAttention = total - ready - (counts.no_baseline ?? 0)

  return (
    <div className="p-8 space-y-6 max-w-[1200px] mx-auto">
      <div>
        <div className="flex items-center gap-2">
          <Radio className="w-6 h-6 text-muted-foreground" strokeWidth={2} />
          <h1 className="text-3xl font-bold tracking-tight">Camera Health</h1>
        </div>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          Every camera remembers what its room normally looks like. Before an exam, we compare
          today&apos;s view against that memory — so a camera that has been knocked or a light
          that has failed is caught now, not weeks later when someone disputes the footage.
        </p>
      </div>

      {total === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-medium mb-1">No cameras set up yet</p>
          <p className="text-sm text-muted-foreground">
            Use the form below to add the first one from a processed recording.
          </p>
        </div>
      ) : (
        <>
          {/* One headline number, then the breakdown. */}
          <div className="card p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Ready for the next exam</div>
                <div className="text-4xl font-bold font-mono">
                  {ready.toLocaleString()}
                  <span className="text-xl text-muted-foreground font-normal">
                    {' '}of {total.toLocaleString()} cameras
                  </span>
                </div>
              </div>
              {needsAttention > 0 && (
                <div className="text-right">
                  <div className="text-sm text-muted-foreground mb-1">Need someone to look</div>
                  <div className="text-3xl font-bold font-mono text-amber-600">
                    {needsAttention.toLocaleString()}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
              {(['stable', 'no_baseline', 'scene_changed', 'camera_moved', 'unusable'] as StatusKey[])
                .filter((k) => counts[k])
                .map((k) => (
                  <div
                    key={k}
                    className={cn('h-full', STATUS[k].dot)}
                    style={{ width: `${((counts[k] ?? 0) / total) * 100}%` }}
                    title={`${STATUS[k].label}: ${counts[k]}`}
                  />
                ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              {(['unusable', 'camera_moved', 'scene_changed', 'no_baseline', 'stable'] as StatusKey[])
                .filter((k) => counts[k])
                .map((k) => (
                  <div key={k} className="flex items-center gap-2 text-sm">
                    <span className={cn('w-2.5 h-2.5 rounded-full', STATUS[k].dot)} />
                    <span className="font-medium">{STATUS[k].label}</span>
                    <span className="font-mono text-muted-foreground">{counts[k]}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* Search + filter, then centres. */}
          <div className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-semibold">
                {onlyProblems ? 'Centres needing attention' : 'All centres'}
              </h2>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyProblems}
                    onChange={(e) => setOnlyProblems(e.target.checked)}
                    className="accent-current"
                  />
                  Only show problems
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find a centre"
                    className="pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm w-52"
                  />
                </div>
              </div>
            </div>

            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {onlyProblems
                  ? 'Every centre is ready. Nothing needs attention.'
                  : 'No centres match that search.'}
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  {visible.slice(0, CENTRE_LIMIT).map((centre) => {
                    const s = STATUS[centre.worst]
                    const open = expanded === centre.id
                    return (
                      <div key={centre.id} className="border border-border rounded-lg overflow-hidden">
                        <button
                          onClick={() => setExpanded(open ? null : centre.id)}
                          className="w-full px-4 py-3 flex items-center gap-3 hover:bg-accent/50 transition-colors text-left"
                        >
                          {open ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          )}
                          <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <span className="font-mono font-medium">{centre.id}</span>
                          <span className="text-sm text-muted-foreground">
                            {centre.cameras.length} camera{centre.cameras.length === 1 ? '' : 's'}
                          </span>
                          <span className="flex-1" />
                          {centre.problems > 0 && (
                            <span className="text-sm text-muted-foreground">
                              {centre.problems} need
                              {centre.problems === 1 ? 's' : ''} a look
                            </span>
                          )}
                          <span className={cn('px-2.5 py-1 rounded-md border text-xs font-medium', s.cls)}>
                            {s.label}
                          </span>
                        </button>

                        {open && (
                          <div className="border-t border-border bg-muted/20 divide-y divide-border/60">
                            {centre.cameras.map((cam) => {
                              const cs = STATUS[statusOf(cam)]
                              const Icon = cs.Icon
                              return (
                                <div key={cam.camera_id} className="px-4 py-3">
                                  <div className="flex flex-wrap items-center gap-2 mb-1">
                                    <Icon className="w-4 h-4 text-muted-foreground" strokeWidth={2} />
                                    <span className="font-mono text-sm font-medium">{cam.camera_id}</span>
                                    <span className={cn('px-2 py-0.5 rounded border text-xs font-medium', cs.cls)}>
                                      {cs.label}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {cam.sessions} recording{cam.sessions === 1 ? '' : 's'} remembered
                                    </span>
                                  </div>
                                  <p className="text-sm text-muted-foreground">{cs.blurb}.</p>
                                  {cs.action && (
                                    <p className="text-sm text-foreground/80 mt-1">
                                      <span className="font-medium">What to do:</span> {cs.action}
                                    </p>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                {visible.length > CENTRE_LIMIT && (
                  <p className="text-sm text-muted-foreground mt-3">
                    Showing {CENTRE_LIMIT} of {visible.length} centres. Search above to narrow it down.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Setup, kept last: it is a one-off task, not the daily view. */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-1">Add a recording</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Teaches a camera what its room looks like, or checks a new recording against what it
          already knows.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          {[
            ['Centre', centreId, setCentreId, 'CENTRE-001'],
            ['Camera', cameraId, setCameraId, 'cam-01'],
            ['Recording', pipelineDir, setPipelineDir, 'processed folder name'],
          ].map(([label, value, setter, placeholder]: any) => (
            <div key={label}>
              <label className="block text-xs text-muted-foreground mb-1">{label}</label>
              <input
                value={value}
                onChange={(e) => setter(e.target.value)}
                placeholder={placeholder}
                className="px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono w-52"
              />
            </div>
          ))}
          <button
            onClick={register}
            disabled={busy || !centreId || !cameraId || !pipelineDir}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw className={cn('w-4 h-4', busy && 'animate-spin')} strokeWidth={2} />
            {busy ? 'Checking...' : 'Check this camera'}
          </button>
        </div>
        {message && <div className="mt-3 text-sm text-foreground/80">{message}</div>}
      </div>
    </div>
  )
}
