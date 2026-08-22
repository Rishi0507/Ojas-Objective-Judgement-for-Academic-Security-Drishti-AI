'use client'

import { useState, useEffect, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

export interface AuthState {
  user: User | null
  /** Distinguishes "checking" from "definitely signed out" — without it the UI
   *  flashes the signed-out state for everyone on every load. */
  loading: boolean
  configured: boolean
  error: string | null
}

/**
 * Session state plus Google sign-in/out.
 *
 * `configured` lets the app degrade honestly: with no Supabase env set the
 * dashboard still opens rather than the project becoming unusable for a
 * teammate who has not set up their .env.local yet.
 */
export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    configured: true,
    error: null,
  })

  useEffect(() => {
    let supabase
    try {
      supabase = createClient()
    } catch {
      setState({ user: null, loading: false, configured: false, error: null })
      return
    }

    // Surface an OAuth failure that came back on the URL, then clean it off so
    // a refresh does not keep showing a stale error.
    const params = new URLSearchParams(window.location.search)
    const authError = params.get('auth_error')
    if (authError) {
      window.history.replaceState({}, '', window.location.pathname)
    }

    supabase.auth.getUser().then(({ data }: { data: any }) => {
      setState({
        user: data.user ?? null,
        loading: false,
        configured: true,
        error: authError,
      })
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      setState((s) => ({ ...s, user: session?.user ?? null, loading: false }))
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  const signInWithGoogle = useCallback(async () => {
    const supabase = createClient()
    // The origin the user is actually on wins. NEXT_PUBLIC_SITE_URL is only a
    // fallback for non-browser contexts: pinning it would send a teammate
    // running on :3000 back to whatever port this machine happens to use.
    const siteUrl = window.location.origin || process.env.NEXT_PUBLIC_SITE_URL
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${siteUrl}/auth/callback`,
        // Ask Google for a refresh token so the session survives a restart.
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (error) setState((s) => ({ ...s, error: error.message }))
  }, [])

  const signOut = useCallback(async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    setState((s) => ({ ...s, user: null }))
  }, [])

  return { ...state, signInWithGoogle, signOut }
}
