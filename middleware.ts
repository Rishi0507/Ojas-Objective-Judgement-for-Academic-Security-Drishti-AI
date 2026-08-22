import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Refreshes the auth session on every request.
 *
 * Supabase access tokens are short-lived. Without a refresh on the server, a
 * user who leaves a tab open comes back signed out even though their refresh
 * token is still valid. getUser() revalidates against the auth server rather
 * than trusting the cookie's contents.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return response // app still runs un-authenticated locally

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  await supabase.auth.getUser()
  return response
}

export const config = {
  // Skip static assets and the media routes - refreshing a session on every
  // video range request would add a round trip to each seek.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/stream|api/annotated|api/heatmap|api/snapshot|.*\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)',
  ],
}
