'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight, Shield, Zap, Target, LogOut, Loader2, AlertCircle } from 'lucide-react'
import { useAuth } from '@/lib/useAuth'
import FluidFlowGrid from '@/components/ui/fluid-flow-grid'

/** Google's mark, inlined so the button works offline and needs no CDN. */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51z"/>
    </svg>
  )
}

/**
 * Claims made on the landing page.
 *
 * Every line here has to be one the system can actually be shown doing. The
 * previous copy advertised "sub-100ms inference latency" and a "99.2%
 * high-confidence capture rate" - neither was measured, and the second was a
 * fabricated accuracy figure for a system with no evaluation set. Publishing
 * invented numbers on a product whose entire purpose is producing evidence
 * against students is the fastest way to make every real finding suspect.
 */
const useCases = [
  {
    icon: Zap,
    tag: 'offline',
    title: 'RUNS FULLY ON-PREMISES',
    desc: 'Detection, pose estimation and verification all run locally. No footage leaves the machine it was uploaded to.',
  },
  {
    icon: Shield,
    tag: 'privacy',
    title: 'ZERO FACIAL BIOMETRICS',
    desc: 'No face recognition and no identity mapping. Subjects are anonymous track IDs that exist only within a single video.',
  },
  {
    icon: Target,
    tag: 'auditability',
    title: 'EVERY FINDING IS GROUNDED',
    desc: 'Each claim cites the frame and bounding box it came from, and anything that cannot is dropped rather than shown.',
  },
]


/**
 * Reveal for the three cards: left, then centre, then right.
 *
 * Defined as variants rather than per-card props so the stagger is owned by the
 * container - the children only describe their own two states, and reordering
 * or adding a card needs no timing changes.
 *
 * whileInView with once:true rather than animate, so the reveal happens when
 * the row is actually reached instead of firing off-screen during page load.
 */
const cardGrid = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
}

const cardItem = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    // Slightly overdamped: it settles rather than bouncing, which suits a
    // page about evidence more than a springy one would.
    transition: { type: 'spring', stiffness: 220, damping: 28, mass: 0.9 },
  },
}

interface HeroProps {
  onLaunch?: () => void
}

export default function Hero({ onLaunch }: HeroProps) {
  const { user, loading, configured, error, signInWithGoogle, signOut } = useAuth()

  // globals.css already disables its keyframes under prefers-reduced-motion;
  // framer-motion needs asking separately or the two would disagree.
  const reduceMotion = useReducedMotion()

  // With Supabase unconfigured the app stays usable rather than locking a
  // teammate out of their own project over a missing .env.local.
  const canEnter = !!user || !configured

  return (
    <div className="relative min-h-screen bg-warm-canvas text-carbon-black font-sans select-none pb-20 overflow-hidden">
      <FluidFlowGrid />
      <div className="relative z-10 max-w-[1200px] mx-auto px-8 pt-8 space-y-20">
        
        {/*
          Page header. The brand and the account control sit on one row across
          the full width rather than stacked inside the left column, so the
          signed-in identity reads as chrome instead of as part of the pitch.
        */}
        <header className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ojas-logo.png" alt="OJAS" className="w-14 h-14 object-contain" />
            <div>
              <div className="font-condensed text-2xl font-bold uppercase tracking-tight leading-none text-carbon-black">
                OJAS
              </div>
              <div className="text-xs text-slate mt-1">
                Objective Judgement for Academic Sincerity
              </div>
            </div>
          </div>

          {user && (
            <div className="inline-flex items-center gap-2.5 pl-3 pr-1.5 py-1.5 rounded-full border border-ash bg-paper-white/60 text-sm text-slate flex-shrink-0">
              <span className="truncate max-w-[220px]">
                <span className="font-medium text-carbon-black">{user.email}</span>
              </span>
              <button
                onClick={signOut}
                className="flex items-center gap-1 px-2 py-1 rounded-full text-xs text-slate hover:bg-mist-gray hover:text-carbon-black transition-colors flex-shrink-0"
              >
                <LogOut className="w-3 h-3" />
                Sign out
              </button>
            </div>
          )}
        </header>

        {/* Hero Section Split: Oversized Condensed Headline + Live Media Frame */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center !mt-8 lg:!mt-10">
          
          {/* Left Column: Massive 80px-130px Condensed Uppercase Headline */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            // Staggered rather than one block fade: the eye lands on the tag,
            // then the headline, then the copy - the order it should read in.
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], staggerChildren: 0.08 }}
            className="lg:col-span-7 text-left space-y-6"
          >

            {/* Massive 80px-130px Uppercase Condensed Headline at 0.9 Line-Height */}
            <h1 className="font-condensed text-5xl md:text-7xl lg:text-[88px] font-bold text-carbon-black uppercase leading-[0.92] tracking-[-0.03em]">
              THE FOOTAGE NOBODY HAS TIME TO WATCH
            </h1>

            <p className="text-body font-normal text-slate max-w-lg leading-relaxed">
              Upload exam hall CCTV and get back reviewable findings: prohibited objects, head turns, gestures and loitering, each pinned to the second and the frame it happened in. Nothing is auto-flagged as cheating - an invigilator decides.
            </p>

            {/* Action Buttons & Auth */}
            <div className="pt-2 space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                {loading ? (
                  <button disabled className="btn-ghost flex items-center gap-2 cursor-wait opacity-60">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Checking session
                  </button>
                ) : canEnter ? (
                  <button
                    onClick={onLaunch}
                    className="btn-primary group transition-transform duration-150 active:scale-[0.98]"
                  >
                    <span>Launch Dashboard</span>
                    <ArrowUpRight className="w-4 h-4 text-paper-white transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </button>
                ) : (
                  <button
                    onClick={signInWithGoogle}
                    className="btn-primary flex items-center gap-3 transition-transform duration-150 active:scale-[0.98]"
                  >
                    <GoogleIcon className="w-5 h-5" />
                    <span>Sign in with Google</span>
                  </button>
                )}

              </div>

              {!configured && !loading && (
                <div className="flex items-center gap-2 text-xs text-smoke font-mono">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Supabase not configured - demo mode active.
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 text-xs text-red-600 font-mono">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Sign-in failed: {error}
                </div>
              )}
            </div>
          </motion.div>

          {/* Right Column: Flat White Card (32px Radius, Zero Shadow, Zero Border) */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            // Nudged above the grid's centre line: the headline column is
            // taller, so true centring parks the card noticeably below the
            // headline's optical top edge.
            className="lg:col-span-5 lg:-mt-24"
          >
            <div className="card bg-paper-white rounded-[32px] p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-mist-gray pb-3">
                <span className="font-condensed text-xl font-bold uppercase tracking-tight">What A Finding Looks Like</span>
                <span className="tag-mint">illustration</span>
              </div>

              {/*
                Inline SVG rather than the CDN-hosted animation that was here.
                This is an offline exam-hall system: a landing page that only
                renders correctly with internet access contradicts the product,
                and the Google mark above is inlined for exactly this reason.
                Labelled "illustration" because it is a diagram of the output
                format, not a screenshot of a real detection.
              */}
              <div className="aspect-video bg-warm-canvas rounded-[24px] p-4 relative overflow-hidden">
                <svg viewBox="0 0 320 180" className="w-full h-full" role="img"
                     aria-label="Diagram: two people detected in a frame, one flagged, with a timeline of motion below.">
                  <rect x="0" y="0" width="320" height="140" rx="8" fill="var(--mist-gray, #E8E6E1)" />

                  {/* Unflagged subject */}
                  <rect x="38" y="46" width="58" height="78" rx="3"
                        fill="none" stroke="var(--slate, #6B6862)" strokeWidth="2" />
                  <circle cx="67" cy="64" r="11" fill="var(--slate, #6B6862)" opacity="0.35" />
                  <text x="38" y="40" fontSize="9" fontFamily="monospace" fill="var(--slate, #6B6862)">Track-02</text>

                  {/* Flagged subject */}
                  <rect x="176" y="38" width="62" height="86" rx="3"
                        fill="none" stroke="#D93025" strokeWidth="2.5" />
                  <circle cx="207" cy="58" r="12" fill="#D93025" opacity="0.28" />
                  <rect x="222" y="74" width="15" height="21" rx="2" fill="#D93025" opacity="0.55" />
                  <text x="176" y="32" fontSize="9" fontFamily="monospace" fill="#D93025">Track-01 · phone</text>

                  {/* Motion timeline with the flagged window marked */}
                  <rect x="0" y="152" width="320" height="14" rx="4" fill="var(--mist-gray, #E8E6E1)" />
                  <rect x="168" y="152" width="46" height="14" rx="4" fill="#D93025" opacity="0.75" />
                  <text x="0" y="178" fontSize="8" fontFamily="monospace" fill="var(--slate, #6B6862)">00:00</text>
                  <text x="292" y="178" fontSize="8" fontFamily="monospace" fill="var(--slate, #6B6862)">END</text>
                </svg>
              </div>
            </div>
          </motion.div>

        </div>

        {/* Inverted Black Section Block (32px Radius) */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="card-inverted bg-carbon-black rounded-[32px] p-10 space-y-6 text-left"
        >
          <div className="flex items-center justify-between">
            <span className="tag-mint">evidence, not verdicts</span>
          </div>

          <h2 className="font-condensed text-4xl md:text-6xl font-bold text-paper-white uppercase leading-[0.9] tracking-tight">
            THE SYSTEM FINDS MOMENTS WORTH LOOKING AT &mdash; A PERSON DECIDES WHAT THEY MEAN
          </h2>

          <p className="text-body text-smoke max-w-2xl font-normal leading-relaxed">
            Detection here is heuristic: a wrist crossing into a neighbour&apos;s space is evidence of reaching, not proof of a hand-off. Every finding carries the frame it came from and the uncertainty around it, and every review decision is recorded in an append-only custody log.
          </p>
        </motion.div>

        {/* 3 Standard White Cards Grid (32px Radius, Zero Shadow) */}
        <motion.div
          className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left"
          variants={cardGrid}
          initial={reduceMotion ? false : 'hidden'}
          whileInView="visible"
          viewport={{ once: true, amount: 0.25 }}
        >
          {useCases.map((uc, i) => {
            const Icon = uc.icon
            return (
              <motion.div
                key={i}
                variants={cardItem}
                whileHover={reduceMotion ? undefined : { y: -4 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="card bg-paper-white rounded-[32px] p-8 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-[12px] bg-mist-gray flex items-center justify-center text-carbon-black">
                    <Icon className="w-5 h-5" strokeWidth={1.5} />
                  </div>
                  <span className="tag-mint">{uc.tag}</span>
                </div>

                <h3 className="font-condensed text-3xl font-bold text-carbon-black uppercase leading-[0.9]">
                  {uc.title}
                </h3>

                <p className="text-body-sm text-slate leading-relaxed">
                  {uc.desc}
                </p>

                <div className="pt-2">
                  <button
                    onClick={onLaunch}
                    className="text-body-sm font-medium text-carbon-black hover:underline flex items-center gap-1"
                  >
                    <span>More details</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            )
          })}
        </motion.div>

      </div>
    </div>
  )
}
