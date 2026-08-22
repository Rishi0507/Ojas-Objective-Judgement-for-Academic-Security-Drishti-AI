"""
ExamVision — Module 3: Motion Detection (3 methods + ensemble)
==============================================================
Combines three classical motion-detection methods into a single robust
per-frame motion score AND a combined motion mask for ROI extraction.

Methods:
  (a) Frame Differencing  — |I_t - I_{t-k}|  with k-frame buffer.
      Fast, catches sudden motion. Sensitive to lighting flicker.
  (b) Background Subtraction — MOG2 + KNN, both with shadow detection.
      Great for static-camera scenes (exam hall). Breaks on camera shake.
  (c) Optical Flow (Farneback, dense) — per-pixel motion vectors.
      Catches slow/subtle motion the others miss. Direction data reused
      in Module 6 (camera-shake detection).

Ensemble:
  Each method's output is min-max normalized PER VIDEO, then combined
  with weights w_diff + w_bg + w_flow = 1. Default 0.35 / 0.35 / 0.30.
  Per the spec: these are a starting guess — grid-search on dev/val later.

Outputs per frame:
  - motion_score_combined : float  (scalar, for ranking / timeline)
  - motion_score_diff, _bg, _flow : floats (per-method scores for debugging)
  - jerk_score : float  (0..1, temporal spectral-residual saliency — see below)
  - combined_mask : HxW uint8 (for Module 5 ROI extraction)
  - flow_field : HxWx2 float32 (for Module 6 camera-shake, optional)

Jerk score (temporal spectral-residual saliency)
--------------------------------------------------
A second, cheap pass over the *finished* per-video score signal (one FFT,
no extra frame reads): Hou & Zhang's Spectral Residual saliency ("Saliency
Detection: A Spectral Residual Approach," CVPR 2007) is normally applied
to a 2-D image spectrum; applied instead to the 1-D ensemble motion-score
time series, it's exactly the fast, unsupervised FFT pre-filter for
sudden/non-periodic motion described in the lit review (2.1.12a: Temporal
Spectral Residual / FFT motion saliency). Smooth or periodic motion
(walking, writing) is predictable in the spectrum and gets cancelled out
by the residual; abrupt, one-off jerks (grabbing something, a sudden head
turn) are not, and stand out. Purely additive metadata — see
`temporal_spectral_residual()` below; it does not change `score` or any
downstream hysteresis behavior in Module 7 unless explicitly consumed.

Usage as a library:
    detector = MotionDetector(header)
    for frame_idx, ts, frame in sample_frames(header):
        result = detector.process(frame_idx, ts, frame)
        # result.score, result.mask, result.flow, ...

Usage as a CLI:
    python module3_motion_detection.py manifest.json --out motion.csv
    python module3_motion_detection.py manifest.json --out motion.csv \\
        --save-masks masks/ --save-flow flow/
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
# The detector
# ============================================================

class MotionDetector:
    """
    Stateful motion detector. Instantiate once per video; call
    .process() once per sampled frame in temporal order.

    State kept across calls:
      - prev_grays: ring buffer of last k grayscale frames (for frame diff)
      - bg_mog2, bg_knn: persistent background subtractor models
      - per-method min/max accumulators for per-video normalization
    """

    def __init__(
        self,
        header: dict,
        diff_k: int = 2,
        diff_thresh: int = 25,
        min_area_px: int = 50,
        mog2_history: int = 500,
        mog2_var_threshold: int = 16,
        knn_history: int = 500,
        knn_dist2_threshold: int = 400,
        flow_enable: bool = True,
        flow_pyr_scale: float = 0.5,
        flow_levels: int = 3,
        flow_winsize: int = 15,
        flow_iterations: int = 3,
        flow_poly_n: int = 5,
        flow_poly_sigma: float = 1.2,
        w_diff: float = 0.35,
        w_bg: float = 0.35,
        w_flow: float = 0.30,
        warmup_frames: int = 10,
        motion_scale: float = 1.0,
    ):
        if abs(w_diff + w_bg + w_flow - 1.0) > 1e-3:
            raise ValueError(
                f"Ensemble weights must sum to 1.0; got "
                f"{w_diff + w_bg + w_flow:.4f}"
            )

        self.header = header
        self.width = int(header["width"])
        self.height = int(header["height"])
        self.diff_k = max(1, diff_k)
        self.diff_thresh = diff_thresh
        self.min_area_px = min_area_px

        # Speed/accuracy tradeoff knob, OFF by default (1.0 = full
        # resolution, original behavior). All three ensemble methods
        # (frame-diff, MOG2/KNN, and — the dominant cost, ~80% of Module 3's
        # time — Farneback optical flow, with its vectors correctly rescaled
        # back to full-res displacement units) can run on a downscaled copy
        # for speed; masks/flow fields are resized back up so every caller
        # downstream (Module 4/5/6) sees the same shapes as before.
        # Measured: motion_scale=0.5 gives a real ~2.5-3x speedup on Module 3
        # (the score signal itself stays ~0.995 correlated with full-res),
        # BUT Module 7's hysteresis thresholds are sensitive to exactly
        # where borderline frames land — in one real test this changed the
        # detected event count from 4 to 1. That's too large a risk to
        # default on for an evidence tool; enable it explicitly via
        # --motion-scale if you've validated it against your own footage
        # and prioritize speed over that risk.
        self.motion_scale = motion_scale

        # Warm-up window: during the first `warmup_frames` frames, the
        # background subtractors are still learning the background model
        # and flag every pixel as foreground (raw_bg ≈ 1.0). We still
        # feed frames to bg.apply() to build the model, but we DON'T let
        # those inflated scores pollute the normalization stats — set
        # raw_bg = 0 during warm-up and skip _update_minmax for bg.
        # Same applies to optical flow on the very first frame (returns 0)
        # and frame-diff before the buffer fills (returns 0), but those
        # already default to 0 so they don't need special handling.
        self.warmup_frames = max(0, warmup_frames)

        # Frame-diff ring buffer.
        # Stores up to k grayscale frames so we can compute |I_t - I_{t-k}|.
        self._gray_buffer: list[np.ndarray] = []

        # Background subtractors (stateful).
        self.bg_mog2 = cv2.createBackgroundSubtractorMOG2(
            history=mog2_history,
            varThreshold=mog2_var_threshold,
            detectShadows=True,
        )
        self.bg_knn = cv2.createBackgroundSubtractorKNN(
            history=knn_history,
            dist2Threshold=knn_dist2_threshold,
            detectShadows=True,
        )

        # Optical flow config.
        self.flow_enable = flow_enable
        self._flow_params = dict(
            pyr_scale=flow_pyr_scale,
            levels=flow_levels,
            winsize=flow_winsize,
            iterations=flow_iterations,
            poly_n=flow_poly_n,
            poly_sigma=flow_poly_sigma,
            flags=0,
        )
        self._prev_gray_for_flow: Optional[np.ndarray] = None

        # Ensemble weights (frozen at init; grid-search should re-init
        # the detector with new weights).
        self.w_diff = w_diff
        self.w_bg = w_bg
        self.w_flow = w_flow

        # Per-video min/max accumulators for normalization.
        # We accumulate raw scores across all frames seen so far, then
        # use the running min/max to normalize. This means early-frame
        # scores will be normalized with less context — for serious use,
        # do a two-pass: first pass to collect raw scores, second pass
        # to normalize with the full-video min/max.
        self._raw_min = {"diff": np.inf, "bg": np.inf, "flow": np.inf}
        self._raw_max = {"diff": -np.inf, "bg": -np.inf, "flow": -np.inf}
        self._frame_count = 0

    # ---------------- per-frame processing ----------------

    def process(
        self,
        frame_idx: int,
        timestamp: float,
        frame_bgr: np.ndarray,
    ) -> "FrameMotionResult":
        """
        Process one sampled frame. Must be called in temporal order.

        Returns a FrameMotionResult with raw + normalized scores, the
        combined mask, and (if enabled) the optical flow field.
        """
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)

        # ---- (a) Frame difference ----
        diff_mask = self._frame_diff(gray)

        # ---- (b) Background subtraction (MOG2 + KNN, average) ----
        bg_mask = self._background_subtract(frame_bgr)

        # ---- (c) Optical flow ----
        if self.flow_enable:
            flow_field, flow_magnitude = self._optical_flow(gray)
        else:
            flow_field, flow_magnitude = None, None

        # ---- raw per-method scalar scores ----
        # diff_mask and bg_mask are binary uint8 (0/255): score = fraction foreground.
        # flow_magnitude is float: score = mean magnitude.
        raw_diff = self._mean_nonzero(diff_mask)
        raw_bg = self._mean_nonzero(bg_mask)
        raw_flow = float(flow_magnitude.mean()) if flow_magnitude is not None else 0.0

        # ---- warm-up window handling ----
        # During the first `warmup_frames` frames, the bg subtractors
        # haven't learned the background yet — they flag every pixel as
        # foreground (raw_bg ≈ 1.0). We still feed frames to bg.apply()
        # above (to build the model), but we don't trust the bg score yet.
        # Set raw_bg = 0 so it doesn't pollute downstream scoring, and
        # skip _update_minmax for bg so the cold-start artifact doesn't
        # lock the normalization max at 1.0 for the entire video.
        is_warmup = self._frame_count < self.warmup_frames
        if is_warmup:
            raw_bg = 0.0

        # ---- update running min/max for per-video normalization ----
        self._update_minmax("diff", raw_diff)
        if not is_warmup:
            self._update_minmax("bg", raw_bg)
        if flow_magnitude is not None:
            self._update_minmax("flow", raw_flow)

        # ---- normalized scores (0..1 using running min/max) ----
        n_diff = self._normalize(raw_diff, "diff")
        n_bg = self._normalize(raw_bg, "bg")
        n_flow = self._normalize(raw_flow, "flow") if flow_magnitude is not None else 0.0

        # ---- ensemble scalar ----
        combined_score = (
            self.w_diff * n_diff
            + self.w_bg * n_bg
            + self.w_flow * n_flow
        )

        # ---- ensemble mask (for ROI extraction in Module 5) ----
        # Pass is_warmup explicitly so the mask path uses the same warm-up
        # gating decision as the scalar path above. Without this, the
        # first `warmup_frames` masks would be all-white because the
        # cold-start bg mask (every pixel = foreground) would contribute
        # its 35% weight to every pixel in the combined mask.
        combined_mask = self._ensemble_mask(
            diff_mask, bg_mask, flow_magnitude,
            is_warmup=is_warmup,
        )

        self._frame_count += 1

        return FrameMotionResult(
            frame_idx=frame_idx,
            timestamp_sec=timestamp,
            raw_diff=raw_diff,
            raw_bg=raw_bg,
            raw_flow=raw_flow,
            norm_diff=n_diff,
            norm_bg=n_bg,
            norm_flow=n_flow,
            score=combined_score,
            mask=combined_mask,
            flow_field=flow_field,
        )

    # ---------------- internal methods ----------------

    def _frame_diff(self, gray: np.ndarray) -> np.ndarray:
        """Compute |I_t - I_{t-k}|, threshold, return a full-resolution
        binary mask (computed on a downscaled copy for speed — see
        self.motion_scale in __init__)."""
        if self.motion_scale < 1.0:
            small = cv2.resize(gray, None, fx=self.motion_scale, fy=self.motion_scale,
                                interpolation=cv2.INTER_AREA)
        else:
            small = gray

        # Buffer stores the last (diff_k + 1) downscaled grayscale frames so
        # we can compute |I_t - I_{t-k}|. After appending current, we have:
        #   buffer[-1] = I_t, buffer[0] = I_{t-k}
        self._gray_buffer.append(small)
        if len(self._gray_buffer) > self.diff_k + 1:
            self._gray_buffer.pop(0)

        if len(self._gray_buffer) <= self.diff_k:
            # Not enough history yet — need k prior frames before current.
            return np.zeros_like(gray, dtype=np.uint8)

        prev_small = self._gray_buffer[0]
        diff = cv2.absdiff(prev_small, small)
        _, mask = cv2.threshold(diff, self.diff_thresh, 255, cv2.THRESH_BINARY)

        if self.motion_scale < 1.0:
            mask = cv2.resize(mask, (gray.shape[1], gray.shape[0]), interpolation=cv2.INTER_NEAREST)
        return mask

    def _background_subtract(self, frame_bgr: np.ndarray) -> np.ndarray:
        """
        Run both MOG2 and KNN, average their (shadow-cleaned) masks.
        Averaging reduces single-method false positives. Computed on a
        downscaled copy for speed (see self.motion_scale); the background
        models themselves just track the smaller image consistently, no
        correctness issue since they never see full resolution here.
        """
        orig_h, orig_w = frame_bgr.shape[:2]
        if self.motion_scale < 1.0:
            small_bgr = cv2.resize(frame_bgr, None, fx=self.motion_scale, fy=self.motion_scale,
                                    interpolation=cv2.INTER_AREA)
        else:
            small_bgr = frame_bgr

        m_mog2 = self.bg_mog2.apply(small_bgr)
        m_knn = self.bg_knn.apply(small_bgr)

        # Shadows are marked as 127 by OpenCV when detectShadows=True.
        # We want foreground = 255 only, so zero out shadow pixels.
        m_mog2 = np.where(m_mog2 == 127, 0, m_mog2).astype(np.uint8)
        m_knn = np.where(m_knn == 127, 0, m_knn).astype(np.uint8)

        # Average: a pixel is foreground if either method thinks so (OR
        # is too noisy; AND is too strict). We use mean + threshold.
        combined = ((m_mog2.astype(np.uint16) + m_knn.astype(np.uint16)) / 2).astype(np.uint8)
        # Threshold the averaged mask back to binary.
        _, combined = cv2.threshold(combined, 64, 255, cv2.THRESH_BINARY)

        if self.motion_scale < 1.0:
            combined = cv2.resize(combined, (orig_w, orig_h), interpolation=cv2.INTER_NEAREST)
        return combined

    def _optical_flow(self, gray: np.ndarray):
        """
        Dense Farneback optical flow vs the previous gray frame. This is by
        far the most expensive of the three ensemble methods (measured:
        disabling it cuts Module 3's per-video time by ~75-90%), so like
        frame-diff/background-subtraction it runs on a downscaled copy for
        speed. Unlike a binary mask, a flow field's pixel values ARE
        physical displacement vectors — resizing the field back up isn't
        enough on its own, the vector magnitudes also have to be scaled by
        1/motion_scale (a 3px shift in a half-size image is a 6px shift at
        full size), or downstream consumers (Module 6's camera-shake
        detection reads flow_field directly) would silently see displacement
        magnitudes too small by exactly motion_scale.

        Returns (flow_field HxWx2, magnitude HxW), both at full resolution.
        """
        orig_h, orig_w = gray.shape
        if self.motion_scale < 1.0:
            small = cv2.resize(gray, None, fx=self.motion_scale, fy=self.motion_scale,
                                interpolation=cv2.INTER_AREA)
        else:
            small = gray

        if self._prev_gray_for_flow is None:
            self._prev_gray_for_flow = small
            # No flow on the first frame; return zeros.
            return np.zeros((orig_h, orig_w, 2), dtype=np.float32), np.zeros((orig_h, orig_w), dtype=np.float32)

        flow = cv2.calcOpticalFlowFarneback(
            self._prev_gray_for_flow, small, None, **self._flow_params
        )
        self._prev_gray_for_flow = small

        if self.motion_scale < 1.0:
            flow = cv2.resize(flow, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR) / self.motion_scale

        magnitude, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
        return flow.astype(np.float32), magnitude.astype(np.float32)

    def _ensemble_mask(
        self,
        diff_mask: np.ndarray,
        bg_mask: np.ndarray,
        flow_magnitude: Optional[np.ndarray],
        is_warmup: bool = False,
    ) -> np.ndarray:
        """
        Combine the three masks into one binary mask for ROI extraction.
        Uses OR logic: a pixel is "moving" if ANY method says so (within
        its own normalized threshold). This is intentionally permissive —
        Module 5 will filter the resulting ROIs by area.

        Warm-up gating
        --------------
        During the warm-up window, the bg subtractor flags every pixel
        as foreground because it hasn't learned the background yet. If
        we let that mask contribute its `w_bg` weight, every pixel would
        end up with at least 0.35 from bg alone, and the 0.20 threshold
        below would flag the ENTIRE frame as foreground. The resulting
        masks would be all-white for the first `warmup_frames` frames,
        producing a phantom full-frame "event" that propagates into
        Module 4 (cleanup can't fix all-white) and Module 5 (one giant
        ROI covering the whole frame).

        To match the scalar-path warm-up gating, we pass `is_warmup`
        explicitly from `process()` — this guarantees both paths agree
        on exactly which frames count as warm-up, with no implicit
        coupling through `self._frame_count` (which gets incremented
        only at the end of `process()`).
        """
        h, w = diff_mask.shape
        score = np.zeros((h, w), dtype=np.float32)

        if diff_mask.any():
            score += self.w_diff * (diff_mask.astype(np.float32) / 255.0)
        # Skip bg contribution during warm-up — the cold-start bg mask
        # would otherwise flag the entire frame as foreground.
        if bg_mask.any() and not is_warmup:
            score += self.w_bg * (bg_mask.astype(np.float32) / 255.0)
        if flow_magnitude is not None and flow_magnitude.any():
            # Normalize flow magnitude per-frame to 0..1 using its own max.
            fm = flow_magnitude
            fm_norm = (fm - fm.min()) / (fm.max() - fm.min() + 1e-6)
            score += self.w_flow * fm_norm

        # Threshold the combined score to a binary mask.
        # 0.2 is a reasonable starting threshold — anything that has
        # meaningful contribution from at least one method.
        _, combined = cv2.threshold(score, 0.20, 255, cv2.THRESH_BINARY)
        return combined.astype(np.uint8)

    def _mean_nonzero(self, mask: np.ndarray) -> float:
        """
        Per-method scalar score for a binary mask.
        Returns the FRACTION of pixels flagged as foreground (0..1),
        which is more meaningful than mean-of-nonzero (which collapses
        to 1.0 whenever any pixel is at 255).

        For non-binary inputs (e.g. flow magnitude, used elsewhere),
        this falls back to mean-of-all.
        """
        if mask.size == 0:
            return 0.0
        # Binary mask case: count foreground pixels.
        if mask.dtype == np.uint8 and np.isin(mask, [0, 255]).all():
            return float((mask > 0).sum()) / float(mask.size)
        # Non-binary: mean of all values (caller normalizes the scale).
        return float(mask.mean())

    def _update_minmax(self, key: str, value: float) -> None:
        if value < self._raw_min[key]:
            self._raw_min[key] = value
        if value > self._raw_max[key]:
            self._raw_max[key] = value

    def _normalize(self, value: float, key: str) -> float:
        """Min-max normalize to [0,1] using running min/max."""
        mn, mx = self._raw_min[key], self._raw_max[key]
        if mx - mn < 1e-6:
            return 0.0
        return float((value - mn) / (mx - mn))

    def summary(self) -> dict:
        """Return running stats (for logging at end of video)."""
        return {
            "frames_processed": self._frame_count,
            "warmup_frames": self.warmup_frames,
            "raw_min": dict(self._raw_min),
            "raw_max": dict(self._raw_max),
            "weights": {"diff": self.w_diff, "bg": self.w_bg, "flow": self.w_flow},
            "flow_enabled": self.flow_enable,
            "diff_k": self.diff_k,
        }


# ============================================================
# Result container
# ============================================================

class FrameMotionResult:
    """Lightweight container for one frame's motion outputs."""

    __slots__ = [
        "frame_idx", "timestamp_sec",
        "raw_diff", "raw_bg", "raw_flow",
        "norm_diff", "norm_bg", "norm_flow",
        "score", "mask", "flow_field",
    ]

    def __init__(self, **kwargs):
        for k in self.__slots__:
            setattr(self, k, kwargs[k])

    def to_dict(self, include_flow=False) -> dict:
        d = {
            "frame_idx": self.frame_idx,
            "timestamp_sec": round(self.timestamp_sec, 4),
            "raw_diff": round(self.raw_diff, 6),
            "raw_bg": round(self.raw_bg, 6),
            "raw_flow": round(self.raw_flow, 6),
            "norm_diff": round(self.norm_diff, 6),
            "norm_bg": round(self.norm_bg, 6),
            "norm_flow": round(self.norm_flow, 6),
            "score": round(self.score, 6),
        }
        if include_flow and self.flow_field is not None:
            d["flow_shape"] = list(self.flow_field.shape)
        return d


# ============================================================
# Temporal Spectral Residual saliency ("jerk" pre-filter)
# ============================================================

def temporal_spectral_residual(
    signal: np.ndarray,
    avg_kernel_size: int = 3,
    smooth_sigma: float = 1.0,
) -> np.ndarray:
    """
    Spectral Residual saliency (Hou & Zhang, CVPR 2007), applied to a 1-D
    time series instead of a 2-D image spectrum. See the module docstring
    ("Jerk score") for why this is a cheap, unsupervised way to flag
    sudden/non-periodic spikes in a motion-score signal.

    Steps: FFT -> log amplitude spectrum -> subtract a locally-smoothed
    (box-filtered) version of itself, the "residual" -> reattach the
    original phase -> inverse FFT -> squared magnitude -> optional
    Gaussian smoothing -> min-max normalize to [0, 1].

    Runs once over the whole video's score array (not per-frame) — a
    single O(n log n) FFT pass regardless of video length.
    """
    n = len(signal)
    if n < 8:
        # Too short for a meaningful spectrum — not worth the FFT overhead
        # or the risk of an all-noise residual on a handful of samples.
        return np.zeros(n, dtype=np.float64)

    x = np.asarray(signal, dtype=np.float64)
    spectrum = np.fft.fft(x)
    amplitude = np.abs(spectrum)
    phase = np.angle(spectrum)
    log_amplitude = np.log(amplitude + 1e-8)

    kernel = np.ones(avg_kernel_size, dtype=np.float64) / avg_kernel_size
    avg_log_amplitude = np.convolve(log_amplitude, kernel, mode="same")
    spectral_residual = log_amplitude - avg_log_amplitude

    saliency = np.abs(np.fft.ifft(np.exp(spectral_residual + 1j * phase))) ** 2

    if smooth_sigma and smooth_sigma > 0:
        radius = max(1, int(round(3 * smooth_sigma)))
        offsets = np.arange(-radius, radius + 1, dtype=np.float64)
        gauss = np.exp(-(offsets ** 2) / (2 * smooth_sigma ** 2))
        gauss /= gauss.sum()
        saliency = np.convolve(saliency, gauss, mode="same")

    lo, hi = float(saliency.min()), float(saliency.max())
    if hi - lo > 1e-9:
        saliency = (saliency - lo) / (hi - lo)
    else:
        saliency = np.zeros_like(saliency)

    return saliency


# ============================================================
# CLI runner: reads Module 2 manifest, writes per-frame CSV
# ============================================================

def run_on_manifest(
    manifest_path: str,
    out_csv: str,
    save_masks_dir: Optional[str] = None,
    save_flow_dir: Optional[str] = None,
    w_diff: float = 0.35,
    w_bg: float = 0.35,
    w_flow: float = 0.30,
    disable_flow: bool = False,
    diff_k: int = 2,
    diff_thresh: int = 25,
    warmup_frames: int = 10,
    percentile_norm: bool = True,
    norm_low_pct: float = 5.0,
    norm_high_pct: float = 95.0,
    compute_jerk: bool = True,
    motion_scale: float = 1.0,
) -> dict:
    """
    Read Module 2's manifest.json, process every sampled frame through
    the MotionDetector, write per-frame scores to a CSV, optionally
    save per-frame combined masks and flow fields to disk.

    Two-pass normalization
    ----------------------
    Pass 1 (streaming): the MotionDetector processes each frame and
    records raw_diff / raw_bg / raw_flow. It also maintains a running
    min/max for online normalization.

    Pass 2 (retroactive): if `percentile_norm=True` (default), we
    re-normalize every frame using the 5th/95th percentile of the
    raw scores across the entire video. This is more robust than
    min/max because:
      - A single cold-start artifact won't lock the max at 1.0.
      - A camera-shake burst won't dominate the normalization range.
      - Generalizes better to long videos with mixed activity levels.
    The retroactive pass overwrites norm_diff / norm_bg / norm_flow
    and recomputes the ensemble score.
    """
    manifest_path = Path(manifest_path)
    with open(manifest_path) as f:
        manifest = json.load(f)

    header = manifest["header"]
    frames_meta = manifest["frames"]
    frames_dir = manifest_path.parent

    detector = MotionDetector(
        header=header,
        diff_k=diff_k,
        diff_thresh=diff_thresh,
        flow_enable=not disable_flow,
        w_diff=w_diff,
        w_bg=w_bg,
        w_flow=w_flow,
        warmup_frames=warmup_frames,
        motion_scale=motion_scale,
    )

    if save_masks_dir:
        Path(save_masks_dir).mkdir(parents=True, exist_ok=True)
    if save_flow_dir:
        Path(save_flow_dir).mkdir(parents=True, exist_ok=True)

    rows = []
    t0 = time.time()
    for i, fm in enumerate(frames_meta):
        jpg_path = frames_dir / fm["file"]
        frame = cv2.imread(str(jpg_path))
        if frame is None:
            print(f"[warn] could not read {jpg_path}, skipping", file=sys.stderr)
            continue

        result = detector.process(fm["frame_idx"], fm["timestamp_sec"], frame)
        rows.append(result.to_dict(include_flow=bool(save_flow_dir)))

        if save_masks_dir:
            mask_path = Path(save_masks_dir) / f"mask_f{result.frame_idx:07d}.png"
            cv2.imwrite(str(mask_path), result.mask)
        if save_flow_dir and result.flow_field is not None:
            # Save flow as .npy (HxWx2 float32) — too big as image.
            flow_path = Path(save_flow_dir) / f"flow_f{result.frame_idx:07d}.npy"
            np.save(str(flow_path), result.flow_field)

    elapsed = time.time() - t0

    # ---- Retroactive percentile normalization ----
    # Re-normalize using the 5th/95th percentile across the whole video
    # instead of the streaming min/max. More robust against cold-start
    # artifacts and transient spikes (e.g. camera shake).
    norm_method = "running_minmax"
    if percentile_norm and len(rows) >= 4:
        for key in ("diff", "bg", "flow"):
            # Skip methods that returned all-zeros (e.g. flow disabled).
            values = [float(r[f"raw_{key}"]) for r in rows]
            if max(values) - min(values) < 1e-6:
                continue
            lo = float(np.percentile(values, norm_low_pct))
            hi = float(np.percentile(values, norm_high_pct))
            if hi - lo < 1e-6:
                continue
            for r in rows:
                v = float(r[f"raw_{key}"])
                n = (v - lo) / (hi - lo)
                # Clip to [0, 1] — percentiles may sit inside the actual
                # min/max range, so values outside [lo, hi] need clipping.
                r[f"norm_{key}"] = round(max(0.0, min(1.0, n)), 6)
            # Update the detector's stats so summary() reflects the
            # percentile bounds, not the streaming min/max.
            detector._raw_min[key] = lo
            detector._raw_max[key] = hi
        # Recompute ensemble score with the retroactively-normalized values.
        for r in rows:
            r["score"] = round(
                w_diff * float(r["norm_diff"])
                + w_bg * float(r["norm_bg"])
                + w_flow * float(r["norm_flow"]),
                6,
            )
        norm_method = f"percentile_{norm_low_pct}_{norm_high_pct}"

    # ---- Temporal Spectral Residual saliency ("jerk" pre-filter) ----
    # Second cheap FFT pass over the now-finished `score` signal — see
    # the module docstring and temporal_spectral_residual() above.
    if compute_jerk and len(rows) >= 8:
        combined_scores = np.array([r["score"] for r in rows], dtype=np.float64)
        jerk_scores = temporal_spectral_residual(combined_scores)
        for r, j in zip(rows, jerk_scores):
            r["jerk_score"] = round(float(j), 6)
    else:
        for r in rows:
            r["jerk_score"] = 0.0

    # Write CSV.
    out_csv_path = Path(out_csv)
    out_csv_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(rows[0].keys()) if rows else ["frame_idx"]
    with open(out_csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    summary = {
        "video_id": header["video_id"],
        "frames_processed": len(rows),
        "elapsed_sec": round(elapsed, 3),
        "avg_ms_per_frame": round(1000 * elapsed / max(1, len(rows)), 2),
        "norm_method": norm_method,
        "jerk_computed": compute_jerk and len(rows) >= 8,
        "detector_summary": detector.summary(),
        "out_csv": str(out_csv_path),
        "masks_dir": save_masks_dir,
        "flow_dir": save_flow_dir,
    }
    return summary


def main():
    parser = argparse.ArgumentParser(
        description="ExamVision Module 3: motion detection (diff + MOG2/KNN + "
                    "optical flow) combined into a per-frame ensemble score."
    )
    parser.add_argument(
        "manifest",
        help="Path to Module 2's manifest.json (produced by module2_frame_sampling.py)."
    )
    parser.add_argument(
        "--out", required=True,
        help="Output CSV path for per-frame motion scores."
    )
    parser.add_argument(
        "--save-masks", default=None,
        help="Directory to save per-frame combined masks as PNGs."
    )
    parser.add_argument(
        "--save-flow", default=None,
        help="Directory to save per-frame optical flow fields as .npy files."
    )
    parser.add_argument("--w-diff", type=float, default=0.35, help="Weight for frame differencing (default 0.35)")
    parser.add_argument("--w-bg", type=float, default=0.35, help="Weight for background subtraction (default 0.35)")
    parser.add_argument("--w-flow", type=float, default=0.30, help="Weight for optical flow (default 0.30)")
    parser.add_argument("--diff-k", type=int, default=2, help="Frame-diff lookback (default 2)")
    parser.add_argument("--diff-thresh", type=int, default=25, help="Frame-diff pixel threshold (default 25)")
    parser.add_argument("--disable-flow", action="store_true", help="Disable optical flow (faster, less robust)")
    parser.add_argument("--warmup-frames", type=int, default=10,
                        help="Number of frames to feed bg subtractor before trusting its output (default 10). "
                             "During warm-up, raw_bg is set to 0 and excluded from normalization stats.")
    parser.add_argument("--no-percentile-norm", action="store_true",
                        help="Disable retroactive percentile normalization; use streaming min/max instead.")
    parser.add_argument("--norm-low-pct", type=float, default=5.0,
                        help="Lower percentile for normalization (default 5.0)")
    parser.add_argument("--norm-high-pct", type=float, default=95.0,
                        help="Upper percentile for normalization (default 95.0)")
    parser.add_argument("--disable-jerk", action="store_true",
                        help="Skip the temporal spectral-residual jerk_score pass (default: enabled).")
    parser.add_argument("--motion-scale", type=float, default=1.0,
                        help="Downscale factor for all 3 ensemble methods, e.g. 0.5 = half resolution "
                             "(default 1.0, full resolution). Measured ~2.5-3x faster Module 3 at 0.5, "
                             "but can shift which frames cross Module 7's hysteresis thresholds — in one "
                             "test this changed detected event count from 4 to 1. Opt in deliberately, "
                             "validate against your own footage before trusting it as default.")
    args = parser.parse_args()

    total = args.w_diff + args.w_bg + args.w_flow
    if abs(total - 1.0) > 1e-3:
        parser.error(f"weights must sum to 1.0, got {total:.4f}")

    summary = run_on_manifest(
        manifest_path=args.manifest,
        out_csv=args.out,
        save_masks_dir=args.save_masks,
        save_flow_dir=args.save_flow,
        w_diff=args.w_diff,
        w_bg=args.w_bg,
        w_flow=args.w_flow,
        disable_flow=args.disable_flow,
        diff_k=args.diff_k,
        diff_thresh=args.diff_thresh,
        warmup_frames=args.warmup_frames,
        percentile_norm=not args.no_percentile_norm,
        norm_low_pct=args.norm_low_pct,
        norm_high_pct=args.norm_high_pct,
        compute_jerk=not args.disable_jerk,
        motion_scale=args.motion_scale,
    )

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
