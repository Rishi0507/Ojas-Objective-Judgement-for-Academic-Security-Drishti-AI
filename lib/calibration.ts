/**
 * Threshold calibration from reviewer verdicts.
 *
 * Proposes, never applies. Reviewers confirm or dismiss individual findings;
 * this reads those verdicts back and asks, per detector: is there a confidence
 * cut that would have suppressed the dismissals while keeping the
 * confirmations?
 *
 * The honest part is the refusal. A threshold only helps if the score actually
 * separates the two verdicts, so separability is measured first (AUC) and a
 * proposal is withheld when it is weak — that case means the detector is
 * measuring the wrong thing, and moving its threshold would trade real
 * detections for noise reduction rather than removing a distinguishable error.
 * Reporting "no threshold helps here" is the useful answer, not a failure.
 */

export type Verdict = 'confirmed' | 'dismissed'

export interface ReviewedOffence {
  type: string
  confidence: number
  verdict: Verdict
}

export interface Proposal {
  offence_type: string
  reviewed: number
  confirmed: number
  dismissed: number
  /** 0.5 = confidence is noise for this detector, 1.0 = perfect separation. */
  separability: number
  status: 'proposed' | 'insufficient_data' | 'not_separable' | 'already_clean'
  current_min_confidence: number
  proposed_min_confidence?: number
  /** What the proposed cut would have done to the reviewed set. */
  effect?: {
    dismissed_suppressed: number
    confirmed_lost: number
  }
  reasoning: string
}

/**
 * Minimum reviewed findings before a detector is calibrated at all.
 *
 * Below this a single verdict swings the proposed cut by more than the cut is
 * worth: with 4 samples one dismissal moves the boundary across a quarter of
 * the range. Ten is not statistically comfortable either, but it is the point
 * where a proposal stops being an artefact of one reviewer's mood.
 */
export const MIN_SAMPLES = 10

/**
 * Separability below which no threshold is proposed.
 *
 * 0.65 AUC is weak but non-random. Under it, confirmed and dismissed
 * confidences overlap so heavily that any cut removes roughly as many true
 * findings as false ones.
 */
export const MIN_SEPARABILITY = 0.65

/**
 * Probability that a randomly chosen confirmed finding scores above a randomly
 * chosen dismissed one — the Mann-Whitney U statistic, equal to ROC AUC.
 *
 * Computed by direct pair comparison rather than rank sums: the sample sizes
 * here are tiny, and ties (identical confidences across verdicts) carry real
 * meaning — they are exactly the case where the score cannot separate — so
 * they are counted as half rather than broken arbitrarily.
 */
export function separability(confirmed: number[], dismissed: number[]): number {
  if (confirmed.length === 0 || dismissed.length === 0) return 0.5
  let wins = 0
  for (const c of confirmed) {
    for (const d of dismissed) {
      if (c > d) wins += 1
      else if (c === d) wins += 0.5
    }
  }
  return wins / (confirmed.length * dismissed.length)
}

/**
 * Picks the cut maximising Youden's J (true-positive rate minus false-positive
 * rate), which weights keeping confirmations and dropping dismissals equally.
 *
 * Candidates are midpoints between observed values, so the cut never sits
 * exactly on a sample — landing on one makes the outcome depend on whether the
 * comparison is >= or >, which is not a property of the data.
 */
export function bestCut(confirmed: number[], dismissed: number[]): { cut: number; j: number } {
  const values = [...new Set([...confirmed, ...dismissed])].sort((a, b) => a - b)
  const candidates: number[] = [0]
  for (let i = 0; i < values.length - 1; i++) {
    candidates.push((values[i] + values[i + 1]) / 2)
  }

  let best = { cut: 0, j: -Infinity }
  for (const cut of candidates) {
    const tpr = confirmed.filter((c) => c >= cut).length / confirmed.length
    const fpr = dismissed.filter((d) => d >= cut).length / dismissed.length
    const j = tpr - fpr
    if (j > best.j) best = { cut, j }
  }
  return best
}

/**
 * Builds one proposal per detector.
 *
 * `currentThresholds` is what the pipeline uses today, so a proposal can be
 * expressed as a change rather than an absolute number with no context.
 */
export function proposeThresholds(
  reviewed: ReviewedOffence[],
  currentThresholds: Record<string, number> = {}
): Proposal[] {
  const byType = new Map<string, ReviewedOffence[]>()
  for (const r of reviewed) {
    if (!byType.has(r.type)) byType.set(r.type, [])
    byType.get(r.type)!.push(r)
  }

  const proposals: Proposal[] = []

  for (const [type, rows] of [...byType.entries()].sort()) {
    const confirmed = rows.filter((r) => r.verdict === 'confirmed').map((r) => r.confidence)
    const dismissed = rows.filter((r) => r.verdict === 'dismissed').map((r) => r.confidence)
    const current = currentThresholds[type] ?? 0

    const base: Proposal = {
      offence_type: type,
      reviewed: rows.length,
      confirmed: confirmed.length,
      dismissed: dismissed.length,
      separability: Number(separability(confirmed, dismissed).toFixed(3)),
      status: 'insufficient_data',
      current_min_confidence: current,
      reasoning: '',
    }

    if (rows.length < MIN_SAMPLES) {
      proposals.push({
        ...base,
        reasoning: `Only ${rows.length} reviewed; ${MIN_SAMPLES} needed before one verdict stops dominating the cut.`,
      })
      continue
    }

    if (dismissed.length === 0) {
      proposals.push({
        ...base,
        status: 'already_clean',
        reasoning: `All ${rows.length} reviewed findings were confirmed. Nothing to suppress; raising the bar could only lose true detections.`,
      })
      continue
    }

    if (confirmed.length === 0) {
      proposals.push({
        ...base,
        status: 'not_separable',
        reasoning:
          `All ${rows.length} reviewed findings were dismissed. No confidence cut fixes a detector ` +
          `whose every output was wrong - this one needs its logic revisited, not its threshold.`,
      })
      continue
    }

    if (base.separability < MIN_SEPARABILITY) {
      proposals.push({
        ...base,
        status: 'not_separable',
        reasoning:
          `Confidence does not separate confirmed from dismissed (${base.separability} vs ` +
          `${MIN_SEPARABILITY} needed). Any cut would discard about as many true findings as false ` +
          `ones, so this detector is measuring the wrong thing rather than measuring it at the wrong bar.`,
      })
      continue
    }

    const { cut } = bestCut(confirmed, dismissed)
    const suppressed = dismissed.filter((d) => d < cut).length
    const lost = confirmed.filter((c) => c < cut).length

    if (cut <= current) {
      proposals.push({
        ...base,
        status: 'already_clean',
        reasoning:
          `Best cut (${cut.toFixed(2)}) is at or below the current bar (${current.toFixed(2)}), ` +
          `so the threshold is not what is producing the dismissals.`,
      })
      continue
    }

    proposals.push({
      ...base,
      status: 'proposed',
      proposed_min_confidence: Number(cut.toFixed(3)),
      effect: { dismissed_suppressed: suppressed, confirmed_lost: lost },
      reasoning:
        `Raising the bar from ${current.toFixed(2)} to ${cut.toFixed(2)} would have suppressed ` +
        `${suppressed} of ${dismissed.length} dismissed findings at the cost of ${lost} of ` +
        `${confirmed.length} confirmed. Separability ${base.separability}.`,
    })
  }

  return proposals
}
