"""
ExamVision — Module 7: Temporal Event Segmentation
===================================================
Turns the per-frame S_final signal (S_evidence × Q_observability) into
discrete, named events with clean start/end times — the actual
"segments" the project spec asks for.

Pipeline:
  1. Compute S_final per frame from motion.csv (S_evidence) × quality.csv (Q_observability)
  2. Hysteresis thresholding:
       - START an event when S_final >= start_thresh
       - CONTINUE an event while S_final >= continue_thresh
       - END an event when S_final < continue_thresh
     (Higher bar to start than continue — avoids flickering on/off at a
     single threshold.)
  3. Min-duration filter: drop events shorter than `min_duration` (single-
     frame noise spikes don't become events).
  4. Merge close events: events with a gap <= `merge_gap` get merged
     into one. Runs BEFORE padding.
  5. Padding: extend each event by `padding` seconds on both sides for
     context (so the clip starts a bit before the action). Clip to
     video bounds.
  6. Post-padding re-merge: padding can push adjacent events to overlap;
     re-merge any that now overlap.
  7. Per-event metadata: peak_score, mean_score, frame_count,
     camera_motion_pct, primary_label.
  8. Camera-motion labeling: events are labeled `real_motion`,
     `camera_motion`, or `mixed` based on the fraction of frames where
     possible_camera_motion=1.
  9. Motion-character labeling: if Module 3 wrote a `jerk_score` column
     (temporal spectral-residual saliency — see module3_motion_detection.py
     for the method and its citation, lit review 2.1.12a), each event is
     additionally tagged `motion_character` = "sudden" or "gradual" based
     on its peak jerk_score. Purely additive metadata, consumed downstream
     (Module 8/9, the frontend) as a cheap pre-filter for abrupt/one-off
     motion vs. smooth, continuous motion — it does not affect segmentation
     itself. Falls back to all-zero jerk ("gradual") if the column is
     absent, for backward compatibility with motion.csv files predating
     this feature.

Outputs:
  - events.json   : list of events with full metadata
  - events.csv    : same data in tabular form (one row per event)
  - (optional) clips/ : subvideo per event, via ffmpeg
  - (optional) heatmap.png : accumulated motion heatmap over the whole
    video, overlaid on a representative frame — if --masks-dir and
    --frames-dir are given.

Usage:
    python module7_event_segmentation.py \\
        --motion-csv pipeline_out/video/motion.csv \\
        --quality-csv pipeline_out/video/quality.csv \\
        --rois-json pipeline_out/video/rois/rois_per_frame.json \\
        --header pipeline_out/video/header.json \\
        --out-dir pipeline_out/video/events \\
        --masks-dir pipeline_out/video/cleaned_masks \\
        --frames-dir pipeline_out/video/frames
"""

import argparse
import csv
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np


# ============================================================
# Core segmentation
# ============================================================

def segment_events(
    timestamps: list[float],
    scores: list[float],
    start_thresh: float = 0.20,
    continue_thresh: float = 0.10,
    min_duration: float = 1.5,
    merge_gap: float = 2.0,
    padding: float = 3.0,
) -> list[dict]:
    """
    Hysteresis-based event segmentation.

    Parameters
    ----------
    timestamps : per-frame timestamps (seconds from video start)
    scores : per-frame S_final scores (S_evidence × Q_observability)
    start_thresh : S_final must reach this to START an event.
                   Higher than continue_thresh to avoid flicker.
    continue_thresh : S_final must stay above this to CONTINUE an event.
                      If it drops below, the event ends.
    min_duration : raw events shorter than this (seconds) don't become a
                   padded, clip-exported "full_event" — they're kept as a
                   lower-confidence "short_motion" record instead (real,
                   above-threshold motion too brief to treat as a reviewable
                   clip, e.g. a quick hand gesture or head turn), not dropped.
    merge_gap : events with a gap <= this (seconds) get merged. Applied
                BEFORE the min_duration split, so two brief bursts close
                together get a chance to combine into a full event rather
                than each being judged too short individually.
    padding : each full_event gets this much padding (seconds) on both
              sides for context. Clipped to video bounds. Not applied to
              short_motion records (no clip is exported for those).
    """
    if not timestamps or not scores:
        return []
    if len(timestamps) != len(scores):
        raise ValueError(f"len(timestamps)={len(timestamps)} != len(scores)={len(scores)}")

    if start_thresh < continue_thresh:
        raise ValueError(
            f"start_thresh ({start_thresh}) must be >= continue_thresh "
            f"({continue_thresh}) — hysteresis requires a higher bar to "
            f"start an event than to continue one."
        )

    video_end = timestamps[-1]

    # ---- Pass 1: hysteresis thresholding (no duration filter yet) ----
    # Use >= and <= (not > and <) to avoid flicker at exactly threshold values.
    raw_events: list[dict] = []
    in_event = False
    event_start_idx = None
    event_start_ts = None

    for i, (t, s) in enumerate(zip(timestamps, scores)):
        if not in_event:
            if s >= start_thresh:
                in_event = True
                event_start_idx = i
                event_start_ts = t
        else:
            if s < continue_thresh:
                in_event = False
                raw_events.append({
                    "start": event_start_ts,
                    "end": t,
                    "start_frame_idx": event_start_idx,
                    "end_frame_idx": i,
                    "duration": t - event_start_ts,
                })

    # Handle video ending mid-event.
    if in_event:
        raw_events.append({
            "start": event_start_ts,
            "end": video_end,
            "start_frame_idx": event_start_idx,
            "end_frame_idx": len(timestamps) - 1,
            "duration": video_end - event_start_ts,
        })

    if not raw_events:
        return []

    # ---- Pass 2: merge close raw events (before the duration split) ----
    merged_raw: list[dict] = []
    for ev in raw_events:
        if merged_raw and ev["start"] - merged_raw[-1]["end"] <= merge_gap:
            # Extend the previous event to include this one.
            merged_raw[-1]["end"] = ev["end"]
            merged_raw[-1]["end_frame_idx"] = ev["end_frame_idx"]
            merged_raw[-1]["duration"] = merged_raw[-1]["end"] - merged_raw[-1]["start"]
        else:
            merged_raw.append(dict(ev))

    # ---- Pass 3: split into full events vs. short_motion records ----
    full_candidates = [ev for ev in merged_raw if ev["duration"] >= min_duration]
    short_events = [ev for ev in merged_raw if ev["duration"] < min_duration]

    # ---- Pass 4: padding for full events (clipped to video bounds) ----
    padded: list[dict] = []
    for ev in full_candidates:
        new_start = max(0.0, ev["start"] - padding)
        new_end = min(video_end, ev["end"] + padding)
        padded.append({
            "start": new_start,
            "end": new_end,
            "start_frame_idx": ev["start_frame_idx"],
            "end_frame_idx": ev["end_frame_idx"],
            "duration": new_end - new_start,
            "unpadded_start": ev["start"],
            "unpadded_end": ev["end"],
        })

    # ---- Pass 5: post-padding re-merge ----
    # Padding can push adjacent events to overlap. If two events now overlap,
    # merge them into one.
    full_final: list[dict] = []
    for ev in padded:
        if full_final and ev["start"] <= full_final[-1]["end"]:
            # Overlap detected — extend the previous event.
            full_final[-1]["end"] = max(full_final[-1]["end"], ev["end"])
            full_final[-1]["end_frame_idx"] = max(full_final[-1]["end_frame_idx"], ev["end_frame_idx"])
            full_final[-1]["duration"] = full_final[-1]["end"] - full_final[-1]["start"]
            # Keep the unpadded window in sync too — enrich_events() filters
            # frames by [unpadded_start, unpadded_end], so if these aren't
            # widened to cover every merged sub-event, per-event stats only
            # reflect the first sub-event instead of the full merged span.
            full_final[-1]["unpadded_start"] = min(full_final[-1]["unpadded_start"], ev["unpadded_start"])
            full_final[-1]["unpadded_end"] = max(full_final[-1]["unpadded_end"], ev["unpadded_end"])
            # Track that this event was merged post-padding for diagnostics.
            full_final[-1]["post_pad_merges"] = full_final[-1].get("post_pad_merges", 0) + 1
        else:
            ev["post_pad_merges"] = 0
            full_final.append(ev)

    for ev in full_final:
        ev["event_type"] = "full_event"

    # ---- short_motion records: no padding, no clip export ----
    short_final: list[dict] = []
    for ev in short_events:
        short_final.append({
            "start": ev["start"],
            "end": ev["end"],
            "start_frame_idx": ev["start_frame_idx"],
            "end_frame_idx": ev["end_frame_idx"],
            "duration": ev["duration"],
            "unpadded_start": ev["start"],
            "unpadded_end": ev["end"],
            "post_pad_merges": 0,
            "event_type": "short_motion",
        })

    return sorted(full_final + short_final, key=lambda ev: ev["start"])


# ============================================================
# Per-event metadata enrichment
# ============================================================

def enrich_events(
    events: list[dict],
    timestamps: list[float],
    s_finals: list[float],
    s_evidences: list[float],
    q_observabilities: list[float],
    possible_camera_motions: list[int],
    frame_indices: list[int],
    rois_by_frame: Optional[dict[int, list[dict]]] = None,
    jerk_scores: Optional[list[float]] = None,
    jerk_sudden_thresh: float = 0.6,
) -> list[dict]:
    """
    Add per-event metadata:
      - peak_s_final, mean_s_final, min_s_final, max_s_final
      - peak_s_evidence, mean_q_observability
      - frame_count, camera_motion_frame_count, camera_motion_pct
      - primary_label: real_motion / camera_motion / mixed
      - peak_jerk_score, mean_jerk_score, motion_character: sudden / gradual
        (only if `jerk_scores` is provided — see Module 3's jerk_score)
      - roi_summary: count of distinct ROIs, total area, peak area
    """
    if not events:
        return []

    enriched = []
    for ev in events:
        # Find frames within this event's time range (use the original
        # unpadded range for scoring metadata — padded frames are just
        # context, not part of the actual event).
        unpadded_start = ev.get("unpadded_start", ev["start"])
        unpadded_end = ev.get("unpadded_end", ev["end"])

        event_frame_mask = [
            (unpadded_start <= t <= unpadded_end)
            for t in timestamps
        ]
        event_frame_indices = [fi for fi, m in zip(frame_indices, event_frame_mask) if m]
        event_s_finals = [s for s, m in zip(s_finals, event_frame_mask) if m]
        event_s_evs = [s for s, m in zip(s_evidences, event_frame_mask) if m]
        event_qs = [q for q, m in zip(q_observabilities, event_frame_mask) if m]
        event_cam_motions = [c for c, m in zip(possible_camera_motions, event_frame_mask) if m]
        event_jerks = (
            [j for j, m in zip(jerk_scores, event_frame_mask) if m]
            if jerk_scores is not None else []
        )

        if not event_s_finals:
            continue

        cam_motion_count = sum(event_cam_motions)
        cam_motion_pct = cam_motion_count / len(event_cam_motions) if event_cam_motions else 0.0

        # Primary label: if >50% of frames have camera_motion, label as
        # camera_motion. If <10%, label as real_motion. Otherwise mixed.
        if cam_motion_pct >= 0.5:
            primary_label = "camera_motion"
        elif cam_motion_pct < 0.10:
            primary_label = "real_motion"
        else:
            primary_label = "mixed"

        # ROI summary (if ROIs provided).
        roi_summary = None
        roi_bbox = None
        if rois_by_frame is not None:
            event_rois = []
            for fi in event_frame_indices:
                event_rois.extend(rois_by_frame.get(fi, []))
            if event_rois:
                areas = [r.get("area", 0) for r in event_rois]
                roi_summary = {
                    "total_roi_count": len(event_rois),
                    "distinct_frame_count": len(set(event_frame_indices)),
                    "total_area_px": sum(areas),
                    "peak_area_px": max(areas) if areas else 0,
                    "mean_area_px": int(np.mean(areas)) if areas else 0,
                }
                # Single representative bbox for the event — the union of
                # every ROI seen during it — for consumers (Module 8/9,
                # the API/DB contract) that expect one box per event
                # rather than the full per-frame ROI list.
                roi_bbox = [
                    min(r["bbox_x1"] for r in event_rois),
                    min(r["bbox_y1"] for r in event_rois),
                    max(r["bbox_x2"] for r in event_rois),
                    max(r["bbox_y2"] for r in event_rois),
                ]

        peak_jerk_score = round(max(event_jerks), 4) if event_jerks else 0.0
        mean_jerk_score = round(float(np.mean(event_jerks)), 4) if event_jerks else 0.0
        motion_character = "sudden" if peak_jerk_score >= jerk_sudden_thresh else "gradual"

        enriched_ev = {
            **ev,
            "frame_count": len(event_s_finals),
            "peak_s_final": round(max(event_s_finals), 4),
            "mean_s_final": round(float(np.mean(event_s_finals)), 4),
            "min_s_final": round(min(event_s_finals), 4),
            "peak_s_evidence": round(max(event_s_evs), 4),
            "mean_q_observability": round(float(np.mean(event_qs)), 4),
            "camera_motion_frame_count": cam_motion_count,
            "camera_motion_pct": round(cam_motion_pct, 4),
            "primary_label": primary_label,
            "peak_jerk_score": peak_jerk_score,
            "mean_jerk_score": mean_jerk_score,
            "motion_character": motion_character,
            "roi": roi_bbox,
            "roi_summary": roi_summary,
            "status": "unreviewed",
        }
        enriched.append(enriched_ev)

    # Assign event_id (1-indexed for human readability).
    for i, ev in enumerate(enriched):
        ev["event_id"] = i + 1

    return enriched


# ============================================================
# Motion heatmap (optional, requires masks-dir + frames-dir)
# ============================================================

def generate_heatmap(
    masks_dir: str,
    frames_dir: str,
    out_path: str,
    alpha: float = 0.55,
) -> Optional[str]:
    """
    Accumulate every cleaned motion mask (Module 4 output) across the
    whole video into one heatmap, colorize it, and overlay it on a
    representative frame (the chronological midpoint) so investigators
    get a single image showing where activity concentrated overall.
    Returns the written path, or None if no masks/frames were found.
    """
    mask_files = sorted(Path(masks_dir).glob("mask_f*.png"))
    if not mask_files:
        return None

    accum = None
    for mf in mask_files:
        m = cv2.imread(str(mf), cv2.IMREAD_GRAYSCALE)
        if m is None:
            continue
        if accum is None:
            accum = np.zeros(m.shape, dtype=np.float64)
        accum += (m > 0).astype(np.float64)

    if accum is None or accum.max() <= 0:
        return None

    norm = (accum / accum.max() * 255).astype(np.uint8)
    colored = cv2.applyColorMap(norm, cv2.COLORMAP_JET)

    frame_files = sorted(Path(frames_dir).glob("*.jpg"))
    base = None
    if frame_files:
        base = cv2.imread(str(frame_files[len(frame_files) // 2]))
    if base is None:
        base = np.zeros_like(colored)
    if base.shape[:2] != colored.shape[:2]:
        colored = cv2.resize(colored, (base.shape[1], base.shape[0]))

    overlay = cv2.addWeighted(base, 1 - alpha, colored, alpha, 0)
    cv2.imwrite(str(out_path), overlay)
    return str(out_path)


# ============================================================
# Clip export (optional, requires ffmpeg)
# ============================================================

def export_clip(
    video_path: str,
    start_sec: float,
    end_sec: float,
    out_path: str,
    ffmpeg_bin: str = "ffmpeg",
) -> bool:
    """
    Export a subvideo from `video_path` covering [start_sec, end_sec].
    Uses ffmpeg with stream copy (no re-encoding) for speed.
    Returns True on success, False on failure.
    """
    duration = end_sec - start_sec
    if duration <= 0:
        return False

    cmd = [
        ffmpeg_bin,
        "-y",  # overwrite
        "-ss", f"{start_sec:.3f}",
        "-i", video_path,
        "-t", f"{duration:.3f}",
        "-c", "copy",  # stream copy, no re-encoding
        "-avoid_negative_ts", "make_zero",
        out_path,
    ]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, check=False,
        )
        return result.returncode == 0 and os.path.exists(out_path)
    except FileNotFoundError:
        print(f"[warn] ffmpeg not found at {ffmpeg_bin}, skipping clip export",
              file=sys.stderr)
        return False
    except Exception as e:
        print(f"[warn] clip export failed: {e}", file=sys.stderr)
        return False


# ============================================================
# Main runner
# ============================================================

def run(
    motion_csv: str,
    quality_csv: str,
    out_dir: str,
    rois_json: Optional[str] = None,
    header_json: Optional[str] = None,
    start_thresh: float = 0.20,
    continue_thresh: float = 0.10,
    min_duration: float = 1.5,
    merge_gap: float = 2.0,
    padding: float = 3.0,
    export_clips: bool = False,
    masks_dir: Optional[str] = None,
    frames_dir: Optional[str] = None,
    jerk_sudden_thresh: float = 0.6,
) -> dict:
    """
    Read motion.csv + quality.csv, compute S_final per frame, segment
    into events, write events.json + events.csv (+ optional clips/ and
    heatmap.png if masks_dir/frames_dir are given).
    """
    # ---- Load motion.csv (S_evidence) ----
    motion_rows = []
    with open(motion_csv) as f:
        for row in csv.DictReader(f):
            motion_rows.append(row)
    if not motion_rows:
        raise RuntimeError(f"motion.csv is empty: {motion_csv}")

    # ---- Load quality.csv (Q_observability + camera_motion flags) ----
    quality_by_idx = {}
    with open(quality_csv) as f:
        for row in csv.DictReader(f):
            quality_by_idx[int(row["frame_idx"])] = row

    # ---- Build aligned per-frame arrays ----
    frame_indices = [int(r["frame_idx"]) for r in motion_rows]
    timestamps = [float(r["timestamp_sec"]) for r in motion_rows]
    s_evidences = [float(r["score"]) for r in motion_rows]

    # jerk_score (temporal spectral-residual saliency) is optional — only
    # present in motion.csv files produced after that feature was added.
    has_jerk = "jerk_score" in motion_rows[0]
    jerk_scores = [float(r["jerk_score"]) for r in motion_rows] if has_jerk else None

    s_finals = []
    q_observabilities = []
    possible_camera_motions = []
    missing_quality = 0
    for i, fi in enumerate(frame_indices):
        if fi in quality_by_idx:
            q = quality_by_idx[fi]
            q_obs = float(q["q_observability"])
            cam_motion = int(q["possible_camera_motion"])
        else:
            # No quality data for this frame — assume Q=1.0 (no penalty)
            # and no camera motion. Shouldn't happen if pipeline ran in order.
            q_obs = 1.0
            cam_motion = 0
            missing_quality += 1
        q_observabilities.append(q_obs)
        possible_camera_motions.append(cam_motion)
        s_finals.append(q_obs * s_evidences[i])

    if missing_quality > 0:
        print(f"[warn] {missing_quality}/{len(frame_indices)} frames missing "
              f"from quality.csv — assumed Q=1.0 for those frames.",
              file=sys.stderr)

    # ---- Load ROIs (optional) ----
    rois_by_frame = None
    if rois_json and os.path.isfile(rois_json):
        with open(rois_json) as f:
            rois_data = json.load(f)
        rois_by_frame = {
            fe["frame_idx"]: fe.get("rois", [])
            for fe in rois_data.get("frames", [])
        }

    # ---- Load header (optional, for clip export + duration sanity) ----
    header = None
    if header_json and os.path.isfile(header_json):
        with open(header_json) as f:
            header = json.load(f)

    # ---- Segment ----
    t0 = time.time()
    events = segment_events(
        timestamps=timestamps,
        scores=s_finals,
        start_thresh=start_thresh,
        continue_thresh=continue_thresh,
        min_duration=min_duration,
        merge_gap=merge_gap,
        padding=padding,
    )

    # ---- Enrich with metadata ----
    events = enrich_events(
        events=events,
        timestamps=timestamps,
        s_finals=s_finals,
        s_evidences=s_evidences,
        q_observabilities=q_observabilities,
        possible_camera_motions=possible_camera_motions,
        frame_indices=frame_indices,
        rois_by_frame=rois_by_frame,
        jerk_scores=jerk_scores,
        jerk_sudden_thresh=jerk_sudden_thresh,
    )

    segmentation_elapsed = time.time() - t0

    # ---- Export clips (optional) ----
    clips_dir = None
    clips_exported = 0
    if export_clips:
        if not header or "video_path" not in header:
            print("[warn] --export-clips requires header.json with video_path, skipping",
                  file=sys.stderr)
        else:
            clips_dir = Path(out_dir) / "clips"
            clips_dir.mkdir(parents=True, exist_ok=True)
            video_path = header["video_path"]
            video_id = header.get("video_id", "video")
            for ev in events:
                # short_motion records are sub-min_duration bursts kept for
                # visibility, not full reviewable events — no clip for them.
                if ev.get("event_type") == "short_motion":
                    ev["clip_path"] = None
                    continue
                clip_name = f"{video_id}_event{ev['event_id']:02d}_{ev['start']:.2f}s-{ev['end']:.2f}s.mp4"
                clip_path = clips_dir / clip_name
                ok = export_clip(video_path, ev["start"], ev["end"], str(clip_path))
                if ok:
                    ev["clip_path"] = str(clip_path)
                    clips_exported += 1
                else:
                    ev["clip_path"] = None

    # ---- Write events.json ----
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    json_path = out_path / "events.json"
    csv_path = out_path / "events.csv"

    # ---- Generate motion heatmap (optional) ----
    heatmap_path = None
    if masks_dir and frames_dir and os.path.isdir(masks_dir) and os.path.isdir(frames_dir):
        heatmap_path = generate_heatmap(masks_dir, frames_dir, str(out_path / "heatmap.png"))
        if heatmap_path is None:
            print("[warn] heatmap generation found no masks/frames, skipping",
                  file=sys.stderr)

    json_payload = {
        "video_id": header.get("video_id") if header else None,
        "video_path": header.get("video_path") if header else None,
        "video_duration_sec": header.get("duration_sec") if header else (timestamps[-1] if timestamps else None),
        "params": {
            "start_thresh": start_thresh,
            "continue_thresh": continue_thresh,
            "min_duration": min_duration,
            "merge_gap": merge_gap,
            "padding": padding,
        },
        "frame_count": len(frame_indices),
        "event_count": len(events),
        "events": events,
    }
    with open(json_path, "w") as f:
        json.dump(json_payload, f, indent=2)

    # ---- Write events.csv (one row per event, flattened) ----
    if events:
        # Flatten nested roi_summary for CSV.
        csv_rows = []
        for ev in events:
            row = {k: v for k, v in ev.items() if k != "roi_summary"}
            rs = ev.get("roi_summary") or {}
            for k, v in rs.items():
                row[f"roi_{k}"] = v
            csv_rows.append(row)
        fieldnames = list(csv_rows[0].keys())
        with open(csv_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(csv_rows)
    else:
        # Empty CSV with just the header column.
        with open(csv_path, "w", newline="") as f:
            f.write("event_id,start,end,duration,primary_label\n")

    elapsed = time.time() - t0

    # ---- Summary ----
    label_counts = {}
    motion_character_counts = {}
    for ev in events:
        lbl = ev["primary_label"]
        label_counts[lbl] = label_counts.get(lbl, 0) + 1
        mc = ev.get("motion_character")
        if mc:
            motion_character_counts[mc] = motion_character_counts.get(mc, 0) + 1

    summary = {
        "video_id": header.get("video_id") if header else None,
        "frames_processed": len(frame_indices),
        "event_count": len(events),
        "events_by_label": label_counts,
        "events_by_motion_character": motion_character_counts,
        "jerk_available": jerk_scores is not None,
        "segmentation_elapsed_sec": round(segmentation_elapsed, 3),
        "total_elapsed_sec": round(elapsed, 3),
        "params": json_payload["params"],
        "clips_exported": clips_exported,
        "clips_dir": str(clips_dir) if clips_dir else None,
        "out_json": str(json_path),
        "out_csv": str(csv_path),
        "heatmap_path": heatmap_path,
    }
    return summary


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="ExamVision Module 7: temporal event segmentation."
    )
    parser.add_argument(
        "--motion-csv", required=True,
        help="motion.csv from Module 3 (provides S_evidence)."
    )
    parser.add_argument(
        "--quality-csv", required=True,
        help="quality.csv from Module 6 (provides Q_observability + camera_motion)."
    )
    parser.add_argument(
        "--rois-json", default=None,
        help="Optional: rois_per_frame.json from Module 5 (for ROI summary per event)."
    )
    parser.add_argument(
        "--header", default=None,
        help="Optional: header.json from Module 1 (for video_path, needed by --export-clips)."
    )
    parser.add_argument(
        "--out-dir", required=True,
        help="Output directory for events.json + events.csv (+ clips/)."
    )
    parser.add_argument("--start-thresh", type=float, default=0.20,
                        help="S_final threshold to START an event (default 0.20).")
    parser.add_argument("--continue-thresh", type=float, default=0.10,
                        help="S_final threshold to CONTINUE an event (default 0.10). "
                             "Must be <= start_thresh (hysteresis).")
    parser.add_argument("--min-duration", type=float, default=1.5,
                        help="Drop events shorter than this (default 1.5s).")
    parser.add_argument("--merge-gap", type=float, default=2.0,
                        help="Merge events with a gap <= this (default 2.0s).")
    parser.add_argument("--padding", type=float, default=3.0,
                        help="Padding on each side of event (default 3.0s, clipped to video bounds).")
    parser.add_argument("--export-clips", action="store_true",
                        help="Export a subvideo clip per event (requires ffmpeg + --header).")
    parser.add_argument(
        "--masks-dir", default=None,
        help="Optional: cleaned_masks/ dir from Module 4 (enables heatmap.png generation, needs --frames-dir too)."
    )
    parser.add_argument(
        "--frames-dir", default=None,
        help="Optional: frames/ dir from Module 2 (enables heatmap.png generation, needs --masks-dir too)."
    )
    parser.add_argument("--jerk-sudden-thresh", type=float, default=0.6,
                        help="peak_jerk_score threshold above which an event is tagged "
                             "motion_character='sudden' instead of 'gradual' (default 0.6). "
                             "No effect if motion.csv has no jerk_score column.")
    args = parser.parse_args()

    if args.start_thresh < args.continue_thresh:
        parser.error(f"start_thresh ({args.start_thresh}) must be >= "
                     f"continue_thresh ({args.continue_thresh})")

    summary = run(
        motion_csv=args.motion_csv,
        quality_csv=args.quality_csv,
        out_dir=args.out_dir,
        rois_json=args.rois_json,
        header_json=args.header,
        start_thresh=args.start_thresh,
        continue_thresh=args.continue_thresh,
        min_duration=args.min_duration,
        merge_gap=args.merge_gap,
        padding=args.padding,
        export_clips=args.export_clips,
        masks_dir=args.masks_dir,
        frames_dir=args.frames_dir,
        jerk_sudden_thresh=args.jerk_sudden_thresh,
    )

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
