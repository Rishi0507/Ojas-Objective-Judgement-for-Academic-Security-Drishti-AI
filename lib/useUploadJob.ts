'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { JobStatus } from './pipelineJobs'

export type { JobStatus }

const STORAGE_KEY = 'drishti_active_job_id'

/**
 * Tracks the current video-processing job. Lives at the page.tsx level (not
 * inside Dashboard) so switching tabs — Analysis, Events, wherever — never
 * unmounts it and never interrupts polling. The underlying pipeline process
 * runs server-side regardless; this only makes sure the UI doesn't lose
 * track of it. Also persists the job id to localStorage so a full page
 * reload can resume tracking instead of losing it entirely.
 */
export function useUploadJob(onJobDone: () => void) {
  const [job, setJob] = useState<JobStatus | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const onJobDoneRef = useRef(onJobDone)
  onJobDoneRef.current = onJobDone

  // Resume a job that was still running before a page reload.
  useEffect(() => {
    const storedId = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (!storedId) return
    fetch(`/api/upload/status?job=${storedId}`)
      .then((res) => res.json())
      .then((status: JobStatus & { error?: string }) => {
        if (status.error) {
          localStorage.removeItem(STORAGE_KEY)
          return
        }
        setJob(status)
        if (status.state === 'done' || status.state === 'error') {
          localStorage.removeItem(STORAGE_KEY)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!job || !job.jobId || job.state === 'done' || job.state === 'error') return
    const interval = setInterval(() => {
      fetch(`/api/upload/status?job=${job.jobId}`)
        .then((res) => res.json())
        .then((status: JobStatus) => {
          setJob(status)
          if (status.state === 'done') {
            localStorage.removeItem(STORAGE_KEY)
            onJobDoneRef.current()
          } else if (status.state === 'error') {
            localStorage.removeItem(STORAGE_KEY)
          }
        })
        .catch((err) => console.error('Failed to poll job status:', err))
    }, 2000)
    return () => clearInterval(interval)
  }, [job])

  const uploadFile = useCallback(async (file: File) => {
    setUploadError(null)
    const now = new Date().toISOString()
    setJob({ jobId: '', state: 'queued', message: 'Uploading video...', filename: file.name, startedAt: now, updatedAt: now, percent: 0 })

    const formData = new FormData()
    formData.append('video', file)

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Upload failed')
      }
      localStorage.setItem(STORAGE_KEY, data.jobId)
      const now = new Date().toISOString()
      setJob({ jobId: data.jobId, state: 'queued', message: 'Queued for processing', filename: file.name, startedAt: now, updatedAt: now, percent: 0 })
    } catch (err: any) {
      setUploadError(err?.message ?? 'Upload failed')
      setJob(null)
    }
  }, [])

  const dismissJob = useCallback(() => setJob(null), [])
  const dismissError = useCallback(() => setUploadError(null), [])

  return { job, uploadError, uploadFile, dismissJob, dismissError }
}
