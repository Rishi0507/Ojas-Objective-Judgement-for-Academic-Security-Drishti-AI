"""
ExamVision — Module 1: Metadata Extraction
==========================================
Reads a video file and produces a JSON "header" with the technical
properties that every downstream module (frame sampling, motion detection,
ROI extraction, timestamps) references.

Strategy:
  - OpenCV for width / height (always reliable).
  - ffprobe for fps / duration / codec (more reliable than OpenCV on VFR
    video and modern codecs like HEVC/AV1).
  - Cross-check: if OpenCV and ffprobe disagree by >2% on frame_count or
    duration, trust ffprobe and emit a `metadata_warning` field so the
    pipeline knows downstream timestamps may be slightly off.

Usage:
    python module1_metadata.py path/to/video.mp4
    python module1_metadata.py path/to/video.mp4 --out header.json
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import cv2


# ---------- ffprobe helpers ----------

def _ffprobe_available() -> bool:
    """Check whether ffprobe is installed and on PATH."""
    try:
        subprocess.run(
            ["ffprobe", "-version"],
            capture_output=True, check=True,
        )
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def _ffprobe_json(video_path: str) -> dict:
    """
    Run ffprobe once and return the parsed JSON.
    Returns {} if ffprobe is missing or the file is unreadable.
    """
    if not _ffprobe_available():
        return {}
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-print_format", "json",
                "-show_format", "-show_streams",
                video_path,
            ],
            capture_output=True, text=True, check=True,
        )
        return json.loads(result.stdout)
    except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
        print(f"[warn] ffprobe failed on {video_path}: {e}", file=sys.stderr)
        return {}


def _pick_video_stream(probe: dict) -> dict:
    """From ffprobe output, return the first stream with codec_type=video."""
    for s in probe.get("streams", []):
        if s.get("codec_type") == "video":
            return s
    return {}


# ---------- OpenCV helpers ----------

def _opencv_metadata(video_path: str) -> dict:
    """
    Open the file with OpenCV and read the four basic properties.
    Never raises — returns 0/empty for any property that fails.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(
            f"OpenCV could not open video: {video_path}. "
            "Check the path, codec support, or rebuild OpenCV with ffmpeg."
        )
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        # fourcc — OpenCV returns an int; convert to 4-char string when possible.
        fourcc_int = int(cap.get(cv2.CAP_PROP_FOURCC) or 0)
        fourcc = "".join([chr((fourcc_int >> 8 * i) & 0xFF) for i in range(4)]).strip()
    finally:
        cap.release()

    return {
        "fps": fps,
        "frame_count": frame_count,
        "width": width,
        "height": height,
        "fourcc": fourcc,
    }


# ---------- main entry point ----------

def extract_metadata(video_path: str) -> dict:
    """
    Extract robust video metadata.

    Returns a dict suitable for JSON serialization. Includes a
    `metadata_warning` field if OpenCV and ffprobe disagree enough to
    affect downstream timestamps.
    """
    if not os.path.isfile(video_path):
        raise FileNotFoundError(f"Video not found: {video_path}")

    cv_meta = _opencv_metadata(video_path)
    probe = _ffprobe_json(video_path)
    vstream = _pick_video_stream(probe)
    fmt = probe.get("format", {})

    # ---- fps ----
    # ffprobe gives avg_frame_rate as a fraction string like "25/1".
    ff_fps = 0.0
    if "avg_frame_rate" in vstream:
        num, _, den = vstream["avg_frame_rate"].partition("/")
        try:
            den_f = float(den) if den else 1.0
            ff_fps = float(num) / den_f if den_f > 0 else 0.0
        except ValueError:
            ff_fps = 0.0

    # Prefer ffprobe, fall back to OpenCV if ffprobe returned 0.
    fps = ff_fps or cv_meta["fps"]

    # ---- duration ----
    ff_duration = 0.0
    try:
        ff_duration = float(fmt.get("duration", 0.0))
    except (TypeError, ValueError):
        ff_duration = 0.0

    cv_duration = (
        cv_meta["frame_count"] / fps
        if fps > 0 and cv_meta["frame_count"] > 0 else 0.0
    )

    # Prefer ffprobe duration; fall back to OpenCV-derived duration.
    duration_sec = ff_duration or cv_duration

    # ---- frame count ----
    # Re-derive from duration * fps for stability on VFR video.
    derived_frame_count = int(round(duration_sec * fps)) if fps > 0 else 0
    cv_frame_count = cv_meta["frame_count"]
    ff_frame_count = int(vstream.get("nb_frames", 0) or 0)

    # Trust ffprobe > derived > OpenCV.
    if ff_frame_count > 0:
        frame_count = ff_frame_count
    elif derived_frame_count > 0:
        frame_count = derived_frame_count
    else:
        frame_count = cv_frame_count

    # ---- codec ----
    codec = vstream.get("codec_name", "") or cv_meta["fourcc"] or "unknown"

    # ---- disagreement check ----
    warnings = []
    if fps > 0 and cv_meta["fps"] > 0 and abs(fps - cv_meta["fps"]) / cv_meta["fps"] > 0.02:
        warnings.append(
            f"fps mismatch: opencv={cv_meta['fps']:.4f} ffprobe={ff_fps:.4f} -> using {fps:.4f}"
        )
    if (cv_duration > 0 and ff_duration > 0
            and abs(cv_duration - ff_duration) / max(cv_duration, ff_duration) > 0.02):
        warnings.append(
            f"duration mismatch: opencv={cv_duration:.2f}s ffprobe={ff_duration:.2f}s "
            f"-> using {duration_sec:.2f}s"
        )

    # ---- final header ----
    return {
        "video_id": Path(video_path).name,
        "video_path": os.path.abspath(video_path),
        "fps": round(fps, 4),
        "frame_count": frame_count,
        "width": cv_meta["width"],
        "height": cv_meta["height"],
        "duration_sec": round(duration_sec, 4),
        "codec": codec,
        "fourcc": cv_meta["fourcc"],
        "source": "opencv+ffprobe" if probe else "opencv-only",
        "metadata_warning": "; ".join(warnings) if warnings else None,
    }


# ---------- CLI ----------

def main():
    parser = argparse.ArgumentParser(
        description="ExamVision Module 1: extract video metadata to JSON."
    )
    parser.add_argument("video", help="Path to the input video file.")
    parser.add_argument(
        "--out", "-o", default=None,
        help="Output JSON path. If omitted, prints JSON to stdout.",
    )
    args = parser.parse_args()

    meta = extract_metadata(args.video)

    pretty = json.dumps(meta, indent=2)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(pretty)
        print(f"[ok] wrote metadata to {args.out}", file=sys.stderr)
    else:
        print(pretty)


if __name__ == "__main__":
    main()
