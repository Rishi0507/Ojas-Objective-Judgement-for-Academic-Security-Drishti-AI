"""
ExamVision — Module 6: Camera & Video Quality Analysis
=======================================================
Computes per-frame quality/reliability signals and combines them into
one Q_observability score in [0,1]. The headline formula (Module 7
consumes this) is:

    S_final = S_evidence * Q_observability

where S_evidence is Module 3's ensemble motion score. The idea: a
shaky, blurry, badly-lit frame produces lower-confidence events than
a clean stable one, even if the raw motion score is identical.

Sub-modules (per spec):
  6a. Global vs local optical flow (camera motion flag)
  6b. ORB + RANSAC affine estimation (camera shake magnitude)
  6c. Blur score (Laplacian variance)
  6d. Brightness + brightness jump (lighting change detection)
  6e. Combine into Q_observability

State across calls (per video):
  - Previous gray frame (for ORB matching + brightness jump window)
  - Brightness history (deque of last N frames, default 10)
  - Per-method raw score history (for retroactive percentile normalization)

Usage as a library:
    analyzer = CameraQualityAnalyzer(header)
    for frame_idx, ts, frame in sample_frames(header):
        flow = np.load(f"flow/flow_f{frame_idx:07d}.npy")
        rois = rois_per_frame[frame_idx]
        result = analyzer.process(frame_idx, ts, frame, flow, rois)
        # result.shake_magnitude, result.blur, result.q_observability, ...

Usage as a CLI:
    python module6_quality_analysis.py \\
        --frames-dir pipeline_out/video/frames \\
        --flow-dir   pipeline_out/video/flow \\
        --rois-json  pipeline_out/video/rois/rois_per_frame.json \\
        --motion-csv pipeline_out/video/motion.csv \\
        --out        pipeline_out/video/quality.csv
"""

import argparse
import csv
import json
import os
import sys
import time
from collections import deque
from pathlib import Path
from typing import Optional

import cv2
import numpy as np


# ============================================================
# The analyzer
# ============================================================

class CameraQualityAnalyzer:
    """
    Stateful per-video quality analyzer. Instantiate once per video;
    call .process() once per sampled frame in temporal order.

    State kept across calls:
      - prev_gray: previous grayscale frame (for ORB feature matching)
      - brightness_history: deque of last N brightness values (for jump detection)
      - raw score history: per-method arrays for percentile normalization
    """

    def __init__(
        self,
        header: dict,
        orb_n_features: int = 500,
        orb_match_min: int = 10,
        brightness_window: int = 10,
        flow_global_local_ratio: float = 0.8,
        flow_min_absolute: float = 0.5,
        shake_flag_threshold: float = 2.0,
        fallback_shake_q_discount: float = 0.3,
        # Q_observability fixed-scale defaults (used as initial scale;
        # retroactive percentile normalization overrides per-video).
        shake_max: float = 20.0,
        blur_min: float = 50.0,
        brightness_max: float = 40.0,
        # Percentile normalization bounds (used retroactively).
        norm_low_pct: float = 5.0,
        norm_high_pct: float = 95.0,
    ):
        self.header = header
        self.width = int(header["width"])
        self.height = int(header["height"])

        # ORB + matcher (stateless but expensive to re-init).
        self.orb = cv2.ORB_create(orb_n_features)
        self.bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        self.orb_match_min = orb_match_min

        # Camera-motion flag thresholds.
        # flow_global_local_ratio: spec's 80% rule for global-vs-local flow.
        # flow_min_absolute: floor below which we don't trust the flow signal
        #   (prevents the ratio test from comparing noise to noise on
        #   near-static frames — fixes the unstable 1,0,1,1,1,0 flicker).
        # shake_flag_threshold: ORB weighted shake score (magnitude × inlier
        #   agreement) above which we flag camera motion via the ORB signal.
        #   Only trusted when ORB used masked-mode detection (see below).
        # fallback_shake_q_discount: when ORB falls back to unmasked
        #   detection (because the masked path found too few keypoints),
        #   ORB is by definition dominated by the moving object's own
        #   keypoints, so shake_score is unreliable. We discount its
        #   contribution to Q_observability by this factor (default 0.3
        #   = 30% weight). 1.0 = no discount (not recommended — would
        #   re-introduce the inversion bug on texture-poor footage).
        #   0.0 = fully ignore fallback shake for Q (too aggressive —
        #   loses the signal entirely when fallback is the only path).
        self.flow_global_local_ratio = flow_global_local_ratio
        self.flow_min_absolute = flow_min_absolute
        self.shake_flag_threshold = shake_flag_threshold
        self.fallback_shake_q_discount = fallback_shake_q_discount

        # Previous frame state.
        self._prev_gray: Optional[np.ndarray] = None

        # Brightness jump window.
        self.brightness_window = brightness_window
        self._brightness_history: deque[float] = deque(maxlen=brightness_window)

        # Fixed-scale defaults (used for streaming normalization).
        self.shake_max = shake_max
        self.blur_min = blur_min
        self.brightness_max = brightness_max

        # Per-method raw score history for retroactive percentile normalization.
        self._raw_shake_history: list[float] = []
        self._raw_blur_history: list[float] = []
        self._raw_bjump_history: list[float] = []
        self._raw_gflow_history: list[float] = []
        self._frame_count = 0

        # Percentile bounds for retroactive normalization.
        self.norm_low_pct = norm_low_pct
        self.norm_high_pct = norm_high_pct

    # ---------------- per-frame processing ----------------

    def process(
        self,
        frame_idx: int,
        timestamp: float,
        frame_bgr: np.ndarray,
        flow_field: Optional[np.ndarray] = None,
        rois: Optional[list[dict]] = None,
    ) -> "FrameQualityResult":
        """
        Process one sampled frame. Must be called in temporal order
        (uses prev_gray for ORB matching).

        Parameters
        ----------
        frame_idx, timestamp : identity (from Module 2)
        frame_bgr : HxWx3 uint8 BGR
        flow_field : Module 3's saved .npy — either an HxW magnitude map
                     (float16, the current format) or a legacy HxWx2
                     (dx, dy) float32 vector field. Both are accepted.
                     Pass None to skip the global-vs-local flow check.
        rois : list of ROI dicts (from Module 5). Each must have "bbox"
               as [x1,y1,x2,y2]. Used for BOTH the local-flow comparison
               AND masking out ROI regions during ORB keypoint detection
               (so the moving object's own edges don't get matched as
               camera-shake keypoints).

        Returns
        -------
        FrameQualityResult with all sub-scores + combined Q_observability.
        """
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)

        # Build a background mask once: 255 everywhere except ROI boxes
        # (which are 0 = "don't extract keypoints here"). Used by ORB to
        # sample only static-background keypoints — without this, a moving
        # object's edges get matched as "camera shake."
        bg_mask = self._background_mask(gray.shape, rois)

        # ---- (a) Global vs local optical flow (camera motion flag, flow-based) ----
        global_flow_mean, local_flow_means, flow_camera_motion = \
            self._global_vs_local_flow(flow_field, rois)

        # ---- (b) ORB + RANSAC camera shake (camera motion flag, ORB-based) ----
        # Pass the bg_mask so ORB ignores the moving object's keypoints.
        # If the mask leaves too few keypoints, _estimate_camera_motion
        # will fall back to unmasked detection and report detect_mode accordingly.
        shake_magnitude, shake_inlier_ratio, shake_camera_motion, detect_mode = \
            self._estimate_camera_motion(gray, bg_mask)

        # ---- Trust gating: only trust the shake signal when masked-mode ORB ----
        # produced it. In unmasked_fallback mode, ORB is by definition
        # dominated by the moving object's own edges (that's why we had to
        # fall back), so shake_camera_motion from fallback mode re-creates
        # the original inversion bug — real object motion misclassified as
        # camera shake. We still report the raw shake_camera_motion flag
        # and shake_score in the CSV for diagnostics, but only the
        # masked-mode signal can drive the combined possible_camera_motion
        # flag and contribute to Q_observability at full weight.
        shake_trusted = (detect_mode == "masked")
        trusted_shake_camera_motion = shake_camera_motion and shake_trusted

        # Discount factor for Q_observability: in fallback mode, the shake
        # signal is unreliable, so discount it heavily (default 0.3 = only
        # 30% of the raw shake penalty applies). This prevents an unreliable
        # shake_score from artificially lowering Q_observability on real
        # motion frames — exactly the inversion you'd otherwise see when
        # fallback fires frequently on texture-poor footage.
        shake_q_discount = 1.0 if shake_trusted else self.fallback_shake_q_discount
        shake_score_raw = shake_magnitude * shake_inlier_ratio
        shake_score_for_q = shake_score_raw * shake_q_discount

        # ---- Combine both signals into the final flag ----
        # Spec calls for two independent camera-motion signals. We OR them,
        # but only trust the shake signal when it came from masked-mode
        # detection. The flow signal is always trusted (it doesn't depend
        # on ORB keypoint distribution).
        # Failure modes:
        #   - flow catches whole-frame shifts even when ORB is starved
        #   - masked ORB catches small rigid shifts that flow might miss
        #   - unmasked_fallback shake is reported but NOT trusted for the flag
        possible_camera_motion = flow_camera_motion or trusted_shake_camera_motion

        # ---- (c) Blur score (Laplacian variance) ----
        blur_var = self._blur_score(gray)

        # ---- (d) Brightness + brightness jump ----
        brightness = float(gray.mean())
        self._brightness_history.append(brightness)
        b_jump = self._brightness_jump()

        # ---- raw score history (for percentile normalization) ----
        # We store the RAW shake_score (un-discounted) so percentile
        # normalization sees the true signal distribution. The discount
        # is applied AFTER percentile normalization, in the recompute.
        self._raw_shake_history.append(shake_score_raw)
        self._raw_blur_history.append(blur_var)
        self._raw_bjump_history.append(b_jump)
        self._raw_gflow_history.append(global_flow_mean)

        # ---- streaming Q_observability (fixed-scale, retroactively overridden) ----
        # Use the discounted shake_score so fallback-mode frames don't
        # get an unfairly low Q from an unreliable shake signal.
        q_streaming = self._compute_q_observability_fixed(
            shake_score_for_q,
            blur_var,
            b_jump,
        )

        self._frame_count += 1

        return FrameQualityResult(
            frame_idx=frame_idx,
            timestamp_sec=timestamp,
            shake_magnitude=shake_magnitude,
            shake_inlier_ratio=shake_inlier_ratio,
            shake_score=shake_score_raw,
            global_flow_mean=global_flow_mean,
            local_flow_means=local_flow_means,
            possible_camera_motion=possible_camera_motion,
            flow_camera_motion=flow_camera_motion,
            shake_camera_motion=shake_camera_motion,
            trusted_shake_camera_motion=trusted_shake_camera_motion,
            orb_detect_mode=detect_mode,
            shake_q_discount=shake_q_discount,
            blur_score=blur_var,
            brightness=brightness,
            brightness_jump=b_jump,
            q_observability=q_streaming,  # streaming estimate; retroactive recompute happens in run_on_dirs
        )

    # ---------------- 6a: global vs local flow ----------------

    def _global_vs_local_flow(
        self,
        flow_field: Optional[np.ndarray],
        rois: Optional[list[dict]],
    ) -> tuple[float, list[float], bool]:
        """
        Compare whole-frame flow magnitude to per-ROI flow magnitude.
        If global mean is comparable to (≥ ratio × max(local means)),
        the "motion" isn't localized — likely the camera moved.

        Absolute floor: if global_mean is below a minimum threshold
        (default 0.5 px), don't flag — the signal is too weak to be
        confident about. Prevents the ratio test from comparing noise
        to noise on near-static frames (which previously produced an
        unstable 1,0,1,1,1,0 flicker across consecutive frames).

        Returns (global_mean, local_means, flow_camera_motion).
        """
        if flow_field is None:
            return 0.0, [], False

        # Module 3 saves flow as a precomputed HxW magnitude map (float16,
        # 4x smaller on disk — see its --save-flow branch). Older runs saved
        # the raw HxWx2 (dx, dy) vector field, so accept both: derive the
        # magnitude only when we were handed actual vectors.
        if flow_field.ndim == 3:
            magnitude = np.sqrt(
                flow_field[..., 0].astype(np.float32) ** 2
                + flow_field[..., 1].astype(np.float32) ** 2
            )
        else:
            magnitude = flow_field.astype(np.float32)
        global_mean = float(magnitude.mean()) if magnitude.size > 0 else 0.0

        local_means: list[float] = []
        if rois:
            for roi in rois:
                bbox = roi.get("bbox") or [
                    roi.get("bbox_x1"), roi.get("bbox_y1"),
                    roi.get("bbox_x2"), roi.get("bbox_y2"),
                ]
                if not all(bbox):
                    continue
                x1, y1, x2, y2 = [int(v) for v in bbox]
                # Clamp to frame bounds.
                x1 = max(0, min(x1, self.width - 1))
                x2 = max(0, min(x2, self.width))
                y1 = max(0, min(y1, self.height - 1))
                y2 = max(0, min(y2, self.height))
                if x2 <= x1 or y2 <= y1:
                    continue
                local_means.append(float(magnitude[y1:y2, x1:x2].mean()))

        # Absolute floor: don't flag if global_mean is too small to trust.
        # Below 0.5 px of average per-pixel motion, we're in noise territory.
        if global_mean < self.flow_min_absolute:
            return global_mean, local_means, False

        # Spec rule: if global mean is within 80% of the local ROI means,
        # the "motion" isn't localized → probably the camera shifted.
        if local_means:
            max_local = max(local_means)
            if max_local > 0 and global_mean >= self.flow_global_local_ratio * max_local:
                return global_mean, local_means, True
        else:
            # No ROIs at all but global motion is non-zero AND above the
            # absolute floor — strong signal that the whole frame moved.
            if global_mean >= 1.0:
                return global_mean, local_means, True

        return global_mean, local_means, False

    # ---------------- helper: build background mask for ORB ----------------

    def _background_mask(
        self,
        gray_shape: tuple[int, int],
        rois: Optional[list[dict]],
    ) -> Optional[np.ndarray]:
        """
        Build a binary mask for ORB keypoint detection: 255 (sample) for
        presumed-static background, 0 (skip) inside ROI boxes.

        Without this mask, ORB would lock onto the moving object's own
        edges, and RANSAC would fit an affine transform dominated by the
        object's displacement — reporting real motion as "camera shake."

        Returns None if there are no ROIs (caller passes None to ORB,
        which then samples the whole frame — same as the old behavior).
        """
        if not rois:
            return None
        mask = np.full(gray_shape, 255, dtype=np.uint8)
        for roi in rois:
            bbox = roi.get("bbox") or [
                roi.get("bbox_x1"), roi.get("bbox_y1"),
                roi.get("bbox_x2"), roi.get("bbox_y2"),
            ]
            if not all(bbox):
                continue
            x1, y1, x2, y2 = [int(v) for v in bbox]
            x1 = max(0, min(x1, self.width - 1))
            x2 = max(0, min(x2, self.width))
            y1 = max(0, min(y1, self.height - 1))
            y2 = max(0, min(y2, self.height))
            if x2 <= x1 or y2 <= y1:
                continue
            mask[y1:y2, x1:x2] = 0
        return mask

    # ---------------- 6b: ORB + RANSAC ----------------

    def _estimate_camera_motion(
        self,
        gray: np.ndarray,
        bg_mask: Optional[np.ndarray] = None,
    ) -> tuple[float, float, bool]:
        """
        Estimate camera shake via ORB keypoint matching + RANSAC affine.

        Parameters
        ----------
        gray : HxW current grayscale frame.
        bg_mask : HxW uint8 mask, 255 where ORB should sample (presumed
                  static background), 0 inside ROI boxes (moving objects).
                  Pass None to sample the whole frame (legacy behavior,
                  NOT recommended when ROIs are available).

        Returns
        -------
        (shake_magnitude, inlier_ratio, shake_camera_motion)

        - shake_magnitude: sqrt(dx^2 + dy^2) from the affine matrix translation.
        - inlier_ratio: fraction of matched keypoints that agree on the transform.
        - shake_camera_motion: True if shake_magnitude * inlier_ratio exceeds
          the configured threshold (default 2.0). This is the ORB-based
          camera-motion signal, combined with the flow-based signal in
          process() to produce the final possible_camera_motion flag.

        Masking out ROI regions is the key fix: without it, the moving
        object's own edges produce most of the keypoints, and RANSAC
        reports the object's displacement as "camera shake" — even though
        the camera never moved. This is exactly the inversion the spec
        warns about ("False Motion Detection" risk).
        """
        if self._prev_gray is None:
            self._prev_gray = gray
            return 0.0, 0.0, False, "cold_start"

        # Detect + describe with the background mask applied to both frames.
        # Using the CURRENT frame's ROI mask for both is fine — ORB
        # descriptors are local, and the previous frame's object position
        # differs by at most one frame's worth of motion.
        #
        # FALLBACK: if the masked detection finds too few keypoints, retry
        # without the mask. This handles the case where the ROI covers most
        # of the frame's usable texture (e.g. sparse CCTV footage with the
        # only textured region being the moving object itself). Without
        # the fallback, the shake signal would go completely silent in
        # exactly the frames where camera shake is most likely.
        kp1, des1, src_masked = self._detect_with_fallback(self._prev_gray, bg_mask)
        kp2, des2, dst_masked = self._detect_with_fallback(gray, bg_mask)

        # Track which side fell back — used for diagnostics.
        # If EITHER side fell back, the match is "unmasked."
        used_unmasked_fallback = (not src_masked) or (not dst_masked)
        detect_mode = "unmasked_fallback" if used_unmasked_fallback else "masked"

        # Update prev_gray for the next call regardless of match success.
        self._prev_gray = gray

        if des1 is None or des2 is None or len(kp1) < self.orb_match_min or len(kp2) < self.orb_match_min:
            return 0.0, 0.0, False, detect_mode

        # Match descriptors.
        try:
            matches = self.bf.match(des1, des2)
        except cv2.error:
            return 0.0, 0.0, False, detect_mode

        if len(matches) < self.orb_match_min:
            return 0.0, 0.0, False, detect_mode

        # Extract matched point coordinates.
        src_pts = np.float32([kp1[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
        dst_pts = np.float32([kp2[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)

        # RANSAC affine estimation.
        try:
            M, inliers = cv2.estimateAffinePartial2D(src_pts, dst_pts, method=cv2.RANSAC)
        except cv2.error:
            return 0.0, 0.0, False, detect_mode

        if M is None:
            return 0.0, 0.0, False, detect_mode

        # Translation magnitude from the affine matrix.
        dx = float(M[0, 2])
        dy = float(M[1, 2])
        shake_magnitude = float(np.sqrt(dx * dx + dy * dy))

        # Inlier ratio = fraction of matches that agree with the estimated transform.
        if inliers is not None:
            inlier_ratio = float(inliers.sum()) / float(len(inliers))
        else:
            inlier_ratio = 0.0

        # Shake flag: weighted shake score (magnitude × inlier agreement)
        # must exceed a threshold. Default 2.0 — tuned to be above the
        # noise floor of typical video but below the magnitude of real
        # camera shake events.
        shake_score = shake_magnitude * inlier_ratio
        shake_camera_motion = shake_score > self.shake_flag_threshold

        return shake_magnitude, inlier_ratio, shake_camera_motion, detect_mode

    def _detect_with_fallback(
        self,
        gray: np.ndarray,
        bg_mask: Optional[np.ndarray],
    ) -> tuple[list, Optional[np.ndarray], bool]:
        """
        Run ORB keypoint detection with a fallback to unmasked detection.

        First try with bg_mask (excludes ROI regions, the preferred path).
        If that finds fewer than `orb_match_min` keypoints, retry without
        the mask. This handles the edge case where the ROI covers most of
        the frame's usable texture (e.g. sparse CCTV footage with only
        one textured region that happens to be the moving object).

        Returns (keypoints, descriptors, used_mask_flag).
        used_mask_flag is True if the masked detection succeeded (enough
        keypoints), False if we had to fall back to unmasked detection.
        """
        # Try masked detection first.
        if bg_mask is not None:
            kp, des = self.orb.detectAndCompute(gray, bg_mask)
            if des is not None and len(kp) >= self.orb_match_min:
                return kp, des, True
            # Not enough keypoints — fall through to unmasked.

        # Fallback: unmasked detection.
        kp, des = self.orb.detectAndCompute(gray, None)
        return kp, des, False

    # ---------------- 6c: blur ----------------

    def _blur_score(self, gray: np.ndarray) -> float:
        """
        Laplacian variance — standard blur metric.
        Low variance = blurry frame (no high-frequency detail).
        ~100 is a common rough cutoff; ~50 is "noticeably blurry."
        """
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())

    # ---------------- 6d: brightness + jump ----------------

    def _brightness_jump(self) -> float:
        """
        Max - min brightness over the last `brightness_window` frames.
        Large swing = lighting change event (lights on/off, sun-cloud).
        """
        if len(self._brightness_history) < 2:
            return 0.0
        recent = list(self._brightness_history)
        return float(max(recent) - min(recent))

    # ---------------- 6e: Q_observability (fixed scale) ----------------

    def _compute_q_observability_fixed(
        self,
        shake_score: float,
        blur_val: float,
        brightness_jump_val: float,
    ) -> float:
        """
        Compute Q_observability using fixed scale thresholds (spec version).
        Each penalty is clipped to [0,1]; final = 1 - avg(penalties).
        """
        shake_penalty = min(1.0, shake_score / self.shake_max) if self.shake_max > 0 else 0.0
        # Blur penalty: 1 when blur_val is 0, 0 when blur_val >= blur_min.
        blur_penalty = min(1.0, max(0.0, self.blur_min - blur_val) / self.blur_min) if self.blur_min > 0 else 0.0
        brightness_penalty = min(1.0, brightness_jump_val / self.brightness_max) if self.brightness_max > 0 else 0.0

        avg_penalty = (shake_penalty + blur_penalty + brightness_penalty) / 3.0
        return max(0.0, 1.0 - avg_penalty)

    # ---------------- retroactive percentile normalization ----------------

    def recompute_q_observability_percentile(self, results: list["FrameQualityResult"]) -> None:
        """
        Recompute Q_observability for every frame using per-video
        5th/95th percentile bounds instead of fixed thresholds.

        This handles the same cold-start / outlier-spike problem as
        Module 3's percentile normalization:
          - First frame has no prev_gray → shake = 0 (not a problem)
          - But shake on a single camera-shake burst could lock the max,
            making all other frames look "no shake."
          - Percentile bounds (5/95) give a more representative range.
        """
        if len(results) < 4:
            return  # Not enough data for percentile normalization.

        shake_scores = [r.shake_score for r in results]
        blur_scores = [r.blur_score for r in results]
        bjump_scores = [r.brightness_jump for r in results]

        # Compute percentile bounds per metric.
        bounds = {}
        for name, values in [("shake", shake_scores),
                              ("blur", blur_scores),
                              ("bjump", bjump_scores)]:
            arr = np.array(values, dtype=np.float64)
            if arr.max() - arr.min() < 1e-6:
                bounds[name] = None
                continue
            lo = float(np.percentile(arr, self.norm_low_pct))
            hi = float(np.percentile(arr, self.norm_high_pct))
            if hi - lo < 1e-6:
                bounds[name] = None
                continue
            bounds[name] = (lo, hi)

        # Recompute Q_observability per frame using percentile-based penalties.
        # Apply the per-frame shake discount (already stored on the result
        # when the frame was first processed) so fallback-mode shake
        # contributes less to the per-frame penalty — same logic as the
        # streaming path.
        for r in results:
            # Shake penalty: 0 at lo, 1 at hi (and beyond, clipped).
            # Discounted by shake_q_discount to reflect trust in the
            # underlying shake_score (masked=1.0, fallback=0.3 default).
            if bounds["shake"]:
                lo, hi = bounds["shake"]
                raw_shake_penalty = max(0.0, min(1.0, (r.shake_score - lo) / (hi - lo)))
                shake_penalty = raw_shake_penalty * r.shake_q_discount
            else:
                shake_penalty = 0.0

            # Blur penalty: 0 at hi (sharp), 1 at lo (blurry).
            # Inverted from shake because higher blur_score = sharper (better).
            if bounds["blur"]:
                lo, hi = bounds["blur"]
                # Want penalty=0 when blur_val=hi (sharp), penalty=1 when blur_val=lo (blurry).
                # Using (hi - val) / (hi - lo) gives 1 at lo, 0 at hi.
                blur_penalty = max(0.0, min(1.0, (hi - r.blur_score) / (hi - lo)))
            else:
                blur_penalty = 0.0

            # Brightness jump penalty: 0 at lo, 1 at hi (and beyond, clipped).
            if bounds["bjump"]:
                lo, hi = bounds["bjump"]
                bjump_penalty = max(0.0, min(1.0, (r.brightness_jump - lo) / (hi - lo)))
            else:
                bjump_penalty = 0.0

            avg_penalty = (shake_penalty + blur_penalty + bjump_penalty) / 3.0
            r.q_observability = max(0.0, 1.0 - avg_penalty)

    def summary(self) -> dict:
        return {
            "frames_processed": self._frame_count,
            "brightness_window": self.brightness_window,
            "flow_global_local_ratio": self.flow_global_local_ratio,
            "norm_percentiles": [self.norm_low_pct, self.norm_high_pct],
            "raw_shake_history_len": len(self._raw_shake_history),
            "raw_blur_history_len": len(self._raw_blur_history),
            "raw_bjump_history_len": len(self._raw_bjump_history),
        }


# ============================================================
# Result container
# ============================================================

class FrameQualityResult:
    __slots__ = [
        "frame_idx", "timestamp_sec",
        "shake_magnitude", "shake_inlier_ratio", "shake_score",
        "global_flow_mean", "local_flow_means",
        "flow_camera_motion", "shake_camera_motion",
        "trusted_shake_camera_motion", "possible_camera_motion",
        "orb_detect_mode", "shake_q_discount",
        "blur_score", "brightness", "brightness_jump",
        "q_observability",
    ]

    def __init__(self, **kwargs):
        for k in self.__slots__:
            setattr(self, k, kwargs[k])

    def to_dict(self) -> dict:
        return {
            "frame_idx": self.frame_idx,
            "timestamp_sec": round(self.timestamp_sec, 4),
            "shake_magnitude": round(self.shake_magnitude, 4),
            "shake_inlier_ratio": round(self.shake_inlier_ratio, 4),
            "shake_score": round(self.shake_score, 4),
            "global_flow_mean": round(self.global_flow_mean, 4),
            "local_flow_mean_max": round(max(self.local_flow_means), 4) if self.local_flow_means else 0.0,
            "local_flow_count": len(self.local_flow_means),
            "flow_camera_motion": int(self.flow_camera_motion),
            "shake_camera_motion": int(self.shake_camera_motion),
            "trusted_shake_camera_motion": int(self.trusted_shake_camera_motion),
            "possible_camera_motion": int(self.possible_camera_motion),
            "orb_detect_mode": self.orb_detect_mode,
            "shake_q_discount": round(self.shake_q_discount, 3),
            "blur_score": round(self.blur_score, 4),
            "brightness": round(self.brightness, 4),
            "brightness_jump": round(self.brightness_jump, 4),
            "q_observability": round(self.q_observability, 4),
        }


# ============================================================
# Batch runner
# ============================================================

def run_on_dirs(
    frames_dir: str,
    flow_dir: Optional[str],
    rois_json: Optional[str],
    motion_csv: Optional[str],
    out_csv: str,
    orb_match_min: int = 10,
    brightness_window: int = 10,
    flow_global_local_ratio: float = 0.8,
    flow_min_absolute: float = 0.5,
    shake_flag_threshold: float = 2.0,
    fallback_shake_q_discount: float = 0.3,
    shake_max: float = 20.0,
    blur_min: float = 50.0,
    brightness_max: float = 40.0,
    norm_low_pct: float = 5.0,
    norm_high_pct: float = 95.0,
    use_percentile_norm: bool = True,
) -> dict:
    """
    Run quality analysis on every sampled frame.

    Reads:
      - frames_dir/  (JPGs from Module 2)
      - flow_dir/     (.npy files from Module 3, optional)
      - rois_json     (rois_per_frame.json from Module 5, optional)
      - motion_csv    (motion.csv from Module 3, for timestamp/score lookup)

    Writes:
      - out_csv      (per-frame quality scores)
    """
    frames_path = Path(frames_dir)
    if not frames_path.is_dir():
        raise NotADirectoryError(f"frames dir not found: {frames_dir}")

    # Load Module 2's manifest to get frame ordering + timestamps.
    manifest_path = frames_path / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Module 2 manifest not found: {manifest_path}")
    with open(manifest_path) as f:
        manifest = json.load(f)
    header = manifest["header"]
    frames_meta = manifest["frames"]

    # Load ROIs from Module 5 (if provided).
    rois_by_frame = {}
    if rois_json and os.path.isfile(rois_json):
        with open(rois_json) as f:
            rois_data = json.load(f)
        for frame_entry in rois_data.get("frames", []):
            rois_by_frame[frame_entry["frame_idx"]] = frame_entry.get("rois", [])

    # Load motion.csv for timestamp/score lookup (mostly redundant with manifest,
    # but useful for joining later in the pipeline).
    motion_by_idx = {}
    if motion_csv and os.path.isfile(motion_csv):
        with open(motion_csv) as f:
            for row in csv.DictReader(f):
                motion_by_idx[int(row["frame_idx"])] = {
                    "timestamp_sec": float(row["timestamp_sec"]),
                    "score": float(row["score"]),
                }

    analyzer = CameraQualityAnalyzer(
        header=header,
        orb_match_min=orb_match_min,
        brightness_window=brightness_window,
        flow_global_local_ratio=flow_global_local_ratio,
        flow_min_absolute=flow_min_absolute,
        shake_flag_threshold=shake_flag_threshold,
        fallback_shake_q_discount=fallback_shake_q_discount,
        shake_max=shake_max,
        blur_min=blur_min,
        brightness_max=brightness_max,
        norm_low_pct=norm_low_pct,
        norm_high_pct=norm_high_pct,
    )

    flow_path = Path(flow_dir) if flow_dir else None
    results: list[FrameQualityResult] = []

    t0 = time.time()
    for i, fm in enumerate(frames_meta):
        # Find the original sampled JPG (Module 2 names them as
        # "<video_id>__f<idx>__t<ts>.jpg").
        jpg_path = frames_path / fm["file"]
        if not jpg_path.exists():
            print(f"[warn] missing frame {jpg_path}, skipping", file=sys.stderr)
            continue

        frame = cv2.imread(str(jpg_path))
        if frame is None:
            print(f"[warn] could not read {jpg_path}, skipping", file=sys.stderr)
            continue

        # Load optical flow .npy if available.
        frame_idx = fm["frame_idx"]
        flow_field = None
        if flow_path:
            flow_file = flow_path / f"flow_f{frame_idx:07d}.npy"
            if flow_file.exists():
                try:
                    flow_field = np.load(str(flow_file))
                except Exception as e:
                    print(f"[warn] could not load {flow_file}: {e}", file=sys.stderr)

        rois = rois_by_frame.get(frame_idx, [])

        ts = motion_by_idx.get(frame_idx, {}).get("timestamp_sec", fm.get("timestamp_sec", frame_idx))

        result = analyzer.process(frame_idx, ts, frame, flow_field, rois)
        results.append(result)

    elapsed = time.time() - t0

    # Retroactive percentile normalization (more robust than fixed thresholds).
    norm_method = "fixed_scale"
    if use_percentile_norm and len(results) >= 4:
        analyzer.recompute_q_observability_percentile(results)
        norm_method = f"percentile_{norm_low_pct}_{norm_high_pct}"

    # Write CSV.
    out_csv_path = Path(out_csv)
    out_csv_path.parent.mkdir(parents=True, exist_ok=True)
    rows = [r.to_dict() for r in results]
    fieldnames = list(rows[0].keys()) if rows else ["frame_idx"]
    with open(out_csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    # Aggregate stats.
    if results:
        shakes = [r.shake_score for r in results]
        blurs = [r.blur_score for r in results]
        bjumps = [r.brightness_jump for r in results]
        qs = [r.q_observability for r in results]
        camera_motion_count = sum(1 for r in results if r.possible_camera_motion)
        # Break down by source for visibility — was it the flow signal,
        # the ORB shake signal (trusted = masked mode), or both?
        # NOTE: this uses shake_camera_motion (raw flag from ORB) not
        # trusted_shake_camera_motion — so you can see how often the
        # raw ORB signal fires vs how often it's actually trusted.
        flow_only_count = sum(1 for r in results
                              if r.flow_camera_motion and not r.shake_camera_motion)
        shake_only_count = sum(1 for r in results
                                if r.shake_camera_motion and not r.flow_camera_motion)
        both_count = sum(1 for r in results
                         if r.flow_camera_motion and r.shake_camera_motion)
        # Of the shake_camera_motion=1 frames, how many were trusted
        # (masked mode) vs untrusted (fallback mode — not driving the flag)?
        shake_raw_count = sum(1 for r in results if r.shake_camera_motion)
        shake_trusted_count = sum(1 for r in results if r.trusted_shake_camera_motion)
        shake_untrusted_count = shake_raw_count - shake_trusted_count
        # Break down ORB detection mode — masked (preferred) vs unmasked
        # fallback (when ROI covered too much texture).
        masked_count = sum(1 for r in results if r.orb_detect_mode == "masked")
        unmasked_fallback_count = sum(1 for r in results if r.orb_detect_mode == "unmasked_fallback")
        cold_start_count = sum(1 for r in results if r.orb_detect_mode == "cold_start")
    else:
        shakes = blurs = bjumps = qs = []
        camera_motion_count = 0
        flow_only_count = shake_only_count = both_count = 0
        shake_raw_count = shake_trusted_count = shake_untrusted_count = 0
        masked_count = unmasked_fallback_count = cold_start_count = 0

    summary = {
        "video_id": header.get("video_id", "video"),
        "frames_processed": len(results),
        "elapsed_sec": round(elapsed, 3),
        "avg_ms_per_frame": round(1000 * elapsed / max(1, len(results)), 2),
        "norm_method": norm_method,
        "camera_motion_frames": camera_motion_count,
        "camera_motion_pct": round(100 * camera_motion_count / max(1, len(results)), 1),
        # Break down which signal fired. Useful for tuning thresholds:
        # if flow_only >> shake_only, ORB threshold may be too high.
        # if shake_only >> flow_only, flow_min_absolute may be too strict.
        "camera_motion_by_source": {
            "flow_only": flow_only_count,
            "shake_only": shake_only_count,
            "both": both_count,
        },
        # Shake-signal trust breakdown — of the frames where the raw ORB
        # shake signal fired (shake_camera_motion=1), how many were
        # actually trusted (masked mode → contributed to the flag) vs
        # untrusted (fallback mode → reported in CSV but ignored)?
        # If shake_untrusted >> shake_trusted, your footage has texture-poor
        # background that's starving the masked path. Consider tuning
        # Module 5's min_area upward so ROI boxes are smaller.
        "shake_trust_breakdown": {
            "raw_shake_fired": shake_raw_count,
            "trusted_masked": shake_trusted_count,
            "untrusted_fallback": shake_untrusted_count,
        },
        # Break down ORB detection mode — masked (preferred, ROI excluded)
        # vs unmasked_fallback (ROI covered too much texture, had to retry
        # without mask to avoid signal starvation). If unmasked_fallback
        # is high on real footage, consider raising min_area in Module 5
        # so ROI boxes don't over-cover background texture.
        "orb_detect_mode_breakdown": {
            "masked": masked_count,
            "unmasked_fallback": unmasked_fallback_count,
            "cold_start": cold_start_count,
        },
        "shake_score_stats": {
            "min": round(min(shakes), 4) if shakes else 0,
            "max": round(max(shakes), 4) if shakes else 0,
            "median": round(float(np.median(shakes)), 4) if shakes else 0,
        },
        "blur_score_stats": {
            "min": round(min(blurs), 4) if blurs else 0,
            "max": round(max(blurs), 4) if blurs else 0,
            "median": round(float(np.median(blurs)), 4) if blurs else 0,
        },
        "brightness_jump_stats": {
            "min": round(min(bjumps), 4) if bjumps else 0,
            "max": round(max(bjumps), 4) if bjumps else 0,
            "median": round(float(np.median(bjumps)), 4) if bjumps else 0,
        },
        "q_observability_stats": {
            "min": round(min(qs), 4) if qs else 0,
            "max": round(max(qs), 4) if qs else 0,
            "median": round(float(np.median(qs)), 4) if qs else 0,
        },
        "analyzer_summary": analyzer.summary(),
        "out_csv": str(out_csv_path),
    }
    return summary


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="ExamVision Module 6: camera & video quality analysis."
    )
    parser.add_argument(
        "--frames-dir", required=True,
        help="Directory of sampled frames (from Module 2). Must contain manifest.json."
    )
    parser.add_argument(
        "--flow-dir", default=None,
        help="Directory of optical flow .npy files (from Module 3). Optional."
    )
    parser.add_argument(
        "--rois-json", default=None,
        help="rois_per_frame.json (from Module 5). Optional — used for local-flow comparison."
    )
    parser.add_argument(
        "--motion-csv", default=None,
        help="motion.csv (from Module 3). Optional — used for timestamp/score lookup."
    )
    parser.add_argument(
        "--out", required=True,
        help="Output CSV path for per-frame quality scores."
    )
    parser.add_argument("--orb-match-min", type=int, default=10,
                        help="Min ORB matches to attempt RANSAC (default 10).")
    parser.add_argument("--brightness-window", type=int, default=10,
                        help="Brightness jump window size (default 10 frames).")
    parser.add_argument("--flow-ratio", type=float, default=0.8,
                        help="global/local flow ratio for camera-motion flag (default 0.8).")
    parser.add_argument("--flow-min-absolute", type=float, default=0.5,
                        help="Minimum global flow magnitude to trust the flow-ratio "
                             "test (default 0.5 px). Prevents comparing noise to "
                             "noise on near-static frames.")
    parser.add_argument("--shake-flag-threshold", type=float, default=2.0,
                        help="ORB weighted shake score above which to flag camera "
                             "motion (default 2.0). shake_score = magnitude × inlier_ratio. "
                             "Only trusted when ORB used masked-mode detection.")
    parser.add_argument("--fallback-shake-q-discount", type=float, default=0.3,
                        help="Discount factor applied to the shake contribution to "
                             "Q_observability when ORB fell back to unmasked detection "
                             "(default 0.3 = 30%% weight). 1.0 = no discount (re-introduces "
                             "inversion bug on texture-poor footage). 0.0 = fully ignore "
                             "fallback shake for Q (loses signal entirely).")
    parser.add_argument("--shake-max", type=float, default=20.0,
                        help="Max shake for fixed-scale penalty (default 20.0 px).")
    parser.add_argument("--blur-min", type=float, default=50.0,
                        help="Min Laplacian variance for fixed-scale penalty (default 50.0).")
    parser.add_argument("--brightness-max", type=float, default=40.0,
                        help="Max brightness jump for fixed-scale penalty (default 40.0).")
    parser.add_argument("--norm-low-pct", type=float, default=5.0,
                        help="Lower percentile for normalization (default 5.0).")
    parser.add_argument("--norm-high-pct", type=float, default=95.0,
                        help="Upper percentile for normalization (default 95.0).")
    parser.add_argument("--no-percentile-norm", action="store_true",
                        help="Disable retroactive percentile normalization; use fixed-scale.")
    args = parser.parse_args()

    summary = run_on_dirs(
        frames_dir=args.frames_dir,
        flow_dir=args.flow_dir,
        rois_json=args.rois_json,
        motion_csv=args.motion_csv,
        out_csv=args.out,
        orb_match_min=args.orb_match_min,
        brightness_window=args.brightness_window,
        flow_global_local_ratio=args.flow_ratio,
        flow_min_absolute=args.flow_min_absolute,
        shake_flag_threshold=args.shake_flag_threshold,
        fallback_shake_q_discount=args.fallback_shake_q_discount,
        shake_max=args.shake_max,
        blur_min=args.blur_min,
        brightness_max=args.brightness_max,
        norm_low_pct=args.norm_low_pct,
        norm_high_pct=args.norm_high_pct,
        use_percentile_norm=not args.no_percentile_norm,
    )

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
