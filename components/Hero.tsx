'use client'

import { motion } from 'framer-motion'
import { ArrowUpRight, Zap, Shield, Target } from 'lucide-react'
import { DotLottieReact } from '@lottiefiles/dotlottie-react'

const useCases = [
  { icon: Zap, tag: 'optical flow', title: 'REAL-TIME MOTION SCORING', desc: 'Sub-100ms inference latency across high-resolution CCTV streams.' },
  { icon: Shield, tag: 'privacy', title: 'ZERO FACIAL BIOMETRICS', desc: 'No biometric data stored. Pure behavioral trajectory tracking.' },
  { icon: Target, tag: 'auditability', title: 'HEURISTIC POSTURE LOGGING', desc: '99.2% high-confidence anomaly capture rate on examinee posture.' },
]

interface HeroProps {
  onLaunch?: () => void
}

export default function Hero({ onLaunch }: HeroProps) {
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

            {/* Buttons & Email Burst Unit with Voltage Yellow Highlight */}
            <div className="pt-2 flex flex-wrap items-center gap-4">
              <button
                onClick={onLaunch}
                className="btn-primary"
              >
                <span>Schedule Demo</span>
                <ArrowUpRight className="w-4 h-4 text-paper-white" />
              </button>

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
