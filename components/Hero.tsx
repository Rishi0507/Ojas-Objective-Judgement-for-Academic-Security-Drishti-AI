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
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary flex items-center justify-center px-6 py-20">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-full mb-8">
            <div className="w-2 h-2 bg-primary rounded-full" />
            <span className="text-sm font-medium text-muted-foreground">AI-Powered Video Analytics</span>
          </div>

          <h1 className="text-6xl md:text-7xl font-black tracking-tight mb-6">
            <span className="font-serif italic text-primary">Drishti</span>
            <span className="block text-5xl md:text-6xl mt-2 text-foreground">Intelligent Vision System</span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Advanced examination monitoring with behavioral pattern detection and real-time motion analysis
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <button
              onClick={onLaunch}
              className="px-8 py-4 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors flex items-center gap-2"
            >
              Launch Dashboard
              <ArrowRight className="w-5 h-5" />
            </button>
            <button className="px-8 py-4 bg-card border border-border rounded-lg font-semibold hover:bg-accent transition-colors">
              View Demo
            </button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mb-16"
        >
          <div className="card p-4 shadow-lg">
            <div className="aspect-video bg-gradient-to-br from-muted to-accent rounded-lg overflow-hidden flex items-center justify-center">
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
              <div key={i} className="card p-6 text-center">
                <div className="w-12 h-12 bg-primary/5 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <Icon className="w-6 h-6 text-primary" strokeWidth={2} />
                </div>
                <h3 className="font-semibold mb-2">{feature.label}</h3>
                <p className="text-sm text-muted-foreground">{feature.desc}</p>
              </div>
            )
          })}
        </motion.div>
      </div>
    </div>
  )
}
