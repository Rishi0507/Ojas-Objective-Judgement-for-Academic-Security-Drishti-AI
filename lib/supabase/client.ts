'use client'

import { createBrowserClient } from '@supabase/ssr'

/**
 * Supabase client for browser/React code.
 *
 * The publishable key is compiled into the client bundle and is meant to be - 
 * it identifies the project, it does not authorise anything. Row Level Security
 * is what decides who may read or write which rows, so an RLS policy left off a
 * table is the actual exposure, not this key being visible.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!url || !key) {
    throw new Error(
      'Supabase env missing. Copy .env.example to .env.local and fill in ' +
        'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
    )
  }

  return createBrowserClient(url, key)
}
