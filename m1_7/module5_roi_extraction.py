"""
ExamVision — Module 5: Connected Components → Candidate ROIs
============================================================
Turns the cleaned binary motion masks from Module 4 into discrete
bounding-box ROIs that downstream modules can score, track, or feed
to an object detector.

Pipeline per mask:
  1. connectedComponentsWithStats  — group adjacent fg pixels into blobs
  2. min_area / max_area filter      — drop too-small noise and full-frame
                                       false positives
  3. aspect-ratio filter             — drop thin slivers (edge noise)
  4. Union-Find transitive merge     — merge boxes that overlap (IoU) or
                                       are within `dist_thresh` of each
                                       other, transitively (so A-B-C all
                                       merge if A~B and B~C)

Outputs per video:
  - rois.csv           : one row per (frame_idx, roi_id)
                         columns: frame_idx, timestamp_sec, roi_id, bbox_x1,
                                  bbox_y1, bbox_x2, bbox_y2, area, cx, cy,
                                  w, h, aspect_ratio
  - rois_per_frame.json: list of {frame_idx, timestamp_sec, rois: [...]}
                         (richer structure for downstream modules)
  - (optional) viz/    : original frames with bboxes drawn, for debugging

Usage:
    python module5_roi_extraction.py \\
        --frames-dir pipeline_out/video/frames \\
        --masks-dir  pipeline_out/video/cleaned_masks \\
        --motion-csv pipeline_out/video/motion.csv \\
        --out-dir    pipeline_out/video/rois

    # Tune thresholds (defaults are resolution-aware):
    python module5_roi_extraction.py ... \\
        --min-area-frac 0.001 --max-area-frac 0.5 --aspect-ratio-max 8.0 \\
        --iou-thresh 0.05 --dist-thresh 30
"""

import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np


# ============================================================
# Connected components
# ============================================================

def extract_components(mask: np.ndarray) -> list[dict]:
    """
    Run connectedComponentsWithStats on a binary mask and return a list
    of component dicts with bbox / area / centroid.

    Label 0 is background; we skip it.
    """
    # connectedComponentsWithStats wants a uint8 single-channel image.
    # Ensure binary (0/255 not 0/1).
    mask_bin = (mask > 0).astype(np.uint8) * 255
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
        mask_bin, connectivity=8
    )

    components = []
    for i in range(1, num_labels):  # skip label 0 (background)
        x = int(stats[i, cv2.CC_STAT_LEFT])
        y = int(stats[i, cv2.CC_STAT_TOP])
        w = int(stats[i, cv2.CC_STAT_WIDTH])
        h = int(stats[i, cv2.CC_STAT_HEIGHT])
        area = int(stats[i, cv2.CC_STAT_AREA])
        cx, cy = float(centroids[i][0]), float(centroids[i][1])
        components.append({
            "id": i,
            "bbox": [x, y, x + w, y + h],   # x1, y1, x2, y2
            "x": x, "y": y, "w": w, "h": h,
            "area": area,
            "cx": cx, "cy": cy,
            "aspect_ratio": float(w) / float(h) if h > 0 else float("inf"),
        })
    return components


# ============================================================
# Geometry helpers
# ============================================================

def iou(box1: list[int], box2: list[int]) -> float:
    """IoU between two boxes in [x1, y1, x2, y2] format."""
    x1, y1 = max(box1[0], box2[0]), max(box1[1], box2[1])
    x2, y2 = min(box1[2], box2[2]), min(box1[3], box2[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if inter == 0:
        return 0.0
    area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
    area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union = area1 + area2 - inter
    return inter / union if union > 0 else 0.0


def center_distance(box1: list[int], box2: list[int]) -> float:
    """Euclidean distance between box centers."""
    cx1 = (box1[0] + box1[2]) / 2
    cy1 = (box1[1] + box1[3]) / 2
    cx2 = (box2[0] + box2[2]) / 2
    cy2 = (box2[1] + box2[3]) / 2
    return float(np.hypot(cx1 - cx2, cy1 - cy2))


def _box_edge_distance(box1: list[int], box2: list[int]) -> float:
    """
    Minimum distance between the two boxes' edges. 0 if they overlap.
    Cheaper than full minimum-distance-between-rectangles for the merge
    decision; we only need "are these boxes within `dist_thresh` of
    each other?"
    """
    # If they overlap on both axes, edge distance is 0.
    dx = max(0, max(box1[0] - box2[2], box2[0] - box1[2]))
    dy = max(0, max(box1[1] - box2[3], box2[1] - box1[3]))
    return float(np.hypot(dx, dy))


def _bbox_union(boxes: list[list[int]]) -> list[int]:
    """Union bounding box of a list of boxes."""
    x1 = min(b[0] for b in boxes)
    y1 = min(b[1] for b in boxes)
    x2 = max(b[2] for b in boxes)
    y2 = max(b[3] for b in boxes)
    return [x1, y1, x2, y2]


# ============================================================
# Filters
# ============================================================

def filter_components(
    components: list[dict],
    min_area: int,
    max_area: int,
    aspect_ratio_max: float,
    min_fill_ratio: float = 0.15,
) -> list[dict]:
    """
    Drop components that are too small, too big, too thin, or too sparse.

    - min_area: drop noise blobs (single-pixel flickers, JPEG artifacts)
    - max_area: drop full-frame false positives (e.g. lighting change
                making bg subtractor flag everything). Safety net for
                Module 3 warm-up bugs that might leak through.
    - aspect_ratio_max: drop thin slivers (edge noise, scan-line artifacts).
                        A real human head or hand has aspect ratio < ~8.
    - min_fill_ratio: drop components whose pixel area is a small
                      fraction of their bounding-box area. Catches the
                      case where Module 4's morphological closing bridges
                      scattered noise pixels diagonally into one giant
                      frame-spanning component with a sparse 5-15% fill.
                      A real coherent blob (person, hand) should fill at
                      least ~15% of its bbox; typical real motion fills
                      40-90%. Default 0.15 is intentionally lenient to
                      avoid dropping legitimately elongated motion.
    """
    keep = []
    for c in components:
        if c["area"] < min_area:
            continue
        if c["area"] > max_area:
            continue
        if c["aspect_ratio"] > aspect_ratio_max:
            continue
        # Also drop degenerate boxes (zero width or height).
        if c["w"] < 1 or c["h"] < 1:
            continue
        # Fill-ratio check: drop sparse-but-spatially-spread components.
        bbox_area = c["w"] * c["h"]
        fill_ratio = c["area"] / bbox_area if bbox_area > 0 else 0.0
        if fill_ratio < min_fill_ratio:
            continue
        # Stash fill_ratio for downstream visibility/debugging.
        c["fill_ratio"] = round(fill_ratio, 4)
        keep.append(c)
    return keep


# ============================================================
# Transitive merge via Union-Find
# ============================================================

class UnionFind:
    """Minimal Union-Find for transitive ROI merging."""

    def __init__(self, n: int):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]  # path compression
            x = self.parent[x]
        return x

    def union(self, x: int, y: int) -> None:
        rx, ry = self.find(x), self.find(y)
        if rx == ry:
            return
        # Union by rank to keep trees shallow.
        if self.rank[rx] < self.rank[ry]:
            rx, ry = ry, rx
        self.parent[ry] = rx
        if self.rank[rx] == self.rank[ry]:
            self.rank[rx] += 1


def merge_nearby_rois(
    components: list[dict],
    iou_thresh: float = 0.1,
    dist_thresh: float = 40.0,
    min_fill_ratio: float = 0.15,
) -> list[dict]:
    """
    Merge ROIs that overlap (IoU > threshold) OR whose edges are within
    `dist_thresh` pixels of each other. Uses Union-Find so the merge
    relation is transitive: if A~B and B~C, all three get merged into
    one ROI (the spec's single-pass greedy missed this case).

    Post-merge fill-ratio veto
    -------------------------
    After computing a merged bbox, we check whether the union bbox is
    too sparse: total child area / bbox area < `min_fill_ratio`. If so,
    the merge is vetoed — the children are kept as separate ROIs
    instead. This catches the case where two real-but-distant blobs
    get transitively merged through a chain of nearby noise pixels,
    producing a frame-spanning bbox that doesn't represent a coherent
    motion region. Vetoed groups fall back to emitting each child
    individually (their original filter-passed bboxes are already
    sensible from filter_components).

    Returns a list of merged component dicts with recomputed bbox/area.
    """
    n = len(components)
    if n <= 1:
        # Even a single component needs its fill_ratio attached for the CSV.
        out = []
        for c in components:
            bbox_area = c["w"] * c["h"]
            c["fill_ratio"] = round(c["area"] / bbox_area, 4) if bbox_area > 0 else 0.0
            out.append(c)
        return out

    uf = UnionFind(n)
    boxes = [c["bbox"] for c in components]

    # O(n^2) pairwise check — fine for the typical 5-50 ROIs per frame.
    # If this becomes a bottleneck at 4K with hundreds of components,
    # switch to a spatial index (R-tree, k-d tree).
    for i in range(n):
        for j in range(i + 1, n):
            if uf.find(i) == uf.find(j):
                continue  # already in the same group
            if iou(boxes[i], boxes[j]) > iou_thresh:
                uf.union(i, j)
                continue
            if _box_edge_distance(boxes[i], boxes[j]) <= dist_thresh:
                uf.union(i, j)

    # Group component indices by their root.
    groups: dict[int, list[int]] = {}
    for i in range(n):
        root = uf.find(i)
        groups.setdefault(root, []).append(i)

    # Build merged ROIs, with post-merge fill-ratio veto.
    merged = []
    for group_indices in groups.values():
        if len(group_indices) == 1:
            # Single component — pass through unchanged, but ensure
            # fill_ratio is attached for downstream CSV/JSON visibility.
            c = components[group_indices[0]]
            bbox_area = c["w"] * c["h"]
            c["fill_ratio"] = round(c["area"] / bbox_area, 4) if bbox_area > 0 else 0.0
            merged.append(c)
            continue

        group_boxes = [components[i]["bbox"] for i in group_indices]
        new_bbox = _bbox_union(group_boxes)
        total_area = sum(components[i]["area"] for i in group_indices)
        new_w = new_bbox[2] - new_bbox[0]
        new_h = new_bbox[3] - new_bbox[1]
        bbox_area = new_w * new_h
        fill_ratio = total_area / bbox_area if bbox_area > 0 else 0.0

        if fill_ratio < min_fill_ratio:
            # Post-merge veto: the merged bbox is too sparse. Keep
            # children as separate ROIs — their pre-merge bboxes were
            # already validated by filter_components.
            for i in group_indices:
                c = components[i]
                # fill_ratio was already attached in filter_components,
                # but ensure it's present even if filter was bypassed.
                if "fill_ratio" not in c:
                    c_ba = c["w"] * c["h"]
                    c["fill_ratio"] = round(c["area"] / c_ba, 4) if c_ba > 0 else 0.0
                merged.append(c)
            continue

        # Recompute centroid as area-weighted average of children.
        sum_cx = sum(components[i]["cx"] * components[i]["area"] for i in group_indices)
        sum_cy = sum(components[i]["cy"] * components[i]["area"] for i in group_indices)
        new_cx = sum_cx / total_area if total_area > 0 else 0.0
        new_cy = sum_cy / total_area if total_area > 0 else 0.0
        merged.append({
            "id": -1,  # IDs are reassigned per-frame downstream
            "bbox": new_bbox,
            "x": new_bbox[0], "y": new_bbox[1],
            "w": new_w, "h": new_h,
            "area": total_area,  # NOTE: this is sum of component areas,
                                  # NOT area of the merged bounding box.
                                  # The bbox area may be larger if children
                                  # are spread out; this is intentional —
                                  # we want the "true motion" area, not the
                                  # enclosing rectangle's area.
            "cx": new_cx, "cy": new_cy,
            "aspect_ratio": float(new_w) / float(new_h) if new_h > 0 else float("inf"),
            "merged_from": len(group_indices),  # how many children were merged
            "fill_ratio": round(fill_ratio, 4),
        })

    return merged


# ============================================================
# Per-frame ROI extraction
# ============================================================

def extract_rois_for_mask(
    mask: np.ndarray,
    min_area: int,
    max_area: int,
    aspect_ratio_max: float,
    iou_thresh: float,
    dist_thresh: float,
    min_fill_ratio: float = 0.15,
) -> list[dict]:
    """Full ROI pipeline for one mask: components → filter → merge."""
    components = extract_components(mask)
    filtered = filter_components(
        components, min_area, max_area, aspect_ratio_max, min_fill_ratio,
    )
    merged = merge_nearby_rois(
        filtered, iou_thresh, dist_thresh, min_fill_ratio,
    )
    # Reassign sequential IDs per-frame for stable downstream references.
    for i, roi in enumerate(merged):
        roi["id"] = i
    return merged


# ============================================================
# Batch runner
# ============================================================

def run_batch(
    masks_dir: str,
    motion_csv: Optional[str],
    out_dir: str,
    min_area_frac: float = 0.001,
    max_area_frac: float = 0.5,
    aspect_ratio_max: float = 8.0,
    iou_thresh: float = 0.05,
    dist_thresh: float = 30.0,
    min_fill_ratio: float = 0.15,
    save_viz: bool = False,
    viz_frames_dir: Optional[str] = None,
) -> dict:
    """
    Process every cleaned mask in `masks_dir`, extract ROIs, write:
      - rois.csv            (one row per ROI)
      - rois_per_frame.json (richer structure)
      - viz/                (optional debug visualization)

    Resolution-aware defaults:
      - min_area = 0.1% of frame area (e.g. 230 px at 640x360, ~2073 px at 1080p)
      - max_area = 50% of frame area (catches bg-subtractor runaway false positives)
      - min_fill_ratio = 0.15 (drops sparse frame-spanning components whose
        bbox is mostly empty; catches the diagonal-chain-through-noise bug
        where Module 4's morphological closing bridges scattered pixels
        into one frame-spanning component with ~5-15% fill)
    """
    in_path = Path(masks_dir)
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    mask_files = sorted([f for f in in_path.iterdir() if f.suffix.lower() == ".png"])
    if not mask_files:
        raise RuntimeError(f"No PNG masks found in {masks_dir}")

    # Read motion.csv to get per-frame timestamps and scores (for joining).
    motion_by_idx = {}
    if motion_csv and os.path.isfile(motion_csv):
        with open(motion_csv) as f:
            for row in csv.DictReader(f):
                motion_by_idx[int(row["frame_idx"])] = {
                    "timestamp_sec": float(row["timestamp_sec"]),
                    "score": float(row["score"]),
                }

    # Detect frame resolution from first mask (for resolution-aware thresholds).
    sample = cv2.imread(str(mask_files[0]), cv2.IMREAD_GRAYSCALE)
    if sample is None:
        raise RuntimeError(f"Could not read first mask: {mask_files[0]}")
    frame_h, frame_w = sample.shape
    frame_area = frame_h * frame_w
    min_area = int(frame_area * min_area_frac)
    max_area = int(frame_area * max_area_frac)

    print(f"[info] frame resolution: {frame_w}x{frame_h} "
          f"({frame_area} px)", file=sys.stderr)
    print(f"[info] min_area={min_area} px ({min_area_frac*100:.2f}% of frame), "
          f"max_area={max_area} px ({max_area_frac*100:.0f}%)", file=sys.stderr)
    print(f"[info] aspect_ratio_max={aspect_ratio_max}, "
          f"iou_thresh={iou_thresh}, dist_thresh={dist_thresh}, "
          f"min_fill_ratio={min_fill_ratio}",
          file=sys.stderr)

    # CSV rows: one per ROI.
    csv_rows = []
    # Per-frame structured output.
    per_frame = []

    if save_viz:
        viz_dir = out_path / "viz"
        viz_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    for mf in mask_files:
        # Parse frame_idx from filename: "mask_f0000123.png" → 123
        stem = mf.stem  # e.g. "mask_f0000123"
        try:
            frame_idx = int(stem.split("_f")[-1])
        except ValueError:
            print(f"[warn] couldn't parse frame_idx from {mf.name}, skipping",
                  file=sys.stderr)
            continue

        mask = cv2.imread(str(mf), cv2.IMREAD_GRAYSCALE)
        if mask is None:
            print(f"[warn] couldn't read {mf}, skipping", file=sys.stderr)
            continue

        rois = extract_rois_for_mask(
            mask, min_area, max_area, aspect_ratio_max,
            iou_thresh, dist_thresh, min_fill_ratio,
        )

        ts = motion_by_idx.get(frame_idx, {}).get("timestamp_sec", frame_idx)
        score = motion_by_idx.get(frame_idx, {}).get("score", 0.0)

        frame_entry = {
            "frame_idx": frame_idx,
            "timestamp_sec": ts,
            "motion_score": score,
            "roi_count": len(rois),
            "rois": [],
        }
        for roi in rois:
            x1, y1, x2, y2 = roi["bbox"]
            row = {
                "frame_idx": frame_idx,
                "timestamp_sec": ts,
                "roi_id": roi["id"],
                "bbox_x1": x1, "bbox_y1": y1,
                "bbox_x2": x2, "bbox_y2": y2,
                "w": roi["w"], "h": roi["h"],
                "area": roi["area"],
                "cx": round(roi["cx"], 1),
                "cy": round(roi["cy"], 1),
                "aspect_ratio": round(roi["aspect_ratio"], 3),
                "fill_ratio": round(roi.get("fill_ratio", 0.0), 4),
                "merged_from": roi.get("merged_from", 1),
            }
            csv_rows.append(row)
            frame_entry["rois"].append(row)

        per_frame.append(frame_entry)

        if save_viz and viz_frames_dir:
            # Find the original sampled frame for this frame_idx.
            # Module 2 names frames as "<video_id>__f<idx>__t<ts>.jpg" — we
            # need to look up by frame_idx rather than just renaming the mask.
            viz_frames_path = Path(viz_frames_dir)
            candidates = list(viz_frames_path.glob(f"*__f{frame_idx:07d}__*.jpg"))
            if not candidates:
                candidates = list(viz_frames_path.glob(f"*__f{frame_idx}__*.jpg"))
            if not candidates:
                candidates = list(viz_frames_path.glob(f"*f{frame_idx:07d}*"))
            if not candidates:
                candidates = list(viz_frames_path.glob(f"*f{frame_idx}*"))
            if candidates:
                frame = cv2.imread(str(candidates[0]))
                if frame is not None:
                    for roi in rois:
                        x1, y1, x2, y2 = roi["bbox"]
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                        label = f"#{roi['id']} a={roi['area']}"
                        cv2.putText(frame, label, (x1, max(0, y1 - 5)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.4,
                                    (0, 255, 0), 1)
                    cv2.imwrite(str(viz_dir / f"viz_f{frame_idx:07d}.jpg"), frame)

    elapsed = time.time() - t0

    # Write rois.csv
    csv_path = out_path / "rois.csv"
    fieldnames = ["frame_idx", "timestamp_sec", "roi_id",
                  "bbox_x1", "bbox_y1", "bbox_x2", "bbox_y2",
                  "w", "h", "area", "cx", "cy", "aspect_ratio",
                  "fill_ratio", "merged_from"]
    with open(csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(csv_rows)

    # Write rois_per_frame.json
    json_path = out_path / "rois_per_frame.json"
    with open(json_path, "w") as f:
        json.dump({
            "frame_resolution": [frame_w, frame_h],
            "thresholds": {
                "min_area": min_area, "max_area": max_area,
                "aspect_ratio_max": aspect_ratio_max,
                "iou_thresh": iou_thresh, "dist_thresh": dist_thresh,
                "min_fill_ratio": min_fill_ratio,
            },
            "frames": per_frame,
        }, f, indent=2)

    # Summary stats.
    frames_with_rois = sum(1 for e in per_frame if e["roi_count"] > 0)
    total_rois = sum(e["roi_count"] for e in per_frame)
    avg_rois_per_frame = total_rois / max(1, len(per_frame))
    if csv_rows:
        areas = [r["area"] for r in csv_rows]
        area_min, area_max = min(areas), max(areas)
        area_median = int(np.median(areas))
        fills = [r["fill_ratio"] for r in csv_rows]
        fill_min, fill_max = round(min(fills), 4), round(max(fills), 4)
        fill_median = round(float(np.median(fills)), 4)
    else:
        area_min = area_max = area_median = 0
        fill_min = fill_max = fill_median = 0.0

    summary = {
        "masks_dir": str(in_path),
        "out_dir": str(out_path),
        "thresholds": {
            "min_area_px": min_area,
            "max_area_px": max_area,
            "aspect_ratio_max": aspect_ratio_max,
            "iou_thresh": iou_thresh,
            "dist_thresh": dist_thresh,
            "min_fill_ratio": min_fill_ratio,
        },
        "frames_processed": len(per_frame),
        "frames_with_rois": frames_with_rois,
        "frames_with_zero_rois": len(per_frame) - frames_with_rois,
        "total_rois": total_rois,
        "avg_rois_per_frame": round(avg_rois_per_frame, 2),
        "roi_area_stats_px": {
            "min": area_min, "max": area_max, "median": area_median,
        },
        "roi_fill_ratio_stats": {
            "min": fill_min, "max": fill_max, "median": fill_median,
        },
        "elapsed_sec": round(elapsed, 3),
        "avg_ms_per_mask": round(1000 * elapsed / max(1, len(per_frame)), 2),
        "out_csv": str(csv_path),
        "out_json": str(json_path),
        "viz_dir": str(out_path / "viz") if save_viz else None,
    }
    return summary


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="ExamVision Module 5: connected-components → candidate ROIs."
    )
    parser.add_argument(
        "--masks-dir", required=True,
        help="Directory of cleaned PNG masks (from Module 4)."
    )
    parser.add_argument(
        "--motion-csv", default=None,
        help="Optional: Module 3's motion.csv for per-frame timestamps and scores."
    )
    parser.add_argument(
        "--out-dir", required=True,
        help="Output directory for rois.csv, rois_per_frame.json, viz/."
    )
    parser.add_argument(
        "--min-area-frac", type=float, default=0.001,
        help="Min ROI area as fraction of frame area (default 0.001 = 0.1%%)."
    )
    parser.add_argument(
        "--max-area-frac", type=float, default=0.5,
        help="Max ROI area as fraction of frame area (default 0.5 = 50%%)."
    )
    parser.add_argument(
        "--aspect-ratio-max", type=float, default=8.0,
        help="Drop ROIs with aspect ratio above this (default 8.0)."
    )
    parser.add_argument(
        "--iou-thresh", type=float, default=0.05,
        help="Merge ROIs with IoU above this (default 0.05)."
    )
    parser.add_argument(
        "--dist-thresh", type=float, default=30.0,
        help="Merge ROIs whose edge distance ≤ this (default 30 px)."
    )
    parser.add_argument(
        "--min-fill-ratio", type=float, default=0.15,
        help="Drop ROIs whose pixel area is < this fraction of their bbox area "
             "(default 0.15 = 15%%). Catches sparse frame-spanning components "
             "where Module 4's morphological closing bridges scattered noise "
             "pixels diagonally into one giant bbox with low fill."
    )
    parser.add_argument(
        "--save-viz", action="store_true",
        help="Draw ROI bboxes on original sampled frames for debugging."
    )
    parser.add_argument(
        "--viz-frames-dir", default=None,
        help="Directory of original sampled frames (JPGs from Module 2), for --save-viz."
    )
    args = parser.parse_args()

    summary = run_batch(
        masks_dir=args.masks_dir,
        motion_csv=args.motion_csv,
        out_dir=args.out_dir,
        min_area_frac=args.min_area_frac,
        max_area_frac=args.max_area_frac,
        aspect_ratio_max=args.aspect_ratio_max,
        iou_thresh=args.iou_thresh,
        dist_thresh=args.dist_thresh,
        min_fill_ratio=args.min_fill_ratio,
        save_viz=args.save_viz,
        viz_frames_dir=args.viz_frames_dir,
    )

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
