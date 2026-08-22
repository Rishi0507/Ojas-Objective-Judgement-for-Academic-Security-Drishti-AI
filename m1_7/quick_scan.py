#!/usr/bin/env python3
"""
Adaptive coarse-to-fine processing (feature 10.5)
=================================================

Running full-detail analysis over every second of a long recording spends most
of its time proving that nothing happened. This is the cheap first pass: scan
the whole video at a low frame rate and reduced resolution using frame
differencing only, and report the windows worth looking at properly.

Two-pass model
--------------
  Pass 1 (this script)  ~1fps, half resolution, frame-diff only.
                        Output: candidate windows, padded.
  Pass 2 (run_pipeline) full Modules 1-9, but only on those windows.

The point is the ratio: pass 1 touches roughly 1/25th of the frames at 1/4 the
pixels, so it costs a small fraction of a full run, and pass 2 then runs only
where something moved. On mostly-idle CCTV that is a large saving; on
continuously busy footage it degrades to "full run plus a cheap scan", which
is the honest worst case rather than a hidden one.

This is deliberately standalone and additive: run_pipeline.py is unmodified and
still processes whole videos exactly as before. Use this to decide *what* to
feed it.

How this differs from Module 2's downscaling
--------------------------------------------
Module 2's --max-width is a uniform cut applied everywhere. This is selective:
it spends nothing on quiet stretches and full detail on active ones. They
compose — pass 2 still benefits from Module 2's downscaling.

Usage
-----
    python quick_scan.py video.mp4
    python quick_scan.py video.mp4 --sample-fps 1 --scale 0.5 --json windows.json

    # then, per reported window:
    python run_pipeline.py video.mp4 --out-dir out/w0 --clip-start 12 --clip-end 40
    # (or trim the clip first with ffmpeg -ss/-to and run the pipeline on it)
"""

import argparse
import json
import sys

import cv2
import numpy as np

# How "active" is decided.
#
# An absolute activity threshold does not transfer between cameras — the same
# 0.02 that isolates events in one hall flags 100% of another, because baseline
# frame-diff depends on sensor noise, lighting and how far the camera sits from
# the subjects. (Measured: two clips here had median activity 0.005 and 0.035.)
# This is the same problem Module 10 identifies for motion thresholds, so the
# same answer applies: calibrate against the video's own distribution.
#
# By default the threshold is the Nth percentile of this video's activity,
# floored by an absolute minimum. The floor is what stops a genuinely idle
# recording from flagging its own sensor noise as events — without it, a
# percentile always marks some fraction active no matter how still the footage.
# Pass --motion-thresh to override with a fixed value.
DEFAULT_AUTO_PERCENTILE = 75.0
DEFAULT_MIN_ACTIVITY = 0.02

# Kept permissive by design: this pass decides only what pass 2 should LOOK at,
# so a false positive costs some compute while a false negative loses the event
# entirely. Recall matters far more than precision here.

# Pixel-level difference needed before a pixel counts as changed. Filters
# sensor noise and compression shimmer in dim CCTV.
PIXEL_DELTA_THRESH = 25

# Seconds of padding added to each side of a detected window, so pass 2 sees
# the run-up and follow-through rather than starting mid-movement.
DEFAULT_PADDING = 5.0

# Windows closer together than this are merged — two bursts three seconds apart
# are one incident, and cutting between them would split an event across clips.
DEFAULT_MERGE_GAP = 3.0


def quick_scan(video_path: str, sample_fps: float = 1.0, scale: float = 0.5) -> dict:
    """
    Pass 1: cheap whole-video motion scan.

    Returns per-sample activity scores plus the video's basic timing. Deciding
    which samples count as active is left to resolve_threshold/mark_active, so
    thresholds can be retuned without re-decoding the video.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")

    try:
        native_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if native_fps <= 0:
            raise RuntimeError("Video reports no frame rate; cannot scan")

        stride = max(1, int(round(native_fps / max(sample_fps, 0.01))))
        duration = frame_count / native_fps if frame_count else 0.0

        samples = []
        prev = None
        idx = 0

        while True:
            ok = cap.grab()          # grab() skips decode for frames we drop,
            if not ok:               # which is most of them
                break
            if idx % stride == 0:
                ok, frame = cap.retrieve()
                if not ok:
                    break
                small = cv2.resize(frame, (0, 0), fx=scale, fy=scale,
                                   interpolation=cv2.INTER_AREA)
                gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
                if prev is not None:
                    delta = cv2.absdiff(gray, prev)
                    changed = np.count_nonzero(delta > PIXEL_DELTA_THRESH)
                    activity = changed / float(delta.size)
                    samples.append({
                        "frame_idx": idx,
                        "timestamp_sec": round(idx / native_fps, 3),
                        "activity": round(float(activity), 6),
                    })
                prev = gray
            idx += 1
    finally:
        cap.release()

    return {
        "video_path": video_path,
        "native_fps": round(native_fps, 4),
        "frame_count": frame_count,
        "duration_sec": round(duration, 3),
        "sample_fps": sample_fps,
        "scale": scale,
        "stride": stride,
        "samples": samples,
    }


def resolve_threshold(scan: dict, motion_thresh=None,
                      auto_percentile: float = DEFAULT_AUTO_PERCENTILE,
                      min_activity: float = DEFAULT_MIN_ACTIVITY) -> dict:
    """
    Decide the activity threshold for this specific video.

    An explicit --motion-thresh always wins. Otherwise the threshold is the
    requested percentile of this video's own activity, floored at
    min_activity. Returns the value together with how it was chosen, so the
    output can show its working rather than presenting a bare number.
    """
    activities = [s["activity"] for s in scan.get("samples", [])]
    if motion_thresh is not None:
        return {"value": float(motion_thresh), "source": "explicit"}
    if not activities:
        return {"value": float(min_activity), "source": "floor (no samples)"}

    pct = float(np.percentile(np.asarray(activities, dtype=float), auto_percentile))
    if pct <= min_activity:
        return {
            "value": float(min_activity),
            "source": f"floor (p{auto_percentile:g}={pct:.4f} below minimum)",
        }
    return {"value": pct, "source": f"p{auto_percentile:g} of this video"}


def mark_active(scan: dict, threshold: float) -> None:
    """Tags each sample active/inactive in place, against a resolved threshold."""
    for s in scan.get("samples", []):
        s["active"] = bool(s["activity"] >= threshold)


def to_windows(scan: dict, padding: float = DEFAULT_PADDING,
               merge_gap: float = DEFAULT_MERGE_GAP,
               min_duration: float = 1.0) -> list:
    """
    Turn active samples into padded, merged windows for pass 2.

    Padding is applied before merging so that two bursts whose padded regions
    touch become one window — merging first would leave a gap that padding then
    straddles, producing overlapping clips.
    """
    duration = scan.get("duration_sec", 0.0)
    active = [s for s in scan.get("samples", []) if s["active"]]
    if not active:
        return []

    raw = []
    for s in active:
        start = max(0.0, s["timestamp_sec"] - padding)
        end = s["timestamp_sec"] + padding
        if duration:
            end = min(end, duration)
        raw.append([start, end])

    raw.sort(key=lambda w: w[0])
    merged = [raw[0]]
    for start, end in raw[1:]:
        if start - merged[-1][1] <= merge_gap:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])

    windows = []
    for i, (start, end) in enumerate(merged):
        if end - start < min_duration:
            continue
        peak = max(
            (s["activity"] for s in active if start <= s["timestamp_sec"] <= end),
            default=0.0,
        )
        windows.append({
            "window_id": f"W{i:02d}",
            "start": round(start, 3),
            "end": round(end, 3),
            "duration": round(end - start, 3),
            "peak_activity": round(peak, 6),
        })
    return windows


def main():
    parser = argparse.ArgumentParser(
        description="Pass 1 of adaptive coarse-to-fine processing: find windows worth full analysis."
    )
    parser.add_argument("video", help="Path to the input video.")
    parser.add_argument("--sample-fps", type=float, default=1.0,
                        help="Coarse sampling rate in fps (default 1.0).")
    parser.add_argument("--scale", type=float, default=0.5,
                        help="Resolution scale for the coarse pass (default 0.5).")
    parser.add_argument("--motion-thresh", type=float, default=None,
                        help="Fixed activity fraction counting as motion. Omit to "
                             "calibrate against this video's own distribution.")
    parser.add_argument("--auto-percentile", type=float, default=DEFAULT_AUTO_PERCENTILE,
                        help=f"Percentile used when --motion-thresh is omitted (default {DEFAULT_AUTO_PERCENTILE:g}).")
    parser.add_argument("--min-activity", type=float, default=DEFAULT_MIN_ACTIVITY,
                        help=f"Absolute floor for the auto threshold (default {DEFAULT_MIN_ACTIVITY}).")
    parser.add_argument("--padding", type=float, default=DEFAULT_PADDING,
                        help=f"Seconds of padding per window (default {DEFAULT_PADDING}).")
    parser.add_argument("--merge-gap", type=float, default=DEFAULT_MERGE_GAP,
                        help=f"Merge windows closer than this many seconds (default {DEFAULT_MERGE_GAP}).")
    parser.add_argument("--json", default=None,
                        help="Write the full result to this path as JSON.")
    args = parser.parse_args()

    if not 0 < args.scale <= 1:
        parser.error("--scale must be in (0, 1]")

    try:
        scan = quick_scan(args.video, args.sample_fps, args.scale)
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1

    threshold = resolve_threshold(scan, args.motion_thresh,
                                  args.auto_percentile, args.min_activity)
    mark_active(scan, threshold["value"])
    windows = to_windows(scan, args.padding, args.merge_gap)
    covered = sum(w["duration"] for w in windows)
    duration = scan["duration_sec"] or 0.0

    result = {
        "video_path": scan["video_path"],
        "duration_sec": duration,
        "frames_sampled": len(scan["samples"]),
        "frames_total": scan["frame_count"],
        "motion_thresh": {
            "value": round(threshold["value"], 6),
            "chosen_by": threshold["source"],
        },
        "windows": windows,
        "coverage": {
            "seconds_flagged": round(covered, 3),
            "fraction_of_video": round(covered / duration, 4) if duration else 0.0,
            # What pass 2 avoids by only processing flagged windows.
            "estimated_work_saved": round(1 - (covered / duration), 4) if duration else 0.0,
        },
    }

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({**result, "samples": scan["samples"]}, f, indent=2)

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
