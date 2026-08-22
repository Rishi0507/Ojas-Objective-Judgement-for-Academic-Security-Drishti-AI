package main

// Feature 10.4 — per-region normality, consumed.
//
// module10_region_baseline.py learns, per grid cell, what motion is normal in
// THIS video, and flags frames where a cell departs from its own baseline by
// more than z sigma. That matters because a single global motion threshold has
// to generalise across halls, camera heights and lighting, and does not: the
// doorway region in this footage sits at mu=1.18 while the back wall sits at
// mu=0.00, so any one threshold is either deaf in the doorway or hallucinating
// at the wall.
//
// Without this file the baselines were computed and written to disk and then
// read by nobody — a stage that costs time and proves nothing. Here each
// offence is annotated with how unusual its own region was at that moment, so
// "abnormal for this part of this room" becomes a citable number attached to
// the claim rather than an unstated assumption behind it.
//
// Advisory only. It annotates offences, it never creates or suppresses them:
// a z-score says the pixels moved unusually, not that a person cheated.

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"math"
)

// regionAnomaly is one (frame, region) pair that exceeded its own baseline.
type regionAnomaly struct {
	FrameIdx int     `json:"frame_idx"`
	Region   string  `json:"region"`
	Z        float64 `json:"z"`
}

type regionStats struct {
	Mu      float64 `json:"mu"`
	Sigma   float64 `json:"sigma"`
	Samples int     `json:"samples"`
}

type regionBaselines struct {
	FrameResolution []int                  `json:"frame_resolution"`
	Grid            []int                  `json:"grid"` // [cols, rows]
	ZThreshold      float64                `json:"z_threshold"`
	Regions         map[string]regionStats `json:"regions"`
	Anomalies       []regionAnomaly        `json:"anomalies"`

	// byFrame indexes Anomalies for O(1) lookup; the raw slice is a flat list
	// that would otherwise be rescanned once per offence.
	byFrame map[int][]regionAnomaly
}

// loadRegionBaselines reads Module 10.4's output. A missing file is not an
// error: the stage is skippable and the rest of the pipeline must not depend
// on it having run.
func loadRegionBaselines(path string) *regionBaselines {
	data, err := ioutil.ReadFile(path)
	if err != nil {
		log.Printf("[10.4] no region baselines at %s — offences will carry no region context", path)
		return nil
	}
	var rb regionBaselines
	if err := json.Unmarshal(data, &rb); err != nil {
		log.Printf("[10.4] region baselines unreadable: %v", err)
		return nil
	}
	if len(rb.Grid) != 2 || rb.Grid[0] < 1 || rb.Grid[1] < 1 {
		log.Printf("[10.4] region baselines have no usable grid — ignoring")
		return nil
	}

	rb.byFrame = make(map[int][]regionAnomaly, len(rb.Anomalies))
	for _, a := range rb.Anomalies {
		rb.byFrame[a.FrameIdx] = append(rb.byFrame[a.FrameIdx], a)
	}
	log.Printf("[10.4] loaded baselines for %d regions, %d anomalous region-frames (z>%.1f)",
		len(rb.Regions), len(rb.Anomalies), rb.ZThreshold)
	return &rb
}

// regionFor names the grid cell containing a point, in the same rNcM scheme
// the Python side writes. Coordinates are in processing resolution, which is
// also what the baselines were computed in — mixing the two would silently
// map every subject to the top-left cell on a downscaled run.
func (rb *regionBaselines) regionFor(x, y int) string {
	if rb == nil || len(rb.FrameResolution) != 2 {
		return ""
	}
	w, h := rb.FrameResolution[0], rb.FrameResolution[1]
	if w <= 0 || h <= 0 {
		return ""
	}
	cols, rows := rb.Grid[0], rb.Grid[1]

	col := x * cols / w
	row := y * rows / h
	// Clamp: a box edge landing exactly on the frame boundary would otherwise
	// index one cell past the grid.
	col = clampInt(col, 0, cols-1)
	row = clampInt(row, 0, rows-1)
	return fmt.Sprintf("r%dc%d", row, col)
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// annotate attaches region context to one offence, using the centre of its
// box (or the ROI's centre when the offence has no box of its own, as
// crowd_disturbance does not).
//
// Returns the region name and the z-score measured there at that frame. A
// z of 0 means the region was within its own normal range — which is itself
// worth recording, since it is the case where the geometry fired but the
// scene was not behaving unusually.
func (rb *regionBaselines) annotate(bbox []int, roi []int, frameIdx int) (string, float64) {
	if rb == nil {
		return "", 0
	}
	box := bbox
	if len(box) != 4 {
		box = roi
	}
	if len(box) != 4 {
		return "", 0
	}
	cx := (box[0] + box[2]) / 2
	cy := (box[1] + box[3]) / 2
	region := rb.regionFor(cx, cy)
	if region == "" {
		return "", 0
	}

	// Worst z recorded for this region on this frame. Python emits at most one
	// entry per (frame, region), but taking the max keeps this correct if that
	// ever changes rather than depending on it.
	var z float64
	for _, a := range rb.byFrame[frameIdx] {
		if a.Region == region && math.Abs(a.Z) > math.Abs(z) {
			z = a.Z
		}
	}
	return region, z
}
