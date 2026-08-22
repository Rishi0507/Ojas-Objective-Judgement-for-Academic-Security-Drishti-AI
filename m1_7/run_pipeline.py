"""
ExamVision — Full Pipeline Orchestrator
========================================
Chains Modules 1-7 end-to-end on a single raw input video:

  video.mp4
    -> Module 1: metadata extraction        -> header.json
    -> Module 2: frame sampling              -> frames/ + manifest.json
    -> Module 3: motion detection + flow     -> motion.csv, masks/, flow/
    -> Module 4: mask cleanup                -> cleaned_masks/
    -> Module 5: ROI extraction              -> rois/rois_per_frame.json, rois.csv
    -> Module 6: camera/quality analysis     -> quality.csv
    -> Module 7: temporal event segmentation -> events/events.json, events.csv, clips/

Each module is invoked exactly as its own tested CLI (same flags verified
during development), so this script is a thin, transparent wrapper — nothing
here re-implements pipeline logic, it only sequences the existing modules
and wires each one's output paths into the next one's input flags.

Usage:
    python run_pipeline.py path/to/video.mp4 --out-dir output/video_01/

    # override any stage's key parameters if needed:
    python run_pipeline.py video.mp4 --out-dir out/ --target-fps 5 \\
        --start-thresh 0.20 --continue-thresh 0.10

Requires module1_metadata.py ... module7_event_segmentation.py to be in the
same directory as this script (or on PYTHONPATH).
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run_step(name: str, cmd: list, log_file: Path):
    """Run one module's CLI as a subprocess, streaming its stdout/stderr
    to both the console and a per-stage log file. Raises on nonzero exit
    so a failure in an early stage stops the whole pipeline immediately
    rather than silently cascading garbage into later stages."""
    print(f"\n{'='*70}\n[STAGE] {name}\n{'='*70}")
    print(f"$ {' '.join(str(c) for c in cmd)}")
    t0 = time.time()
    with open(log_file, "w") as lf:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        lf.write(result.stdout or "")
    elapsed = time.time() - t0
    tail = "\n".join((result.stdout or "").splitlines()[-15:])
    print(tail)
    print(f"[STAGE] {name} finished in {elapsed:.2f}s (exit code {result.returncode})")
    if result.returncode != 0:
        raise RuntimeError(
            f"Stage '{name}' failed (exit {result.returncode}). "
            f"Full log: {log_file}"
        )
    return elapsed


def run_pipeline(video_path: str, out_dir: str, args) -> dict:
    video_path = Path(video_path).resolve()
    if not video_path.is_file():
        raise FileNotFoundError(f"Input video not found: {video_path}")

    out_dir = Path(out_dir).resolve()
    logs_dir = out_dir / "logs"
    out_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    header_path = out_dir / "header.json"
    frames_dir = out_dir / "frames"
    motion_csv = out_dir / "motion.csv"
    masks_dir = out_dir / "masks"
    flow_dir = out_dir / "flow"
    cleaned_masks_dir = out_dir / "cleaned_masks"
    rois_dir = out_dir / "rois"
    quality_csv = out_dir / "quality.csv"
    events_dir = out_dir / "events"

    stage_timings = {}

    # ---- Module 1: Metadata extraction ----
    stage_timings["module1_metadata"] = run_step(
        "Module 1 — Metadata Extraction",
        [sys.executable, str(HERE / "module1_metadata.py"),
         str(video_path), "--out", str(header_path)],
        logs_dir / "01_metadata.log",
    )

    # ---- Module 2: Frame sampling ----
    stage_timings["module2_frame_sampling"] = run_step(
        "Module 2 — Frame Sampling",
        [sys.executable, str(HERE / "module2_frame_sampling.py"),
         str(header_path), "--out-dir", str(frames_dir),
         "--target-fps", str(args.target_fps)],
        logs_dir / "02_frame_sampling.log",
    )
    manifest_path = frames_dir / "manifest.json"

    # ---- Module 3: Motion detection (ensemble) + optical flow ----
    cmd3 = [sys.executable, str(HERE / "module3_motion_detection.py"),
            str(manifest_path), "--out", str(motion_csv),
            "--save-masks", str(masks_dir),
            "--save-flow", str(flow_dir)]
    if args.disable_jerk:
        cmd3.append("--disable-jerk")

    stage_timings["module3_motion_detection"] = run_step(
        "Module 3 — Motion Detection (frame-diff + MOG2/KNN + optical flow)",
        cmd3,
        logs_dir / "03_motion_detection.log",
    )

    # ---- Module 4: Mask cleanup ----
    stage_timings["module4_mask_cleanup"] = run_step(
        "Module 4 — Mask Cleanup (morphological open/close)",
        [sys.executable, str(HERE / "module4_mask_cleanup.py"),
         "--in", str(masks_dir), "--out", str(cleaned_masks_dir),
         "--stats-out", str(out_dir / "cleanup_stats.json")],
        logs_dir / "04_mask_cleanup.log",
    )

    # ---- Module 5: ROI extraction (connected components + merge) ----
    stage_timings["module5_roi_extraction"] = run_step(
        "Module 5 — ROI Extraction (connected components, fill-ratio filtered)",
        [sys.executable, str(HERE / "module5_roi_extraction.py"),
         "--masks-dir", str(cleaned_masks_dir),
         "--motion-csv", str(motion_csv),
         "--out-dir", str(rois_dir)],
        logs_dir / "05_roi_extraction.log",
    )
    rois_json = rois_dir / "rois_per_frame.json"

    # ---- Module 6: Camera & video quality analysis ----
    stage_timings["module6_quality_analysis"] = run_step(
        "Module 6 — Camera & Quality Analysis (ORB/RANSAC shake, blur, brightness)",
        [sys.executable, str(HERE / "module6_quality_analysis.py"),
         "--frames-dir", str(frames_dir),
         "--flow-dir", str(flow_dir),
         "--rois-json", str(rois_json),
         "--motion-csv", str(motion_csv),
         "--out", str(quality_csv)],
        logs_dir / "06_quality_analysis.log",
    )

    # ---- Module 7: Temporal event segmentation ----
    cmd7 = [sys.executable, str(HERE / "module7_event_segmentation.py"),
            "--motion-csv", str(motion_csv),
            "--quality-csv", str(quality_csv),
            "--rois-json", str(rois_json),
            "--header", str(header_path),
            "--out-dir", str(events_dir),
            "--start-thresh", str(args.start_thresh),
            "--continue-thresh", str(args.continue_thresh),
            "--min-duration", str(args.min_duration),
            "--merge-gap", str(args.merge_gap),
            "--padding", str(args.padding),
            "--masks-dir", str(cleaned_masks_dir),
            "--frames-dir", str(frames_dir),
            "--jerk-sudden-thresh", str(args.jerk_sudden_thresh)]
    if not args.no_clips:
        cmd7.append("--export-clips")

    stage_timings["module7_event_segmentation"] = run_step(
        "Module 7 — Temporal Event Segmentation",
        cmd7,
        logs_dir / "07_event_segmentation.log",
    )

    # ---- Summary ----
    events_json_path = events_dir / "events.json"
    events_summary = {}
    events_by_label = {}
    if events_json_path.exists():
        events_summary = json.loads(events_json_path.read_text())
        # events.json only persists event_count + the raw events array —
        # the label breakdown is derived here, not read from a field that
        # doesn't actually exist in the saved file (it was only ever a
        # console-print value inside module7's own CLI, not part of its
        # JSON schema).
        for ev in events_summary.get("events", []):
            label = ev.get("primary_label", "unknown")
            events_by_label[label] = events_by_label.get(label, 0) + 1

    summary = {
        "video_path": str(video_path),
        "out_dir": str(out_dir),
        "stage_timings_sec": {k: round(v, 3) for k, v in stage_timings.items()},
        "total_elapsed_sec": round(sum(stage_timings.values()), 3),
        "event_count": events_summary.get("event_count"),
        "events_by_label": events_by_label,
        "outputs": {
            "header": str(header_path),
            "frames_manifest": str(manifest_path),
            "motion_csv": str(motion_csv),
            "cleaned_masks_dir": str(cleaned_masks_dir),
            "rois_json": str(rois_json),
            "quality_csv": str(quality_csv),
            "events_json": str(events_json_path),
            "events_csv": str(events_dir / "events.csv"),
            "clips_dir": str(events_dir / "clips") if not args.no_clips else None,
            "heatmap_png": str(events_dir / "heatmap.png"),
        },
    }

    summary_path = out_dir / "pipeline_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2))

    print(f"\n{'='*70}\nPIPELINE COMPLETE\n{'='*70}")
    print(f"  Video:        {video_path.name}")
    print(f"  Events found: {summary['event_count']}  {summary['events_by_label']}")
    print(f"  Total time:   {summary['total_elapsed_sec']:.2f}s")
    print(f"  Summary:      {summary_path}")
    print(f"  Events JSON:  {events_json_path}")
    if not args.no_clips:
        print(f"  Clips:        {events_dir / 'clips'}")

    return summary


def main():
    parser = argparse.ArgumentParser(
        description="ExamVision: run the full Module 1-7 pipeline on one video."
    )
    parser.add_argument("video", help="Path to the input video file.")
    parser.add_argument("--out-dir", required=True,
                         help="Directory to write all pipeline outputs into.")
    parser.add_argument("--target-fps", type=float, default=5.0,
                         help="Module 2 sampling rate. Default 5.0 fps.")
    parser.add_argument("--start-thresh", type=float, default=0.20,
                         help="Module 7 hysteresis start threshold. Default 0.20.")
    parser.add_argument("--continue-thresh", type=float, default=0.10,
                         help="Module 7 hysteresis continue threshold. Default 0.10.")
    parser.add_argument("--min-duration", type=float, default=1.5,
                         help="Module 7 minimum event duration (sec). Default 1.5.")
    parser.add_argument("--merge-gap", type=float, default=2.0,
                         help="Module 7 event merge gap (sec). Default 2.0.")
    parser.add_argument("--padding", type=float, default=3.0,
                         help="Module 7 pre/post event padding (sec). Default 3.0.")
    parser.add_argument("--no-clips", action="store_true",
                         help="Skip ffmpeg clip export in Module 7 (faster, JSON/CSV only).")
    parser.add_argument("--disable-jerk", action="store_true",
                         help="Module 3: skip the temporal spectral-residual jerk_score pass.")
    parser.add_argument("--jerk-sudden-thresh", type=float, default=0.6,
                         help="Module 7: peak_jerk_score threshold for motion_character='sudden'. Default 0.6.")
    args = parser.parse_args()

    try:
        run_pipeline(args.video, args.out_dir, args)
    except RuntimeError as e:
        print(f"\n[FATAL] Pipeline stopped: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
