'use client'

import { motion } from 'framer-motion'
import { ArrowRight, Shield, Zap, Target, Eye, LogOut, Loader2, AlertCircle } from 'lucide-react'
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

const features = [
  { icon: Zap, label: 'Real-time Processing', desc: '<100ms latency' },
  { icon: Shield, label: 'Privacy Focused', desc: 'No facial recognition' },
  { icon: Target, label: 'High Accuracy', desc: '99.2% detection rate' },
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
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-20 relative overflow-hidden">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <div className="pill-badge inline-flex items-center gap-2 mb-10">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
            <span className="text-body-sm uppercase">AI-Powered Video Analytics</span>
          </div>

          <h1 className="mb-8">
            <span className="block text-[64px] md:text-[88px] leading-[1.05] tracking-[-0.02em] uppercase">
              Drishti
            </span>
            <span className="block text-heading-lg mt-3 uppercase text-muted-foreground">
              Intelligent Vision System
            </span>
          </h1>

          <p className="prose-voice text-[15px] text-muted-foreground max-w-xl mx-auto mb-12 leading-[1.4] normal-case">
            Advanced examination monitoring with behavioral pattern detection and real-time motion analysis
          </p>

          <div className="flex flex-col items-center gap-3 mb-16">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              {/* While the session is still being checked the primary action
                  stays disabled, rather than briefly showing "Sign in" to a
                  user who is in fact already signed in. */}
              {loading ? (
                <button disabled className="ghost-pill flex items-center gap-2 text-body-sm cursor-wait opacity-60">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Checking session
                </button>
              ) : canEnter ? (
                <button
                  onClick={onLaunch}
                  className="ghost-pill flex items-center gap-2 text-body-sm"
                >
                  Launch Dashboard
                  <ArrowRight className="w-5 h-5" />
                </button>
              ) : (
                <button
                  onClick={signInWithGoogle}
                  className="ghost-pill flex items-center gap-3 text-body-sm"
                >
                  <GoogleIcon className="w-5 h-5" />
                  Sign in with Google
                </button>
              )}
            </div>

            {user && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>
                  Signed in as <span className="font-medium text-foreground">{user.email}</span>
                </span>
                <button
                  onClick={signOut}
                  className="flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-accent transition-colors"
                >
                  <LogOut className="w-3 h-3" />
                  Sign out
                </button>
              </div>
            )}

            {!configured && !loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <AlertCircle className="w-3 h-3" />
                Supabase not configured - sign-in disabled, dashboard open. See .env.example
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-600">
                <AlertCircle className="w-3 h-3" />
                Sign-in failed: {error}
              </div>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mb-16"
        >
          <div className="card p-4">
            <div className="aspect-video bg-background rounded-card overflow-hidden flex items-center justify-center">
              <DotLottieReact
                src="https://lottie.host/8cf4ba71-e5fb-44f3-8134-178c4d389417/0CCsdcgNIP.json"
                loop
                autoplay
                className="w-3/4 h-3/4"
              />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {features.map((feature, i) => {
            const Icon = feature.icon
            return (
              <div key={i} className="card p-8 text-left">
                <div className="flex items-center justify-between mb-6">
                  <Icon className="w-5 h-5" strokeWidth={1.25} style={{ color: 'var(--accent)' }} />
                  <span className="pill-badge text-caption font-mono">{String(i + 1).padStart(2, '0')}</span>
                </div>
                <h3 className="text-heading-sm mb-2">{feature.label}</h3>
                <p className="prose-voice text-body-sm text-muted-foreground normal-case">{feature.desc}</p>
              </div>
            )
          })}
        </motion.div>
      </div>
    </div>
  )
}
