/**
 * Per-centre calibration for fleet-scale deployment.
 *
 * Module 10 learns what motion is normal per region of ONE video. That is the
 * right unit for analysing a recording and the wrong unit for running 800
 * exam centres: each hall is re-learned from scratch every session, so nothing
 * carries forward, and there is no way to notice that a camera has been
 * knocked or a light has failed since last time.
 *
 * A centre profile is the same statistics accumulated ACROSS sessions at one
 * camera. That buys two things a per-video baseline cannot:
 *
 *   1. A hall's normal is known before the exam starts, rather than learned
 *      from the first two minutes of the exam itself - which is precisely the
 *      window when candidates are settling and least representative.
 *   2. A new session can be compared against it, so "this camera sees
 *      something different today" becomes measurable.
 *
 * Everything here is additive: it reads region_baselines.json, which the
 * pipeline already writes, and changes no detection behaviour.
 */

export interface RegionStats {
  mu: number
  sigma: number
  samples: number
}

/** region_baselines.json, as written by module10_region_baseline.py. */
export interface RegionBaselines {
  frame_resolution?: number[]
  grid?: number[]
  regions: Record<string, RegionStats>
}

export interface CentreProfile {
  centre_id: string
  camera_id: string
  grid: number[]
  frame_resolution: number[]
  /** Sessions folded into this profile. */
  sessions: number
  regions: Record<string, RegionStats>
  updated_at: string
}

export type DriftVerdict = 'stable' | 'camera_moved' | 'scene_changed' | 'unusable' | 'no_baseline'

export interface DriftReport {
  centre_id: string
  camera_id: string
  verdict: DriftVerdict
  /** Fraction of regions whose mean shifted beyond the tolerance. 0-1. */
  regions_shifted: number
  regions_compared: number
  /** Largest standardised shift seen in any single region. */
  peak_shift: number
  reasoning: string
  /** Regions worth a human look, worst first. */
  worst_regions: { region: string; shift: number; was: number; now: number }[]
}

/**
 * How far a region's mean may move, in units of that region's own historical
 * sigma, before it counts as shifted.
 *
 * Expressed in sigma rather than absolute activity because regions differ by
 * orders of magnitude - on this footage a doorway sits at mu 1.18 while a back
 * wall sits at 0.00, so any absolute tolerance is simultaneously deaf in one
 * and hair-trigger in the other.
 */
export const SHIFT_TOLERANCE_SIGMA = 3.0

/**
 * Fraction of regions that must shift before the whole view is called changed
 * rather than one part of it.
 *
 * This is the discriminator that makes the report actionable. A camera that
 * has been knocked re-frames everything at once, so most regions move
 * together. A hall that is simply busier today moves a few. Reporting those as
 * the same event would send an engineer to a centre whose only problem is more
 * candidates.
 */
export const GLOBAL_SHIFT_FRACTION = 0.5

/**
 * Regions that must shift before "the whole view moved" is claimed at all,
 * regardless of what fraction they represent.
 *
 * The fraction alone is not enough on a coarse grid: with four cells, one
 * moving desk is 25% and with two cells it is 50%, so a purely proportional
 * rule calls a single localised change a camera move. Concluding the frame
 * shifted needs corroboration from several independent cells, and three is the
 * smallest number that is corroboration rather than a pair of coincidences.
 */
export const GLOBAL_SHIFT_MIN_REGIONS = 3

/** Below this a profile has not seen enough sessions to judge anything against. */
export const MIN_SESSIONS_TO_JUDGE = 1

/**
 * Folds one session's baselines into a centre profile.
 *
 * Means are combined weighted by sample count, so a long session counts for
 * more than a short one. Sigma is pooled the same way rather than averaged:
 * averaging standard deviations understates spread, and this value is the
 * denominator for every later drift test, so understating it would make the
 * fleet look like it is drifting constantly.
 */
export function foldSession(
  existing: CentreProfile | null,
  centreId: string,
  cameraId: string,
  baselines: RegionBaselines
): CentreProfile {
  const now = new Date().toISOString()
  const grid = baselines.grid ?? existing?.grid ?? []
  const frameRes = baselines.frame_resolution ?? existing?.frame_resolution ?? []

  if (!existing) {
    return {
      centre_id: centreId,
      camera_id: cameraId,
      grid,
      frame_resolution: frameRes,
      sessions: 1,
      regions: { ...baselines.regions },
      updated_at: now,
    }
  }

  const merged: Record<string, RegionStats> = { ...existing.regions }

  for (const [region, incoming] of Object.entries(baselines.regions)) {
    const prior = existing.regions[region]
    if (!prior) {
      merged[region] = { ...incoming }
      continue
    }

    const nA = prior.samples || 1
    const nB = incoming.samples || 1
    const n = nA + nB
    const mu = (prior.mu * nA + incoming.mu * nB) / n

    // Pooled variance about the combined mean, including the shift of each
    // group's own mean away from it - dropping that term would collapse the
    // spread of a camera whose two sessions sat at different levels, which is
    // exactly the case drift detection needs to stay sensitive to.
    const varA = prior.sigma ** 2
    const varB = incoming.sigma ** 2
    const pooled =
      (nA * (varA + (prior.mu - mu) ** 2) + nB * (varB + (incoming.mu - mu) ** 2)) / n

    merged[region] = {
      mu: Number(mu.toFixed(6)),
      sigma: Number(Math.sqrt(Math.max(pooled, 1e-6)).toFixed(6)),
      samples: n,
    }
  }

  return {
    centre_id: centreId,
    camera_id: cameraId,
    grid,
    frame_resolution: frameRes,
    sessions: existing.sessions + 1,
    regions: merged,
    updated_at: now,
  }
}

/**
 * Compares a fresh session against a centre's stored profile.
 *
 * Reports what changed and how widely, and deliberately stops short of saying
 * why: "most of the view shifted" is consistent with a knocked camera, a
 * swapped lens or a rearranged hall, and the report says which of those only
 * a person at the centre can tell.
 */
export function detectDrift(
  profile: CentreProfile | null,
  baselines: RegionBaselines,
  centreId: string,
  cameraId: string
): DriftReport {
  const base: DriftReport = {
    centre_id: centreId,
    camera_id: cameraId,
    verdict: 'no_baseline',
    regions_shifted: 0,
    regions_compared: 0,
    peak_shift: 0,
    reasoning: '',
    worst_regions: [],
  }

  if (!profile || profile.sessions < MIN_SESSIONS_TO_JUDGE) {
    return {
      ...base,
      reasoning:
        'No stored profile for this camera yet. This session becomes the baseline; ' +
        'drift can be measured from the next one onwards.',
    }
  }

  // A different grid or resolution means the two are not comparable cell for
  // cell. Silently comparing them would produce confident nonsense.
  if (
    profile.grid.join('x') !== (baselines.grid ?? []).join('x') ||
    profile.frame_resolution.join('x') !== (baselines.frame_resolution ?? []).join('x')
  ) {
    return {
      ...base,
      verdict: 'unusable',
      reasoning:
        `Grid or resolution differs from the stored profile ` +
        `(${profile.grid.join('x')} @ ${profile.frame_resolution.join('x')} vs ` +
        `${(baselines.grid ?? []).join('x')} @ ${(baselines.frame_resolution ?? []).join('x')}). ` +
        `Regions are not comparable; re-baseline this camera.`,
    }
  }

  const shifts: { region: string; shift: number; was: number; now: number }[] = []

  for (const [region, prior] of Object.entries(profile.regions)) {
    const now = baselines.regions[region]
    if (!now) continue
    // Guard the denominator: a region that never moved has sigma at the floor,
    // and dividing by it would turn the first speck of activity into a huge
    // shift. The floor is the same order as module10's own sigma floor.
    const denom = Math.max(prior.sigma, 1e-3)
    const shift = Math.abs(now.mu - prior.mu) / denom
    shifts.push({ region, shift: Number(shift.toFixed(2)), was: prior.mu, now: now.mu })
  }

  if (shifts.length === 0) {
    return { ...base, verdict: 'unusable', reasoning: 'No overlapping regions to compare.' }
  }

  const shifted = shifts.filter((s) => s.shift > SHIFT_TOLERANCE_SIGMA)
  const fraction = shifted.length / shifts.length
  const peak = Math.max(...shifts.map((s) => s.shift))
  const worst = [...shifts].sort((a, b) => b.shift - a.shift).slice(0, 3)

  const common = {
    ...base,
    regions_shifted: shifted.length,
    regions_compared: shifts.length,
    peak_shift: Number(peak.toFixed(2)),
    worst_regions: worst,
  }

  if (shifted.length === 0) {
    return {
      ...common,
      verdict: 'stable',
      reasoning:
        `All ${shifts.length} regions within ${SHIFT_TOLERANCE_SIGMA} sigma of their stored ` +
        `normal (peak ${peak.toFixed(1)}). Evidence from this camera is comparable to previous sessions.`,
    }
  }

  if (fraction >= GLOBAL_SHIFT_FRACTION && shifted.length >= GLOBAL_SHIFT_MIN_REGIONS) {
    return {
      ...common,
      verdict: 'camera_moved',
      reasoning:
        `${shifted.length} of ${shifts.length} regions shifted together - the whole view changed, ` +
        `not one part of it. Consistent with the camera being moved, re-aimed or re-focused. ` +
        `Region baselines for this camera are stale until someone confirms the framing.`,
    }
  }

  const tooCoarse =
    fraction >= GLOBAL_SHIFT_FRACTION && shifted.length < GLOBAL_SHIFT_MIN_REGIONS

  return {
    ...common,
    verdict: 'scene_changed',
    reasoning: tooCoarse
      ? `${shifted.length} of ${shifts.length} regions shifted. That is a large share, but too few ` +
        `cells to tell a moved camera from a localised change - this grid is too coarse to ` +
        `distinguish them. Treated as localised, which is the assumption that does not send ` +
        `an engineer to a centre whose hall is merely busier.`
      : `${shifted.length} of ${shifts.length} regions shifted (peak ${peak.toFixed(1)} sigma) while ` +
        `the rest held. Localised change - a rearranged desk, a new light, or genuinely more ` +
        `activity in that part of the hall. The camera itself looks unmoved.`,
  }
}

/**
 * Fleet triage: which cameras need attention before the exam, worst first.
 *
 * Ordered by how much they undermine evidence rather than by raw shift - an
 * uncomparable camera is worse than a moved one, because a moved camera at
 * least still produces usable footage once re-baselined.
 */
export function rankFleet(reports: DriftReport[]): DriftReport[] {
  const severity: Record<DriftVerdict, number> = {
    unusable: 0,
    camera_moved: 1,
    scene_changed: 2,
    no_baseline: 3,
    stable: 4,
  }
  return [...reports].sort(
    (a, b) => severity[a.verdict] - severity[b.verdict] || b.peak_shift - a.peak_shift
  )
}
