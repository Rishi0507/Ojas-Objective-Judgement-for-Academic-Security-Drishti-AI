/**
 * Feature 10.1 -  definition-conditioned investigation.
 *
 * Different investigators care about different things: one is looking for
 * phone activity, another for seat-swapping. Rather than ship one fixed
 * ranking, the same event list is re-scored under whichever profile the
 * caller asks for.
 *
 * This is deliberately a pure re-weighting of signals the Go backend already
 * emits per event -  no detection is re-run, nothing is recomputed, and the
 * underlying events are never mutated. That is what makes it cheap enough to
 * apply per request.
 */

export type ProfileName =
  | 'phone_activity'
  | 'seat_exchange'
  | 'neighbor_interaction'
  | 'camera_disturbance'
  | 'all_unusual'

export const PROFILES: Record<ProfileName, Record<string, number>> = {
  phone_activity: { object_score: 0.6, motion_score: 0.2, camera_quality: 0.2 },
  seat_exchange: { motion_score: 0.5, person_proximity: 0.3, camera_quality: 0.2 },
  neighbor_interaction: { person_proximity: 0.6, motion_score: 0.3, camera_quality: 0.1 },
  camera_disturbance: { inverse_q_observability: 0.8, motion_score: 0.2 },
  all_unusual: { motion_score: 0.4, object_score: 0.3, camera_quality: 0.3 },
}

export const PROFILE_NAMES = Object.keys(PROFILES) as ProfileName[]

export function isProfileName(v: string | null): v is ProfileName {
  return !!v && Object.prototype.hasOwnProperty.call(PROFILES, v)
}

/**
 * Maps an API event onto the signal names the profile weights refer to.
 *
 * `camera_quality` is observability, i.e. higher is better -  a clean, readable
 * clip scores higher. `inverse_q_observability` is its complement, so the
 * camera_disturbance profile surfaces exactly the clips the others penalise.
 * Every signal is clamped to 0-1 so one malformed field cannot dominate a
 * weighted sum.
 */
export function extractSignals(event: any): Record<string, number> {
  const clamp = (n: unknown) => {
    const v = Number(n)
    if (!Number.isFinite(v)) return 0
    return v < 0 ? 0 : v > 1 ? 1 : v
  }

  const observability = clamp(event?.observability)

  return {
    motion_score: clamp(event?.motionScore),
    object_score: clamp(event?.objectScore),
    person_proximity: clamp(event?.personProximity),
    camera_quality: observability,
    inverse_q_observability: 1 - observability,
  }
}

/** Weighted sum of the profile's signals. Weights sum to 1, so score is 0-1. */
export function rescoreEvent(event: any, profile: ProfileName): number {
  const weights = PROFILES[profile]
  const signals = extractSignals(event)
  let score = 0
  for (const [key, weight] of Object.entries(weights)) {
    score += weight * (signals[key] ?? 0)
  }
  return score
}

/**
 * Returns a re-ranked copy of the event list. Each event gains `profileScore`
 * and `profileSignals` (the inputs behind the score, so the ranking can be
 * explained rather than just asserted). Ties keep their original relative
 * order, so equal-scoring events stay chronological instead of shuffling
 * between requests.
 */
export function rescoreEvents(events: any[], profile: ProfileName): any[] {
  return events
    .map((event, index) => ({
      ...event,
      profileScore: Number(rescoreEvent(event, profile).toFixed(4)),
      profileSignals: extractSignals(event),
      _originalIndex: index,
    }))
    .sort((a, b) =>
      b.profileScore === a.profileScore
        ? a._originalIndex - b._originalIndex
        : b.profileScore - a.profileScore
    )
    .map(({ _originalIndex, ...event }) => event)
}
