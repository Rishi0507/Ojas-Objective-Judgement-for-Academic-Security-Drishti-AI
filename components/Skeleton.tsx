'use client'

import { cn } from '@/lib/utils'

/**
 * Loading placeholders that mirror the shape of the content they replace.
 *
 * A centred "Loading..." tells the user nothing except that the app is not
 * broken, and the layout jumps when real content lands. Blocks in roughly the
 * final proportions keep the page stable and make the wait read as the page
 * arriving rather than the page being absent.
 *
 * The shimmer is deliberately slow (2s) and low-contrast: a fast, high-contrast
 * pulse reads as urgency, which is the wrong signal for a two-second fetch.
 */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted/60', className)}
      style={{ animationDuration: '2s' }}
      aria-hidden="true"
    />
  )
}

/** Header block: title + subtitle, used at the top of every view. */
function SkeletonHeader() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  )
}

/** Row of stat cards. */
function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-6 space-y-4">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  )
}

/**
 * Full-page placeholders, one per view shape.
 *
 * `label` is announced to screen readers rather than drawn, so assistive tech
 * still gets a clear "loading" message while sighted users get the layout.
 */
export function PageSkeleton({
  variant = 'dashboard',
  label = 'Loading',
}: {
  variant?: 'dashboard' | 'analysis' | 'list' | 'detail'
  label?: string
}) {
  return (
    <div className="p-8 space-y-8 max-w-[1600px] mx-auto" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <SkeletonHeader />

      {variant === 'dashboard' && (
        <>
          <SkeletonStats />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 card p-6 space-y-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-[280px] w-full" />
            </div>
            <div className="card p-6 space-y-5">
              <Skeleton className="h-5 w-32" />
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
              ))}
            </div>
          </div>
          <div className="card p-6 space-y-4">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        </>
      )}

      {variant === 'analysis' && (
        <>
          <SkeletonStats />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 card p-6 space-y-4">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="aspect-video w-full rounded-lg" />
            </div>
            <div className="card p-6 space-y-5">
              <Skeleton className="h-5 w-32" />
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-full" />
              ))}
            </div>
          </div>
        </>
      )}

      {variant === 'list' && (
        <div className="card p-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-4 border border-border rounded-lg flex items-center gap-4">
              <Skeleton className="h-16 w-28 rounded-md flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {variant === 'detail' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="aspect-video w-full rounded-lg" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card p-6 space-y-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
