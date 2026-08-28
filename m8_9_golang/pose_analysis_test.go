package main

import "testing"

// Tests for the two gates on detectHandGestures.
//
// The detector previously fired on a single frame with a wrist above the
// shoulder line, with no duration requirement and no locomotion gate. Three of
// the six confirmed false positives in evaluation/ground_truth.json are people
// walking down the aisle with an arm raised, and the adjudications record two
// findings produced from one frame each. These tests pin down both gates so
// that behaviour cannot come back unnoticed.

// poseAt builds a subject whose shoulders are 40px apart at y=200, with the
// left wrist placed liftRatio shoulder-widths above the shoulder line. The
// person box is centred on cx so a sequence of these can be made to walk.
func poseAt(cx float64, liftRatio float64) YOLOPose {
	const shoulderWidth = 40.0
	const shoulderY = 200.0

	kp := make([]YOLOKeypoint, 17)
	for i := range kp {
		kp[i] = YOLOKeypoint{Conf: 0.0} // unobserved unless set below
	}
	kp[keypointIndex["left_shoulder"]] = YOLOKeypoint{
		Name: "left_shoulder", X: cx - shoulderWidth/2, Y: shoulderY, Conf: 0.95,
	}
	kp[keypointIndex["right_shoulder"]] = YOLOKeypoint{
		Name: "right_shoulder", X: cx + shoulderWidth/2, Y: shoulderY, Conf: 0.95,
	}
	// Image Y grows downward, so a raised wrist has the smaller Y.
	kp[keypointIndex["left_wrist"]] = YOLOKeypoint{
		Name: "left_wrist", X: cx - 10, Y: shoulderY - liftRatio*shoulderWidth, Conf: 0.90,
	}

	return YOLOPose{
		BBox:       []int{int(cx - 20), 180, int(cx + 20), 400},
		Confidence: 0.9,
		Keypoints:  kp,
	}
}

// track builds a pose sequence. raisedFor frames carry a clear raise, the rest
// keep the hand below the shoulder line. stepPx is the per-frame drift of the
// subject, which is what the locomotion gate measures.
func track(frames int, raisedFor int, stepPx float64) []TrackedPose {
	var out []TrackedPose
	for i := 0; i < frames; i++ {
		lift := -0.30 // hand at the desk, well below the shoulder line
		if i < raisedFor {
			lift = 0.50 // clearly above handRaiseMargin (0.15)
		}
		out = append(out, TrackedPose{
			FrameIdx:     i,
			TimestampSec: float64(i) * 0.2,
			Pose:         poseAt(100+float64(i)*stepPx, lift),
		})
	}
	return out
}

var subject = PersonTrack{TrackID: "Track-01"}

func TestHandGestureSustainedRaiseIsReported(t *testing.T) {
	// Stationary subject, raise held for 4 frames: the case the detector exists
	// for. It must still fire, or the gates have broken real detection.
	got := detectHandGestures(subject, track(8, 4, 0))
	if len(got) != 1 {
		t.Fatalf("sustained raise by a stationary subject: got %d offences, want 1", len(got))
	}
	if got[0].Type != "hand_gesture" {
		t.Errorf("type = %q, want %q", got[0].Type, "hand_gesture")
	}
	if got[0].DurationSec <= 0 {
		t.Errorf("durationSec = %v, want > 0: a gated run has a real span", got[0].DurationSec)
	}
	if got[0].EndSec <= got[0].StartSec {
		t.Errorf("endSec %v must be after startSec %v", got[0].EndSec, got[0].StartSec)
	}
}

func TestHandGestureSingleFrameRaiseIsRejected(t *testing.T) {
	// The original bug: one frame above the line was a finding.
	if got := detectHandGestures(subject, track(8, 1, 0)); len(got) != 0 {
		t.Fatalf("single-frame raise: got %d offences, want 0", len(got))
	}
}

func TestHandGestureRaiseShorterThanMinimumIsRejected(t *testing.T) {
	// One frame below the threshold must not qualify, or the boundary is off.
	if got := detectHandGestures(subject, track(8, handRaiseMinFrames-1, 0)); len(got) != 0 {
		t.Fatalf("%d-frame raise: got %d offences, want 0", handRaiseMinFrames-1, len(got))
	}
}

func TestHandGestureExactMinimumIsReported(t *testing.T) {
	if got := detectHandGestures(subject, track(8, handRaiseMinFrames, 0)); len(got) != 1 {
		t.Fatalf("%d-frame raise: got %d offences, want 1", handRaiseMinFrames, len(got))
	}
}

func TestHandGestureWalkingSubjectIsRejected(t *testing.T) {
	// Sustained raise, but the subject crosses the frame: 8 frames at 30px on
	// 40px shoulders is ~5.25 shoulder-widths, in the 4.34-8.91 band the
	// measured walkers occupied and well above handRaiseMaxLocomotion.
	if got := detectHandGestures(subject, track(8, 6, 30)); len(got) != 0 {
		t.Fatalf("walking subject with a raised arm: got %d offences, want 0", len(got))
	}
}

func TestHandGestureSeatedDriftIsStillReported(t *testing.T) {
	// A seated subject shifting slightly must not be mistaken for a walker:
	// 8 frames at 2px is 0.35 shoulder-widths, inside the 0.04-0.33 band the
	// measured seated tracks occupied.
	if got := detectHandGestures(subject, track(8, 6, 2)); len(got) != 1 {
		t.Fatalf("seated subject with minor drift: got %d offences, want 1", len(got))
	}
}

func TestHandGestureHandsDownIsRejected(t *testing.T) {
	if got := detectHandGestures(subject, track(8, 0, 0)); len(got) != 0 {
		t.Fatalf("hands at the desk: got %d offences, want 0", len(got))
	}
}

func TestWristLiftNeedsBothShoulders(t *testing.T) {
	// Shoulders below minKeypointConf cannot scale the measurement, so no
	// finding may be derived from them.
	p := poseAt(100, 0.5)
	p.Keypoints[keypointIndex["left_shoulder"]].Conf = 0.10
	if _, _, ok := wristLift(p); ok {
		t.Fatal("wristLift succeeded with an unreliable shoulder keypoint")
	}
}

func TestWristLiftTakesTheHigherWrist(t *testing.T) {
	p := poseAt(100, 0.25)
	// Right wrist higher than the left; the measurement must follow it.
	p.Keypoints[keypointIndex["right_wrist"]] = YOLOKeypoint{
		Name: "right_wrist", X: 110, Y: 200 - 0.75*40, Conf: 0.90,
	}
	lift, _, ok := wristLift(p)
	if !ok {
		t.Fatal("wristLift failed on a well-formed pose")
	}
	if lift < 0.70 || lift > 0.80 {
		t.Errorf("lift = %v, want ~0.75 from the higher wrist", lift)
	}
}
