'use client'

import { motion } from 'framer-motion'
import { ArrowRight, Shield, Zap, Target, Eye } from 'lucide-react'
import { DotLottieReact } from '@lottiefiles/dotlottie-react'

const features = [
  { icon: Zap, label: 'Real-time Processing', desc: '<100ms latency' },
  { icon: Shield, label: 'Privacy Focused', desc: 'No facial recognition' },
  { icon: Target, label: 'High Accuracy', desc: '99.2% detection rate' },
]

interface HeroProps {
  onLaunch?: () => void
}

export default function Hero({ onLaunch }: HeroProps) {
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

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <button
              onClick={onLaunch}
              className="ghost-pill flex items-center gap-2 text-body-sm"
            >
              Launch Dashboard
              <ArrowRight className="w-5 h-5" />
            </button>
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
