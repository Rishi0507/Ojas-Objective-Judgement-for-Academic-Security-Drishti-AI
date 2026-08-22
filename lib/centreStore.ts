import fs from 'fs'
import path from 'path'
import type { CentreProfile } from './centreProfile'

/**
 * Persistence for centre profiles.
 *
 * Filesystem-authoritative, matching how the rest of the pipeline stores its
 * artefacts: profiles survive without Supabase configured, and a mirror is
 * written when it is. At real fleet scale the mirror becomes the primary and
 * this becomes the local cache, but inverting that now would make the feature
 * unusable on a laptop with no service key.
 *
 * One file per fleet rather than per centre: 800 profiles of a dozen regions
 * each is well under a megabyte, and a single file removes any question of
 * partial reads while the set is being rewritten.
 */

const ROOT = process.cwd()
const FLEET_DIR = path.join(ROOT, 'fleet')
const PROFILES_PATH = path.join(FLEET_DIR, 'centre_profiles.json')

/** Composite key: one camera at one centre is the unit that gets calibrated. */
export function cameraKey(centreId: string, cameraId: string): string {
  return `${centreId}::${cameraId}`
}

export function loadProfiles(): Record<string, CentreProfile> {
  try {
    return JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf-8'))
  } catch {
    return {} // absent or unreadable - an empty fleet, not an error
  }
}

export function saveProfiles(profiles: Record<string, CentreProfile>): void {
  fs.mkdirSync(FLEET_DIR, { recursive: true })
  // Write-then-rename: a crash mid-write would otherwise leave the whole
  // fleet's calibration truncated, and there is no second copy to fall back to.
  const tmp = `${PROFILES_PATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(profiles, null, 2))
  fs.renameSync(tmp, PROFILES_PATH)
}

export function getProfile(centreId: string, cameraId: string): CentreProfile | null {
  return loadProfiles()[cameraKey(centreId, cameraId)] ?? null
}

export function putProfile(profile: CentreProfile): void {
  const all = loadProfiles()
  all[cameraKey(profile.centre_id, profile.camera_id)] = profile
  saveProfiles(all)
}

/**
 * Mirrors a profile into Supabase when a service key is present.
 *
 * Best-effort and deliberately silent on absence: the local store is the
 * source of truth, so a missing key or a failed write degrades the fleet view
 * to this machine rather than failing the request that triggered it.
 */
export async function mirrorProfile(profile: CentreProfile): Promise<boolean> {
  try {
    const { createServiceClient } = await import('./supabase/server')
    const supabase = createServiceClient()
    if (!supabase) return false

    const { error } = await supabase.from('centre_profiles').upsert(
      {
        centre_id: profile.centre_id,
        camera_id: profile.camera_id,
        grid: profile.grid,
        frame_resolution: profile.frame_resolution,
        sessions: profile.sessions,
        regions: profile.regions,
        updated_at: profile.updated_at,
      },
      { onConflict: 'centre_id,camera_id' }
    )
    if (error) {
      console.error(`[fleet] mirror ${profile.centre_id}/${profile.camera_id}: ${error.message}`)
      return false
    }
    return true
  } catch {
    return false
  }
}
