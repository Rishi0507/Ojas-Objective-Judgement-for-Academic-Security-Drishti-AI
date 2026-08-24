import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()

/**
 * Resolves the pipeline_out/<dir> for the currently active video (whatever
 * public/api/events.json currently points at -  the original demo clip or
 * the most recently completed upload). Falls back to the bundled demo
 * clip's directory if the pointer field is missing (e.g. events.json
 * predates the pipeline_dir field being added).
 */
export function getCurrentPipelineDir(): string {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'api', 'events.json'), 'utf-8'))
    if (typeof data.pipeline_dir === 'string' && data.pipeline_dir) {
      return data.pipeline_dir
    }
  } catch {
    // fall through to default
  }
  return 'cctv_video'
}
