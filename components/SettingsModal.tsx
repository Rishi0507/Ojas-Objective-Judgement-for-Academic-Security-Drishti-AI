'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, AlertTriangle, Loader2 } from 'lucide-react'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [isConfirming, setIsConfirming] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClearData = async () => {
    setIsClearing(true)
    setError(null)
    
    try {
      const res = await fetch('/api/data/clear', { method: 'DELETE' })
      if (!res.ok) {
        throw new Error('Failed to clear data')
      }
      // Force a hard reload to reset all dashboard states and hooks
      window.location.reload()
    } catch (err: any) {
      setError(err.message || 'An error occurred')
      setIsClearing(false)
      setIsConfirming(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-6 bg-card border border-border rounded-xl shadow-lg"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Settings</h2>
              <button
                onClick={onClose}
                className="p-2 hover:bg-accent rounded-lg transition-colors"
                disabled={isClearing}
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            <div className="space-y-6">
              <div className="p-4 rounded-lg border border-red-200 bg-red-50/50">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-red-900 mb-1">Danger Zone</h3>
                    <p className="text-sm text-red-700/80 mb-4">
                      Clearing data will instantly delete all processed videos, events, and snapshots. This action cannot be undone.
                    </p>
                    
                    {!isConfirming ? (
                      <button
                        onClick={() => setIsConfirming(true)}
                        className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 font-medium rounded-lg transition-colors text-sm"
                      >
                        Clear All Data
                      </button>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm font-medium text-red-900">Are you absolutely sure?</p>
                        <div className="flex gap-2">
                          <button
                            onClick={handleClearData}
                            disabled={isClearing}
                            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors text-sm disabled:opacity-50"
                          >
                            {isClearing && <Loader2 className="w-4 h-4 animate-spin" />}
                            {isClearing ? 'Clearing...' : 'Yes, Delete Everything'}
                          </button>
                          <button
                            onClick={() => setIsConfirming(false)}
                            disabled={isClearing}
                            className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 font-medium rounded-lg transition-colors text-sm disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                        {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
