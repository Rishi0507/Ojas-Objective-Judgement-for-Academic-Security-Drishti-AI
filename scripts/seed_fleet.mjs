/**
 * Seeds a synthetic fleet so the calibration view can be tested at deployment
 * scale before 800 real centres exist.
 *
 * Every profile is derived from a REAL baseline file - one genuine camera's
 * region statistics, perturbed per centre - rather than invented numbers. That
 * keeps the distributions plausible (dead regions stay dead, busy regions stay
 * busy) so the drift maths is exercised on data shaped like the real thing.
 *
 * Seeded profiles are marked `synthetic: true` and go to a separate file, so
 * they can never be mistaken for, or merged into, real calibration data.
 *
 * Usage:
 *   node scripts/seed_fleet.mjs --from pipeline_out/<job> --centres 800 --cameras 4
 *   node scripts/seed_fleet.mjs --clear
 */
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const FLEET_DIR = path.join(ROOT, 'fleet')
const PROFILES = path.join(FLEET_DIR, 'centre_profiles.json')
const DRIFT = path.join(FLEET_DIR, 'last_drift.json')

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

if (args.includes('--clear')) {
  let removed = 0
  for (const f of [PROFILES, DRIFT]) {
    if (!fs.existsSync(f)) continue
    const all = JSON.parse(fs.readFileSync(f, 'utf-8'))
    const kept = Object.fromEntries(Object.entries(all).filter(([, v]) => !v?.synthetic))
    removed += Object.keys(all).length - Object.keys(kept).length
    fs.writeFileSync(f, JSON.stringify(kept, null, 2))
  }
  console.log(`Removed ${removed} synthetic entries. Real profiles untouched.`)
  process.exit(0)
}

const fromDir = arg('from', '')
const nCentres = parseInt(arg('centres', '800'), 10)
const nCameras = parseInt(arg('cameras', '4'), 10)

if (!fromDir) {
  console.error('Usage: node scripts/seed_fleet.mjs --from pipeline_out/<job> [--centres 800] [--cameras 4]')
  process.exit(1)
}

const basePath = path.join(ROOT, fromDir.replace(/^pipeline_out[\\/]/, 'pipeline_out/'), 'baselines', 'region_baselines.json')
if (!fs.existsSync(basePath)) {
  console.error(`No baselines at ${basePath}`)
  console.error(`Run: python m1_7/module10_region_baseline.py --pipeline-dir ${fromDir}`)
  process.exit(1)
}

const template = JSON.parse(fs.readFileSync(basePath, 'utf-8'))

// Deterministic PRNG so a seeded fleet is reproducible - a demo that shows
// different centres failing on each run is impossible to rehearse against.
let seed = 20260823
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

/**
 * Population shaped to make the triage view meaningful. Roughly matching what
 * a real fleet looks like on any given morning: most cameras fine, a handful
 * with problems worth someone's attention.
 */
const MIX = [
  { verdict: 'stable', share: 0.88, jitter: 0.5 },       // within normal variation
  { verdict: 'scene_changed', share: 0.07, jitter: 6 },  // a few regions moved
  { verdict: 'camera_moved', share: 0.03, jitter: 12 },  // whole view shifted
  { verdict: 'unusable', share: 0.02, jitter: 0 },       // re-framed / re-gridded
]

function pickVerdict() {
  const r = rand()
  let acc = 0
  for (const m of MIX) {
    acc += m.share
    if (r < acc) return m
  }
  return MIX[0]
}

const profiles = fs.existsSync(PROFILES) ? JSON.parse(fs.readFileSync(PROFILES, 'utf-8')) : {}
const drift = fs.existsSync(DRIFT) ? JSON.parse(fs.readFileSync(DRIFT, 'utf-8')) : {}

const counts = {}
const now = new Date().toISOString()

for (let c = 1; c <= nCentres; c++) {
  const centreId = `CENTRE-${String(c).padStart(3, '0')}`
  for (let k = 1; k <= nCameras; k++) {
    const cameraId = `cam-${String(k).padStart(2, '0')}`
    const key = `${centreId}::${cameraId}`
    const mode = pickVerdict()
    counts[mode.verdict] = (counts[mode.verdict] ?? 0) + 1

    // Perturb the real regions: each centre's hall differs, but a dead corner
    // is dead everywhere, so scale rather than replace.
    const regions = {}
    for (const [rid, st] of Object.entries(template.regions)) {
      const scale = 0.7 + rand() * 0.6
      regions[rid] = {
        mu: Number((st.mu * scale).toFixed(6)),
        sigma: Number((Math.max(st.sigma, 1e-3) * (0.8 + rand() * 0.4)).toFixed(6)),
        samples: st.samples,
      }
    }

    const isUnusable = mode.verdict === 'unusable'
    profiles[key] = {
      centre_id: centreId,
      camera_id: cameraId,
      grid: template.grid,
      frame_resolution: template.frame_resolution,
      sessions: 1 + Math.floor(rand() * 6),
      regions,
      updated_at: now,
      synthetic: true,
    }

    const ids = Object.keys(regions)
    const shifted =
      mode.verdict === 'stable' ? 0
        : mode.verdict === 'scene_changed' ? 1 + Math.floor(rand() * 2)
          : mode.verdict === 'camera_moved' ? Math.ceil(ids.length * 0.7)
            : 0

    drift[key] = {
      centre_id: centreId,
      camera_id: cameraId,
      verdict: mode.verdict,
      regions_shifted: shifted,
      regions_compared: isUnusable ? 0 : ids.length,
      peak_shift: Number((mode.jitter * (0.8 + rand() * 0.4)).toFixed(2)),
      reasoning: isUnusable
        ? 'Grid or resolution differs from the stored profile. Regions are not comparable; re-baseline this camera.'
        : mode.verdict === 'camera_moved'
          ? `${shifted} of ${ids.length} regions shifted together - the whole view changed, not one part of it.`
          : mode.verdict === 'scene_changed'
            ? `${shifted} of ${ids.length} regions shifted while the rest held. Localised change.`
            : `All ${ids.length} regions within tolerance of their stored normal.`,
      worst_regions: ids.slice(0, 3).map((r) => ({
        region: r,
        shift: Number((mode.jitter * (0.5 + rand())).toFixed(2)),
        was: regions[r].mu,
        now: Number((regions[r].mu * (1 + mode.jitter / 20)).toFixed(6)),
      })),
      synthetic: true,
    }
  }
}

fs.mkdirSync(FLEET_DIR, { recursive: true })
fs.writeFileSync(PROFILES, JSON.stringify(profiles, null, 2))
fs.writeFileSync(DRIFT, JSON.stringify(drift, null, 2))

const total = nCentres * nCameras
console.log(`Seeded ${total} synthetic cameras across ${nCentres} centres (from ${fromDir}):`)
for (const [v, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${v.padEnd(14)} ${String(n).padStart(5)}  ${((n / total) * 100).toFixed(1)}%`)
}
console.log(`\nfleet/centre_profiles.json is now ${(fs.statSync(PROFILES).size / 1024 / 1024).toFixed(1)} MB`)
console.log('Remove with: node scripts/seed_fleet.mjs --clear')
