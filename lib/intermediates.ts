/**
 * Which parts of a finished job are safe to discard.
 *
 * These three directories are written during the run and read by nothing after
 * Module 7: optical flow feeds Module 6, raw masks feed Module 4, cleaned masks
 * feed Module 5. Once event segmentation has run they are dead weight.
 *
 * Measured on a 143-second clip: flow alone was 291MB of a 370MB job - 79% of
 * the total - which is the difference between a laptop holding a demo's worth
 * of footage and filling up.
 *
 * What is NOT here, and why: frames/ (evidence stills are cut from these),
 * backend_output/ (findings and offence stills), rois/, motion.csv, quality.csv
 * and events/ (including the pre-rendered heatmap) all survive, so every UI
 * surface, the report and the ledger hashes keep working. Re-running Module 7
 * with different thresholds also still works, because it reads the CSVs rather
 * than the masks. What is lost is re-running Modules 4, 5 or 6 without redoing
 * Module 3 first.
 */
export const INTERMEDIATE_DIRS = ['flow', 'masks', 'cleaned_masks'] as const
