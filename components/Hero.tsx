'use client'

import { motion } from 'framer-motion'
import { ArrowUpRight, ArrowRight, Shield, Zap, Target, LogOut, Loader2, AlertCircle } from 'lucide-react'
import { DotLottieReact } from '@lottiefiles/dotlottie-react'
import { useAuth } from '@/lib/useAuth'

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

const useCases = [
  { icon: Zap, tag: 'optical flow', title: 'REAL-TIME MOTION SCORING', desc: 'Sub-100ms inference latency across high-resolution CCTV streams.' },
  { icon: Shield, tag: 'privacy', title: 'ZERO FACIAL BIOMETRICS', desc: 'No biometric data stored. Pure behavioral trajectory tracking.' },
  { icon: Target, tag: 'auditability', title: 'HEURISTIC POSTURE LOGGING', desc: '99.2% high-confidence anomaly capture rate on examinee posture.' },
]

interface HeroProps {
  onLaunch?: () => void
}

export default function Hero({ onLaunch }: HeroProps) {
  const { user, loading, configured, error, signInWithGoogle, signOut } = useAuth()

  // With Supabase unconfigured the app stays usable rather than locking a
  // teammate out of their own project over a missing .env.local.
  const canEnter = !!user || !configured

  return (
    <div className="min-h-screen bg-warm-canvas text-carbon-black font-sans select-none pb-20">
      <div className="max-w-[1200px] mx-auto px-8 pt-8 space-y-20">
        
        {/* Hero Section Split: Oversized Condensed Headline + Live Media Frame */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-end pt-4">
          
          {/* Left Column: Massive 80px-130px Condensed Uppercase Headline */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="lg:col-span-7 text-left space-y-6"
          >
            {/* Mint Tag Pill (64px Radius) */}
            <div className="flex items-center gap-3">
              <span className="tag-mint">
                [tag: live inference stream]
              </span>
              <span className="font-mono text-xs text-smoke">
                SLIDE 1/3
              </span>
            </div>

            {/* Massive 80px-130px Uppercase Condensed Headline at 0.9 Line-Height */}
            <h1 className="font-condensed text-6xl md:text-8xl lg:text-[110px] font-bold text-carbon-black uppercase leading-[0.9] tracking-[-0.03em]">
              SURVEILLANCE INTELLIGENCE FOR EXAMS
            </h1>

            <p className="text-body font-normal text-slate max-w-lg leading-relaxed">
              Brutalist, material-product analytics. High-contrast vision intelligence operating on warm gray canvas without clinical noise.
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
                    className="btn-primary"
                  >
                    <span>Launch Dashboard</span>
                    <ArrowUpRight className="w-4 h-4 text-paper-white" />
                  </button>
                ) : (
                  <button
                    onClick={signInWithGoogle}
                    className="btn-primary flex items-center gap-3"
                  >
                    <GoogleIcon className="w-5 h-5" />
                    <span>Sign in with Google</span>
                  </button>
                )}

                <button
                  onClick={onLaunch}
                  className="btn-ghost"
                >
                  <span>View Architecture</span>
                </button>

                <div className="px-3 py-1 bg-voltage-yellow text-black font-mono text-xs font-bold rounded-sm">
                  institutional access live
                </div>
              </div>

              {user && (
                <div className="flex items-center gap-3 text-sm text-slate">
                  <span>
                    Signed in as <span className="font-medium text-carbon-black">{user.email}</span>
                  </span>
                  <button
                    onClick={signOut}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-ash text-xs hover:bg-mist-gray transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign out
                  </button>
                </div>
              )}

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
            className="lg:col-span-5"
          >
            <div className="card bg-paper-white rounded-[32px] p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-mist-gray pb-3">
                <span className="font-condensed text-xl font-bold uppercase tracking-tight">Live Feed Stream</span>
                <span className="tag-mint">active stream</span>
              </div>

              <div className="aspect-video bg-warm-canvas rounded-[24px] p-4 relative flex items-center justify-center overflow-hidden">
                <DotLottieReact
                  src="https://lottie.host/8cf4ba71-e5fb-44f3-8134-178c4d389417/0CCsdcgNIP.json"
                  loop
                  autoplay
                  className="w-4/5 h-4/5"
                />
              </div>
            </div>
          </motion.div>

        </div>

        {/* Inverted Black Section Block (32px Radius) */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="card-inverted bg-carbon-black rounded-[32px] p-10 space-y-6 text-left"
        >
          <div className="flex items-center justify-between">
            <span className="tag-mint">dramatic contrast zone</span>
            <span className="font-mono text-xs text-smoke">REF 000000</span>
          </div>

          <h2 className="font-condensed text-4xl md:text-6xl font-bold text-paper-white uppercase leading-[0.9] tracking-tight">
            ENGINEERED WITHOUT CLINICAL DECORATION. FLAT SURFACES, ZERO ELEVATION.
          </h2>

          <p className="text-body text-smoke max-w-2xl font-normal leading-relaxed">
            Every card surface sits flat against the warm gray canvas. Scale contrast carries visual hierarchy without drop shadows.
          </p>
        </motion.div>

        {/* 3 Standard White Cards Grid (32px Radius, Zero Shadow) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          {useCases.map((uc, i) => {
            const Icon = uc.icon
            return (
              <div key={i} className="card bg-paper-white rounded-[32px] p-8 space-y-4">
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
              </div>
            )
          })}
        </div>

      </div>
    </div>
  )
}
