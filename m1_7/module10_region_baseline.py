#!/usr/bin/env python3
"""
Module 10 — Hall-specific normality (feature 10.4)
==================================================

A fixed global motion threshold does not generalise across halls, cameras or
lighting setups: what counts as "a lot of movement" in a cramped, brightly-lit
room is noise in a wide, dim one. This module calibrates what is normal *per
region of this specific video*, then scores every frame as a deviation from
that local baseline.

Relationship to Module 3
------------------------
Module 3 already normalises motion per video (5th/95th percentile across the
whole clip). That handles "this camera runs hot overall", but it is a single
whole-frame scale: a doorway that is busy all recording long and a desk that
never moves are held to the same bar. This module goes a level finer — it
partitions the frame into a grid and gives each cell its own mean and standard
deviation, so a z-score of 3 means "unusual *for that spot*".

This module is purely additive. It reads artefacts the pipeline has already
written and writes its own; it does not modify Module 3's scores or any
existing file, and nothing upstream depends on it.

Inputs
------
  rois/rois_per_frame.json   Module 5 — per-frame ROI boxes + motion scores
  frames/manifest.json       Module 2 — sampled frame order and timestamps

Output
------
  baselines/region_baselines.json
      {
        "grid": [cols, rows],
        "calibration_frames": 150,
        "regions": {"r0c1": {"mu": .., "sigma": .., "samples": ..}, ...},
        "frames": [{"frame_idx":.., "timestamp_sec":.., "max_z":..,
                    "regions": {"r0c1": {"activity":.., "z":..}}}],
        "anomalies": [{"frame_idx":.., "region":"r0c1", "z":..}]
      }

Usage
-----
    python module10_region_baseline.py --pipeline-dir pipeline_out/<job>
    python module10_region_baseline.py --pipeline-dir <dir> --grid 4x3 --z-thresh 3.0
"""

import argparse
import json
from pathlib import Path

import numpy as np

# A frame is split into GRID_COLS x GRID_ROWS cells. 4x3 keeps each cell large
# enough that a single person spans one or two cells (so activity is not diced
# into noise) while still separating a doorway from the desks beside it.
DEFAULT_GRID_COLS = 4
DEFAULT_GRID_ROWS = 3

# Frames used to learn "normal". The opening of an exam recording is the
# quietest, most representative stretch: people are seated and settled.
DEFAULT_CALIBRATION_FRAMES = 150

# z above which a region-frame is called anomalous. 3.0 is the usual 3-sigma
# convention — with a near-static baseline, lower values fire constantly.
DEFAULT_Z_THRESH = 3.0


def region_id(row: int, col: int) -> str:
    return f"r{row}c{col}"


def region_of(cx: float, cy: float, width: int, height: int,
              cols: int, rows: int) -> str:
    """Grid cell containing a point, clamped so edge pixels stay in range."""
    col = int(cx / max(width, 1) * cols)
    row = int(cy / max(height, 1) * rows)
    col = min(max(col, 0), cols - 1)
    row = min(max(row, 0), rows - 1)
    return region_id(row, col)


def activity_by_region(frame: dict, width: int, height: int,
                       cols: int, rows: int) -> dict:
    """
    Per-region activity for one frame.

    A region's activity is the total ROI area landing in it, normalised by the
    region's own area. Area rather than ROI count, because one person crossing
    a cell should not read the same as one flickering speck; normalised, so
    regions stay comparable to each other despite rounding differences in cell
    size.
    """
    cell_area = (width / cols) * (height / rows)
    activity = {region_id(r, c): 0.0 for r in range(rows) for c in range(cols)}

    for roi in frame.get("rois", []) or []:
        x1 = roi.get("bbox_x1", 0)
        y1 = roi.get("bbox_y1", 0)
        x2 = roi.get("bbox_x2", 0)
        y2 = roi.get("bbox_y2", 0)
        w = max(0, x2 - x1)
        h = max(0, y2 - y1)
        if w == 0 or h == 0:
            continue
        cx = x1 + w / 2.0
        cy = y1 + h / 2.0
        activity[region_of(cx, cy, width, height, cols, rows)] += (w * h)

    if cell_area > 0:
        for k in activity:
            activity[k] /= cell_area
    return activity


def calibrate_baseline(scores_by_region: dict, calibration_frames: int) -> dict:
    """
    Learn mu/sigma per region from the calibration window.

    sigma is floored rather than merely epsilon-guarded: a region that never
    moved during calibration has sigma 0, and dividing by ~0 turns the first
    speck of movement into an astronomically large z. The floor sets the
    smallest deviation worth calling unusual.
    """
    baselines = {}
    for rid, scores in scores_by_region.items():
        cal = np.asarray(scores[:calibration_frames], dtype=float)
        if cal.size == 0:
            baselines[rid] = {"mu": 0.0, "sigma": 1.0, "samples": 0}
            continue
        mu = float(np.mean(cal))
        sigma = float(np.std(cal))
        baselines[rid] = {
            "mu": round(mu, 6),
            "sigma": round(max(sigma, 1e-3), 6),
            "samples": int(cal.size),
        }
    return baselines


def z_score(activity: float, rid: str, baselines: dict, eps: float = 1e-6) -> float:
    b = baselines.get(rid)
    if not b:
        return 0.0
    return (activity - b["mu"]) / (b["sigma"] + eps)


def run(pipeline_dir: Path, cols: int, rows: int,
        calibration_frames: int, z_thresh: float) -> dict:
    rois_path = pipeline_dir / "rois" / "rois_per_frame.json"
    manifest_path = pipeline_dir / "frames" / "manifest.json"

    if not rois_path.exists():
        raise FileNotFoundError(f"Missing Module 5 output: {rois_path}")
    if not manifest_path.exists():
        raise FileNotFoundError(f"Missing Module 2 output: {manifest_path}")

    with open(rois_path, encoding="utf-8") as f:
        rois_data = json.load(f)
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)

    resolution = rois_data.get("frame_resolution") or []
    if len(resolution) == 2:
        width, height = int(resolution[0]), int(resolution[1])
    else:
        header = manifest.get("header", {})
        width, height = int(header.get("width", 0)), int(header.get("height", 0))
    if width <= 0 or height <= 0:
        raise ValueError("Could not determine frame resolution")

    ts_by_idx = {
        int(f["frame_idx"]): float(f.get("timestamp_sec", 0.0))
        for f in manifest.get("frames", [])
    }

    frames = rois_data.get("frames", [])
    if not frames:
        raise ValueError("rois_per_frame.json contains no frames")

    per_frame_activity = [
        activity_by_region(fr, width, height, cols, rows) for fr in frames
    ]

    scores_by_region = {
        region_id(r, c): [a[region_id(r, c)] for a in per_frame_activity]
        for r in range(rows)
        for c in range(cols)
    }

    baselines = calibrate_baseline(scores_by_region, calibration_frames)

    frame_records = []
    anomalies = []
    for fr, activity in zip(frames, per_frame_activity):
        idx = int(fr.get("frame_idx", 0))
        regions = {}
        max_z = 0.0
        for rid, value in activity.items():
            z = z_score(value, rid, baselines)
            regions[rid] = {"activity": round(value, 6), "z": round(z, 4)}
            if z > max_z:
                max_z = z
            if z >= z_thresh:
                anomalies.append({
                    "frame_idx": idx,
                    "timestamp_sec": ts_by_idx.get(idx, 0.0),
                    "region": rid,
                    "z": round(z, 4),
                })
        frame_records.append({
            "frame_idx": idx,
            "timestamp_sec": ts_by_idx.get(idx, 0.0),
            "max_z": round(max_z, 4),
            "regions": regions,
        })

    return {
        "frame_resolution": [width, height],
        "grid": [cols, rows],
        "calibration_frames": calibration_frames,
        "z_threshold": z_thresh,
        "regions": baselines,
        "frames": frame_records,
        "anomalies": anomalies,
        "summary": {
            "frames_analysed": len(frame_records),
            "anomalous_region_frames": len(anomalies),
            "regions_tracked": len(baselines),
        },
    }


def main():
    parser = argparse.ArgumentParser(
        description="Module 10 — per-region normality baselines and z-scores."
    )
    parser.add_argument("--pipeline-dir", required=True,
                        help="A pipeline_out/<job> directory from Modules 1-7.")
    parser.add_argument("--grid", default=f"{DEFAULT_GRID_COLS}x{DEFAULT_GRID_ROWS}",
                        help="Grid as COLSxROWS (default 4x3).")
    parser.add_argument("--calibration-frames", type=int,
                        default=DEFAULT_CALIBRATION_FRAMES,
                        help="Leading sampled frames used to learn normal (default 150).")
    parser.add_argument("--z-thresh", type=float, default=DEFAULT_Z_THRESH,
                        help="z at or above which a region-frame is anomalous (default 3.0).")
    parser.add_argument("--out", default=None,
                        help="Output path (default <pipeline-dir>/baselines/region_baselines.json).")
    args = parser.parse_args()

    try:
        cols, rows = (int(v) for v in args.grid.lower().split("x"))
    except ValueError:
        parser.error(f"--grid must look like 4x3, got {args.grid!r}")
    if cols < 1 or rows < 1:
        parser.error("--grid dimensions must be >= 1")

    pipeline_dir = Path(args.pipeline_dir).resolve()
    result = run(pipeline_dir, cols, rows, args.calibration_frames, args.z_thresh)

    out_path = Path(args.out) if args.out else pipeline_dir / "baselines" / "region_baselines.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(json.dumps({"out": str(out_path), **result["summary"]}, indent=2))


if __name__ == "__main__":
    main()
