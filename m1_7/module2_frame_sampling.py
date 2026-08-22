"""
ExamVision — Module 2: Frame Sampling
=====================================
Reduces the native frame stream (25-30 fps) to a sparser stream of
frames tagged with their real-world timestamps. All downstream motion /
ROI modules operate on this reduced stream.

Why sample?
  - In an exam hall, nothing meaningful changes in <100ms.
  - 5-10 fps is enough to catch a hand reaching for a phone.
  - Cuts compute 3-6x versus native fps.

Strategy:
  - Reads fps/frame_count from Module 1's JSON header (so it stays
    consistent with whatever Module 1 decided was the trusted source).
  - Sequential read + skip when stride is small (dense sampling).
  - Seek via CAP_PROP_POS_FRAMES when stride is large (sparse sampling)
    — avoids decoding frames we'll throw away.
  - Validates each sampled frame (non-empty, correct shape) before
    yielding, to skip end-of-file garbage frames that OpenCV sometimes
    returns on truncated MP4s.

Usage:
  As a library:
      from module2_frame_sampling import sample_frames
      for frame_idx, ts, frame in sample_frames("header.json"):
          ...

  As a CLI (writes frames to disk for downstream modules to read):
      python module2_frame_sampling.py header.json --out-dir frames/
      python module2_frame_sampling.py header.json --target-fps 8
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Iterator, Tuple, Optional

import cv2
import numpy as np


# ---------- sampling core ----------

def sample_frames(
    header: dict,
    target_fps: float = 5.0,
    use_seek_threshold: int = 10,
) -> Iterator[Tuple[int, float, np.ndarray]]:
    """
    Yield (frame_idx, timestamp_sec, frame_bgr) tuples from the video
    described by `header`, at approximately `target_fps`.

    Parameters
    ----------
    header : dict
        The metadata header produced by Module 1. Must contain at least:
          - video_path
          - fps
          - frame_count
    target_fps : float
        Desired output frame rate. Default 5 fps (good for exam-hall footage).
    use_seek_threshold : int
        If the computed stride exceeds this value, switch from sequential
        read+skip to CAP_PROP_POS_FRAMES seeking (faster for sparse sampling).
        Default 10. Set to a very large number to force sequential mode.

    Yields
    ------
    (frame_idx, timestamp_sec, frame_bgr) : tuple
        frame_idx   — index in the native frame stream (0-based)
        timestamp   — wall-clock seconds from the start of the video
        frame_bgr   — HxWx3 uint8 BGR image (OpenCV convention)
    """
    video_path = header["video_path"]
    native_fps = float(header["fps"])
    native_frame_count = int(header["frame_count"])

    if native_fps <= 0:
        raise ValueError(f"Header has invalid fps={native_fps}; cannot sample.")
    if target_fps <= 0:
        raise ValueError(f"target_fps must be > 0, got {target_fps}")
    if target_fps > native_fps:
        print(
            f"[warn] target_fps={target_fps} > native_fps={native_fps}; "
            f"capping to native rate (no upsampling).",
            file=sys.stderr,
        )
        target_fps = native_fps

    stride = max(1, round(native_fps / target_fps))
    use_seek = stride >= use_seek_threshold
    expected_sample_count = max(1, native_frame_count // stride)

    # Frame indices we *want* to sample.
    target_indices = range(0, native_frame_count, stride)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"OpenCV could not open video: {video_path}")

    yielded = 0
    try:
        if use_seek:
            # Sparse sampling: jump directly to each target frame.
            # Faster when stride is large (avoids decoding skipped frames).
            for frame_idx in target_indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
                ret, frame = cap.read()
                if not ret or not _is_valid_frame(frame):
                    continue
                # Re-derive timestamp from index (not from POS_MSEC, which is
                # sometimes unreliable on VFR video).
                timestamp = frame_idx / native_fps
                yield frame_idx, timestamp, frame
                yielded += 1
        else:
            # Dense sampling: sequential read + skip. Faster when stride is
            # small because seeking has keyframe-decode overhead.
            frame_idx = 0
            next_target = 0
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                if frame_idx == next_target:
                    if _is_valid_frame(frame):
                        timestamp = frame_idx / native_fps
                        yield frame_idx, timestamp, frame
                        yielded += 1
                    next_target += stride
                frame_idx += 1
                if frame_idx >= native_frame_count:
                    break
    finally:
        cap.release()

    if yielded == 0:
        raise RuntimeError(
            f"No valid frames sampled from {video_path}. "
            f"Video may be corrupted or in an unsupported codec."
        )
    if yielded < expected_sample_count * 0.9:
        print(
            f"[warn] Sampled {yielded} frames, expected ~{expected_sample_count}. "
            f"Video may be truncated or contain unreadable frames.",
            file=sys.stderr,
        )


def _is_valid_frame(frame: Optional[np.ndarray]) -> bool:
    """A frame is valid if it exists, has 3 channels, and isn't all zeros."""
    if frame is None:
        return False
    if frame.size == 0:
        return False
    if frame.ndim != 3 or frame.shape[2] != 3:
        return False
    # All-zero frames are what OpenCV sometimes returns on read errors.
    if not frame.any():
        return False
    return True


# ---------- high-level runner ----------

def run_sampling(
    header_path: str,
    target_fps: float = 5.0,
    out_dir: Optional[str] = None,
    save_jpg_quality: int = 90,
    save_manifest: bool = True,
) -> dict:
    """
    Run frame sampling end-to-end. Optionally writes each sampled frame
    as a JPG to `out_dir` and a manifest.json listing all sampled frames.

    Returns a summary dict with sampling statistics.
    """
    with open(header_path) as f:
        header = json.load(f)

    video_id = header.get("video_id", "video")
    native_fps = float(header["fps"])
    native_frame_count = int(header["frame_count"])

    stride = max(1, round(native_fps / target_fps))
    expected = max(1, native_frame_count // stride)

    if out_dir:
        out_path = Path(out_dir)
        out_path.mkdir(parents=True, exist_ok=True)
        manifest_entries = []
    else:
        out_path = None
        manifest_entries = None

    sampled = 0
    for frame_idx, ts, frame in sample_frames(header, target_fps=target_fps):
        if out_path:
            jpg_name = f"{video_id}__f{frame_idx:07d}__t{ts:08.3f}.jpg"
            jpg_path = out_path / jpg_name
            cv2.imwrite(str(jpg_path), frame,
                        [int(cv2.IMWRITE_JPEG_QUALITY), save_jpg_quality])
            manifest_entries.append({
                "frame_idx": frame_idx,
                "timestamp_sec": round(ts, 4),
                "file": jpg_name,
            })
        sampled += 1

    summary = {
        "video_id": video_id,
        "target_fps": target_fps,
        "native_fps": native_fps,
        "stride": stride,
        "expected_sampled": expected,
        "actual_sampled": sampled,
        "out_dir": str(out_path) if out_path else None,
    }

    if out_path and save_manifest:
        manifest_path = out_path / "manifest.json"
        with open(manifest_path, "w") as f:
            json.dump({
                "header": header,
                "summary": summary,
                "frames": manifest_entries,
            }, f, indent=2)

    return summary


# ---------- CLI ----------

def main():
    parser = argparse.ArgumentParser(
        description="ExamVision Module 2: sample frames from a video at "
                    "a reduced fps, using the metadata header from Module 1."
    )
    parser.add_argument(
        "header",
        help="Path to the JSON header produced by Module 1."
    )
    parser.add_argument(
        "--target-fps", type=float, default=5.0,
        help="Desired output fps. Default 5.0."
    )
    parser.add_argument(
        "--out-dir", default=None,
        help="Directory to write sampled JPGs + manifest.json. "
             "If omitted, only prints summary stats."
    )
    parser.add_argument(
        "--jpg-quality", type=int, default=90,
        help="JPEG quality for saved frames (1-100). Default 90."
    )
    args = parser.parse_args()

    summary = run_sampling(
        header_path=args.header,
        target_fps=args.target_fps,
        out_dir=args.out_dir,
        save_jpg_quality=args.jpg_quality,
    )

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
