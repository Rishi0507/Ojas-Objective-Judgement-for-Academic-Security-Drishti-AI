import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Supabase client for route handlers and server components.
 *
 * Reads the session from cookies, so it acts as the signed-in user and stays
 * subject to RLS — which is what you want for anything user-facing.
 */
export function createClient() {
  const cookieStore = cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // Server Components cannot set cookies. Harmless when middleware is
          // refreshing the session, which is the case here.
        }
      },
    },
  })
}

/**
 * Service-role client. Bypasses RLS entirely, so it must never be constructed
 * in code that reaches the browser and must never be handed a user-supplied
 * table or path without validation.
 *
 * Used only for pipeline-owned writes: mirroring processed artefacts into
 * Storage, where the writer is the server itself rather than a signed-in user.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) return null // caller falls back to local-only storage

  const { createClient: createSupabaseClient } = require('@supabase/supabase-js')
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
