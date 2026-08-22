"""
ExamVision — Module 4: Mask Cleanup
===================================
Takes the raw combined motion masks produced by Module 3 and cleans them
up using classical morphological operations, so Module 5 (connected
components) can extract clean ROIs from them.

Pipeline per mask:
  1. Median blur (3x3)  — kills salt-and-pepper noise from bg subtractor
  2. Morphological OPEN (erosion → dilation) — removes small noise blobs
     whose area < open_kernel².
  3. Morphological CLOSE (dilation → erosion) — fills small gaps inside
     real motion regions, so a person reads as one blob not five.

Tuning (from spec):
  - open_kernel=3, close_kernel=7 are good starting points for 1080p.
  - At 4K, double the kernel sizes.
  - At 640x360 (our test video), halve them.

This script:
  - Reads all PNG masks from Module 3's --save-masks directory.
  - Writes cleaned PNG masks to an output directory (for Module 5).
  - Prints per-mask stats: foreground pixels before/after, % noise removed.

Usage:
    python module4_mask_cleanup.py --in masks/ --out cleaned_masks/
    python module4_mask_cleanup.py --in masks/ --out cleaned_masks/ \\
        --open 3 --close 7 --median 3
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np


# ============================================================
# Core cleanup function
# ============================================================

def clean_mask(
    mask: np.ndarray,
    open_kernel: int = 3,
    close_kernel: int = 7,
    median_kernel: int = 3,
) -> tuple[np.ndarray, dict]:
    """
    Clean a single binary motion mask using median blur + morphological
    opening + morphological closing.

    Parameters
    ----------
    mask : HxW uint8
        Binary mask (0 = background, 255 = foreground).
    open_kernel : int
        Side length of elliptical opening kernel. Removes noise blobs
        smaller than ~open_kernel². Default 3.
    close_kernel : int
        Side length of elliptical closing kernel. Fills gaps up to
        ~close_kernel px wide. Default 7.
    median_kernel : int
        Side length of median blur kernel. Must be odd. 0 disables.
        Default 3.

    Returns
    -------
    cleaned_mask : HxW uint8
    stats : dict
        {"before_fg_pixels", "after_fg_pixels", "noise_removed_pct",
         "gaps_filled_pct"}
    """
    if mask is None or mask.size == 0:
        raise ValueError("clean_mask received empty mask")

    # Binarize in case the input is non-binary (e.g. averaged masks).
    mask_bin = (mask > 0).astype(np.uint8) * 255
    before_fg = int((mask_bin > 0).sum())

    # Step 1: median blur for impulse noise (salt-and-pepper from bg sub).
    # cv2.medianBlur requires odd kernel size > 1.
    if median_kernel and median_kernel >= 3 and (median_kernel % 2) == 1:
        mask_blur = cv2.medianBlur(mask_bin, median_kernel)
    else:
        mask_blur = mask_bin

    # Step 2: morphological opening (erosion → dilation).
    # Open with an elliptical kernel: kills small isolated blobs.
    if open_kernel and open_kernel >= 1:
        k_open = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (open_kernel, open_kernel)
        )
        mask_opened = cv2.morphologyEx(mask_blur, cv2.MORPH_OPEN, k_open)
    else:
        mask_opened = mask_blur

    # Step 3: morphological closing (dilation → erosion).
    # Close with a larger elliptical kernel: merges nearby fragments.
    if close_kernel and close_kernel >= 1:
        k_close = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (close_kernel, close_kernel)
        )
        mask_closed = cv2.morphologyEx(mask_opened, cv2.MORPH_CLOSE, k_close)
    else:
        mask_closed = mask_opened

    after_fg = int((mask_closed > 0).sum())

    # Stats:
    # - noise_removed: pixels that were foreground before but not after
    #   (these are mostly noise killed by opening).
    # - gaps_filled: pixels that were background before but foreground after
    #   (these are gaps filled by closing). Approximated.
    if before_fg > 0:
        noise_removed_pct = max(0.0, (before_fg - after_fg) / before_fg) * 100.0
    else:
        noise_removed_pct = 0.0
    if before_fg > 0:
        gaps_filled_pct = max(0.0, (after_fg - before_fg) / before_fg) * 100.0
    else:
        gaps_filled_pct = 0.0

    stats = {
        "before_fg_pixels": before_fg,
        "after_fg_pixels": after_fg,
        "noise_removed_pct": round(noise_removed_pct, 2),
        "gaps_filled_pct": round(gaps_filled_pct, 2),
    }
    return mask_closed, stats


# ============================================================
# Batch runner: processes all PNG masks in a directory
# ============================================================

def run_batch(
    in_dir: str,
    out_dir: str,
    open_kernel: int = 3,
    close_kernel: int = 7,
    median_kernel: int = 3,
    save_debug_vis: bool = False,
    debug_vis_dir: Optional[str] = None,
) -> dict:
    """
    Process every PNG mask in `in_dir`, write cleaned masks to `out_dir`.
    Optionally write side-by-side debug visualizations.
    """
    in_path = Path(in_dir)
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    if not in_path.is_dir():
        raise NotADirectoryError(f"Input masks dir not found: {in_dir}")

    mask_files = sorted([f for f in in_path.iterdir()
                         if f.suffix.lower() == ".png"])
    if not mask_files:
        raise RuntimeError(f"No PNG masks found in {in_dir}")

    if save_debug_vis:
        if not debug_vis_dir:
            debug_vis_dir = str(out_path.parent / f"{out_path.name}_debug")
        debug_path = Path(debug_vis_dir)
        debug_path.mkdir(parents=True, exist_ok=True)

    all_stats = []
    t0 = time.time()
    for mf in mask_files:
        mask = cv2.imread(str(mf), cv2.IMREAD_GRAYSCALE)
        if mask is None:
            print(f"[warn] could not read {mf}, skipping", file=sys.stderr)
            continue
        cleaned, stats = clean_mask(
            mask, open_kernel, close_kernel, median_kernel
        )
        stats["file"] = mf.name
        all_stats.append(stats)

        cv2.imwrite(str(out_path / mf.name), cleaned)

        if save_debug_vis:
            # Side-by-side: original | cleaned | diff (red = removed, green = added)
            h, w = mask.shape
            vis = np.zeros((h, w * 3, 3), dtype=np.uint8)
            vis[:, :w, 0] = mask  # original in blue channel
            vis[:, w:2*w, 1] = cleaned  # cleaned in green channel
            # diff: red where removed, green where added
            removed = (mask > 0) & (cleaned == 0)
            added = (mask == 0) & (cleaned > 0)
            vis[:, 2*w:, 2] = np.where(removed, 255, 0)  # red
            vis[:, 2*w:, 1] = np.where(added, 255, vis[:, 2*w:, 1])
            cv2.imwrite(str(debug_path / f"debug_{mf.name}"), vis)

    elapsed = time.time() - t0

    # Aggregate stats.
    total_before = sum(s["before_fg_pixels"] for s in all_stats)
    total_after = sum(s["after_fg_pixels"] for s in all_stats)
    avg_noise_removed = (
        sum(s["noise_removed_pct"] for s in all_stats) / len(all_stats)
        if all_stats else 0.0
    )
    avg_gaps_filled = (
        sum(s["gaps_filled_pct"] for s in all_stats) / len(all_stats)
        if all_stats else 0.0
    )

    summary = {
        "in_dir": str(in_path),
        "out_dir": str(out_path),
        "params": {
            "open_kernel": open_kernel,
            "close_kernel": close_kernel,
            "median_kernel": median_kernel,
        },
        "masks_processed": len(all_stats),
        "elapsed_sec": round(elapsed, 3),
        "avg_ms_per_mask": round(1000 * elapsed / max(1, len(all_stats)), 2),
        "total_before_fg_pixels": total_before,
        "total_after_fg_pixels": total_after,
        "avg_noise_removed_pct": round(avg_noise_removed, 2),
        "avg_gaps_filled_pct": round(avg_gaps_filled, 2),
        "debug_vis_dir": debug_vis_dir if save_debug_vis else None,
    }
    return summary, all_stats


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="ExamVision Module 4: clean motion masks via median blur + "
                    "morphological opening + closing."
    )
    parser.add_argument(
        "--in", "-i", dest="in_dir", required=True,
        help="Directory of input PNG masks (from Module 3's --save-masks)."
    )
    parser.add_argument(
        "--out", "-o", required=True,
        help="Output directory for cleaned masks."
    )
    parser.add_argument("--open", type=int, default=3,
                        help="Opening kernel size (default 3, kills small noise)")
    parser.add_argument("--close", type=int, default=7,
                        help="Closing kernel size (default 7, merges fragments)")
    parser.add_argument("--median", type=int, default=3,
                        help="Median blur kernel size (default 3, 0 to disable)")
    parser.add_argument("--save-debug-vis", action="store_true",
                        help="Write side-by-side debug visualizations.")
    parser.add_argument("--stats-out", default=None,
                        help="Optional JSON path for per-mask stats.")
    args = parser.parse_args()

    summary, all_stats = run_batch(
        in_dir=args.in_dir,
        out_dir=args.out,
        open_kernel=args.open,
        close_kernel=args.close,
        median_kernel=args.median,
        save_debug_vis=args.save_debug_vis,
    )

    print(json.dumps(summary, indent=2))

    if args.stats_out:
        with open(args.stats_out, "w") as f:
            json.dump({"summary": summary, "per_mask": all_stats}, f, indent=2)
        print(f"[ok] per-mask stats written to {args.stats_out}", file=sys.stderr)


if __name__ == "__main__":
    main()
