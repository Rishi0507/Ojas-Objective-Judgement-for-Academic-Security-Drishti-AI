package main

import "testing"

// The 10.6 guarantee is that nothing reaches an investigator that cannot name
// the evidence it rests on. On the footage tested so far every claim happens to
// carry both a box and a frame, so the rejection path never executes in a normal
// run — exactly the kind of safety check that quietly rots into a no-op. These
// cases exercise it directly.
func TestValidateGrounding(t *testing.T) {
	box := []int{10, 10, 50, 50}
	frames := []string{"/api/annotated?frame=7"}

	cases := []struct {
		name     string
		in       Explanation
		wantOK   bool
		wantKind string
	}{
		{
			name:     "box and frame is fully grounded",
			in:       Explanation{Claim: "phone in hand", ObjectBBox: box, SupportingFrameURLs: frames},
			wantOK:   true,
			wantKind: "full",
		},
		{
			name:     "ROI substitutes for a missing object box",
			in:       Explanation{Claim: "crowd forming", ROI: box, SupportingFrameURLs: frames},
			wantOK:   true,
			wantKind: "full",
		},
		{
			name:     "box without a retrievable frame is spatial only",
			in:       Explanation{Claim: "phone in hand", ObjectBBox: box},
			wantOK:   true,
			wantKind: "spatial",
		},
		{
			name:     "frame without a box is temporal only",
			in:       Explanation{Claim: "motion peaked", SupportingFrameURLs: frames},
			wantOK:   true,
			wantKind: "temporal",
		},
		{
			name:   "no box and no frame is dropped, not downgraded",
			in:     Explanation{Claim: "suspicious behaviour"},
			wantOK: false,
		},
		{
			name:   "an empty claim is dropped even when fully evidenced",
			in:     Explanation{Claim: "   ", ObjectBBox: box, SupportingFrameURLs: frames},
			wantOK: false,
		},
		{
			name:   "a malformed box does not count as spatial grounding",
			in:     Explanation{Claim: "phone in hand", ObjectBBox: []int{10, 10}},
			wantOK: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := validateGrounding(tc.in)
			if ok != tc.wantOK {
				t.Fatalf("emitted=%v, want %v", ok, tc.wantOK)
			}
			if !ok {
				return
			}
			if got.Grounding != tc.wantKind {
				t.Errorf("grounding=%q, want %q", got.Grounding, tc.wantKind)
			}
			// An emitted claim always states its caveat, so the UI never has to
			// decide what a blank uncertainty field means.
			if got.UncertaintyReason == "" {
				t.Error("emitted an explanation with no uncertainty reason")
			}
		})
	}
}

// The grid mapping runs on processing-resolution coordinates. Getting the
// division backwards would put every subject in one cell and make the region
// z-scores meaningless without failing anything visibly.
func TestRegionFor(t *testing.T) {
	rb := &regionBaselines{FrameResolution: []int{640, 480}, Grid: []int{4, 3}}

	cases := []struct {
		x, y int
		want string
	}{
		{0, 0, "r0c0"},          // top-left corner
		{639, 479, "r2c3"},      // bottom-right corner, in range
		{640, 480, "r2c3"},      // exactly on the boundary — must clamp, not overflow
		{320, 240, "r1c2"},      // centre
		{100, 400, "r2c0"},      // bottom-left
	}
	for _, tc := range cases {
		if got := rb.regionFor(tc.x, tc.y); got != tc.want {
			t.Errorf("regionFor(%d,%d)=%q, want %q", tc.x, tc.y, got, tc.want)
		}
	}

	// A nil baseline set is the normal state when Module 10.4 did not run.
	var missing *regionBaselines
	if r, z := missing.annotate([]int{0, 0, 10, 10}, nil, 0); r != "" || z != 0 {
		t.Errorf("nil baselines should annotate nothing, got %q/%v", r, z)
	}
}
