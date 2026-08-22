package main

import (
	"fmt"
	"math"
	"sort"
)

// Micro-motion offence detection from body keypoints.
//
// Bounding boxes can say where a person is, never which way they are facing
// or where their hands are — so head turns, signalling and reaching toward a
// neighbour are invisible to box-only detection. These are derived from the
// 17 COCO joints emitted per person by the pose model.
//
// Two properties of real CCTV footage shape everything below:
//
//   - Joint confidence varies enormously. On seated candidates the upper body
//     is dependable (shoulders and nose typically >0.9) while legs are noise
//     (ankles ~0.03) because desks occlude them. Every measurement here is
//     therefore gated on the confidence of the specific joints it needs, and
//     nothing depends on the lower body.
//
//   - Scale varies with distance from camera. All thresholds are expressed as
//     ratios of the person's own shoulder width, so someone at the back of the
//     hall is measured the same way as someone at the front.

const (
	// Below this a joint is a guess rather than an observation.
	minKeypointConf = 0.50

	// How far the head must swing from this person's own resting yaw to count
	// as a turn. A still person's yaw was measured holding to ±0.03 over eight
	// consecutive frames, so this sits an order of magnitude above measurement
	// noise while remaining reachable: someone facing forward who looks to a
	// neighbour moves roughly 0.5-0.7 on this scale.
	headTurnDeviationThreshold = 0.35

	// Minimum observations before a resting posture can be claimed. Too few
	// and the median is just one of the samples, so a genuine turn would
	// define the baseline it is meant to deviate from.
	headTurnMinBaselineSamples = 4

	// A turn must persist across this many sampled frames to count. At 5fps
	// that is ~0.4s, which separates a deliberate look from detector jitter
	// or a head bobbing while writing.
	headTurnMinFrames = 2

	// Wrist above the shoulder line reads as a raised hand / signal.
	// Requiring clear separation avoids firing on someone resting a hand.
	handRaiseMargin = 0.15

	// How close two people's wrists must come, in TORSO lengths, to read as a
	// possible hand-off.
	//
	// Scale used to be |leftShoulder.X - rightShoulder.X|, which is a
	// horizontal projection rather than a size: it collapses toward zero as
	// someone turns, and measured on one frame of this footage it ranged 9px
	// to 72px across people at the same depth. Normalising by a quantity that
	// varies 8x between subjects turned "0.8 shoulder widths" into a random
	// per-person pixel threshold. Shoulder-to-hip length is invariant to that
	// rotation, so it is the stable scale.
	//
	// Re-measured against torso length, cross-person wrist gaps run median
	// 2.95 with p25 at 1.83, so 0.35 sits well inside the tail. Adjacent
	// candidates at neighbouring terminals are legitimately close in image
	// space, which is why a permissive bar fired constantly in a full room.
	handProximityThreshold = 0.35

	// A hand-off must persist across this many sampled frames. Wrist jitter is
	// independent between frames and rarely repeats, whereas a real pass takes
	// appreciable time. Single-frame firing was the other half of the noise:
	// every report had StartSec == EndSec.
	handProximityMinFrames = 2

	// Absolute yaw at which a head is turned so far it is worth reporting
	// regardless of that person's resting posture.
	//
	// Deviation-from-baseline alone has a blind spot: someone who sits turned
	// for most of a segment makes that their own median, so they never deviate
	// from it and are never flagged - exactly the fully-turned candidate a
	// reviewer notices first. A documented seated-angle offset reached 0.65,
	// so this sits above that: the nose is essentially over a shoulder.
	headTurnAbsoluteThreshold = 0.80

	// Above this share of the smaller person box lying inside the larger, the
	// two "people" are one person detected twice rather than two individuals.
	//
	// YOLO duplicates a subject who is partly occluded or cut by the frame
	// edge, tracking then assigns each box its own ID, and comparing one
	// person's wrist against their own duplicate yields a near-zero gap - a
	// guaranteed hand-off report. Measured on this footage: a duplicated
	// subject at the frame edge had boxes [0,145,122,400] and [0,147,82,296],
	// 87% containment and a wrist gap of 0.021, while two genuinely different
	// candidates at adjacent terminals sat at 19% containment. The bar sits
	// between those.
	sameSubjectContainment = 0.50
)

// keypointIndex maps COCO joint names to their position in the array.
var keypointIndex = map[string]int{
	"nose": 0, "left_eye": 1, "right_eye": 2, "left_ear": 3, "right_ear": 4,
	"left_shoulder": 5, "right_shoulder": 6, "left_elbow": 7, "right_elbow": 8,
	"left_wrist": 9, "right_wrist": 10, "left_hip": 11, "right_hip": 12,
	"left_knee": 13, "right_knee": 14, "left_ankle": 15, "right_ankle": 16,
}

// joint returns a named keypoint if it was observed confidently enough to use.
func joint(p YOLOPose, name string) (YOLOKeypoint, bool) {
	idx, ok := keypointIndex[name]
	if !ok || idx >= len(p.Keypoints) {
		return YOLOKeypoint{}, false
	}
	kp := p.Keypoints[idx]
	if kp.Conf < minKeypointConf {
		return YOLOKeypoint{}, false
	}
	return kp, true
}

// headYaw estimates how far a head is turned away from square-on: 0 is facing
// forward, ±1 is the nose fully over one shoulder. Sign gives direction —
// negative toward image-left, positive toward image-right.
//
// Shoulders are the reference rather than the face itself, because they stay
// put while someone glances sideways, so the nose drifting off their midline
// is precisely the movement worth catching.
//
// The measure is the *relative* difference in horizontal distance from the
// nose to each shoulder, (dL-dR)/(dL+dR). An earlier version divided the nose
// offset by shoulder width, which blows up as someone turns side-on and that
// width collapses toward zero — on this footage it produced values up to 15.6
// where a ratio should stay near 1, making any threshold meaningless. This
// form is inherently bounded to [-1,1] and needs no scale normalisation,
// since both distances shrink together with the person.
//
func headYaw(p YOLOPose) (float64, bool) {
	nose, okN := joint(p, "nose")
	lSho, okL := joint(p, "left_shoulder")
	rSho, okR := joint(p, "right_shoulder")
	if !okN || !okL || !okR {
		return 0, false
	}

	dLeft := math.Abs(nose.X - lSho.X)
	dRight := math.Abs(nose.X - rSho.X)
	total := dLeft + dRight
	if total < 1e-6 {
		return 0, false
	}

	return (dLeft - dRight) / total, true
}

// medianFloat returns the median of a slice, used for a track's resting yaw.
// Median rather than mean so a genuine turn inside the window does not drag
// the baseline toward itself.
func medianFloat(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	mid := len(s) / 2
	if len(s)%2 == 1 {
		return s[mid]
	}
	return (s[mid-1] + s[mid]) / 2
}

// detectHeadTurns reports a sustained look away from where this person
// normally faces.
//
// Measured against the person's own resting posture, not against zero. Yaw is
// computed in image space, so a candidate seated at an angle to the camera has
// a large constant offset with their head perfectly still — one such person
// here held -0.65 ± 0.03 across eight consecutive frames and was reported as
// "sustained head turn" purely for sitting at an angle. Absolute yaw describes
// head *orientation*; a turn is a *change*, so the baseline is subtracted.
//
// The low spread of that measurement (±0.03) is also why no minimum-size gate
// is applied: keypoints stayed precise on a person only ~21px across the
// shoulders, so small subjects are not inherently untrustworthy here.
func detectHeadTurns(track PersonTrack, poses []TrackedPose) []Offence {
	var offences []Offence

	// Establish resting posture first.
	var yaws []float64
	for _, tp := range poses {
		if yaw, ok := headYaw(tp.Pose); ok {
			yaws = append(yaws, yaw)
		}
	}
	if len(yaws) < headTurnMinBaselineSamples {
		return nil // too few observations to know what "normal" looks like
	}
	baseline := medianFloat(yaws)

	var runPeak float64
	var runPeakFrame int
	consecutive := 0
	var startTime float64
	var startFrame int

	for i, tp := range poses {
		yaw, ok := headYaw(tp.Pose)
		deviation := yaw - baseline
		// Two independent ways to be turned. Deviation catches someone who
		// looks away from how they normally sit. The absolute test covers the
		// case deviation cannot see: a candidate turned for most of the
		// segment makes that posture their own median, so they never deviate
		// from it however far round they are facing.
		turned := ok && (math.Abs(deviation) > headTurnDeviationThreshold ||
			math.Abs(yaw) > headTurnAbsoluteThreshold)

		if turned {
			// Magnitude is whichever test is more extreme, so a sustained
			// absolute turn is not reported with a near-zero deviation.
			magnitude := math.Max(math.Abs(deviation), math.Abs(yaw))
			if consecutive == 0 {
				startTime = tp.TimestampSec
				startFrame = tp.FrameIdx
				runPeak = magnitude
				runPeakFrame = tp.FrameIdx
			}
			consecutive++
			if magnitude > runPeak {
				runPeak = magnitude
				runPeakFrame = tp.FrameIdx
			}
			continue
		}

		if consecutive >= headTurnMinFrames {
			direction := "left"
			if yawSignAt(poses, startFrame) > baseline {
				direction = "right"
			}

			offences = append(offences, Offence{
				Type:        "head_turn",
				Label:       fmt.Sprintf("Head turned %s, away from their usual posture", direction),
				TrackID:     track.TrackID,
				StartSec:    startTime,
				EndSec:      poses[i-1].TimestampSec,
				FrameIdx:    runPeakFrame,
				Confidence:  math.Min(1.0, runPeak/1.2),
				DurationSec: poses[i-1].TimestampSec - startTime,
			})
		}
		consecutive = 0
	}

	// A turn still in progress when the event ends.
	if consecutive >= headTurnMinFrames {
		last := poses[len(poses)-1]
		direction := "left"
		if yawSignAt(poses, startFrame) > 0 {
			direction = "right"
		}
		offences = append(offences, Offence{
			Type:        "head_turn",
			Label:       fmt.Sprintf("Head turned %s, away from their usual posture", direction),
			TrackID:     track.TrackID,
			StartSec:    startTime,
			EndSec:      last.TimestampSec,
			FrameIdx:    runPeakFrame,
			Confidence:  math.Min(1.0, runPeak/1.2),
			DurationSec: last.TimestampSec - startTime,
		})
	}

	return offences
}

// yawSignAt reports which way the head was turned at a given frame.
func yawSignAt(poses []TrackedPose, frameIdx int) float64 {
	for _, tp := range poses {
		if tp.FrameIdx == frameIdx {
			if yaw, ok := headYaw(tp.Pose); ok {
				return yaw
			}
		}
	}
	return -1
}

// detectHandGestures reports a wrist lifted clearly above the shoulder line —
// the signalling posture. Writing and page-turning keep hands low, so the
// shoulder line separates the two well without needing gesture classification.
func detectHandGestures(track PersonTrack, poses []TrackedPose) []Offence {
	var offences []Offence

	for _, tp := range poses {
		lSho, okL := joint(tp.Pose, "left_shoulder")
		rSho, okR := joint(tp.Pose, "right_shoulder")
		if !okL || !okR {
			continue
		}
		shoulderY := (lSho.Y + rSho.Y) / 2
		shoulderWidth := math.Abs(lSho.X - rSho.X)
		if shoulderWidth < 1 {
			continue
		}

		for _, side := range []string{"left_wrist", "right_wrist"} {
			wrist, ok := joint(tp.Pose, side)
			if !ok {
				continue
			}
			// Image Y grows downward, so "above" is a smaller Y.
			lift := (shoulderY - wrist.Y) / shoulderWidth
			if lift > handRaiseMargin {
				offences = append(offences, Offence{
					Type:       "hand_gesture",
					Label:      "Hand raised above shoulder (possible signalling)",
					TrackID:    track.TrackID,
					StartSec:   tp.TimestampSec,
					EndSec:     tp.TimestampSec,
					FrameIdx:   tp.FrameIdx,
					Confidence: math.Min(1.0, wrist.Conf),
				})
				return offences // one report per track is enough
			}
		}
	}

	return offences
}

// detectHandProximity reports two people's hands coming close together — the
// physical shape of passing something.
//
// Requires the two wrists to be near each other, not merely one wrist inside
// the other person's bounding box, which is what this previously tested. A box
// is an axis-aligned rectangle containing a great deal of desk and empty air,
// so in a hall where candidates sit shoulder to shoulder those boxes overlap
// and a hand can be "inside" a neighbour without being anywhere near them.
// Measured on this footage, 23% of all confidently-detected wrists fell inside
// some other person's box purely from seating density — a quarter of every
// hand in the room, which is why this fired 14 times in 88 seconds.
//
// Wrist-to-wrist separation separates the cases properly: its median is 8.1
// shoulder widths and only 2% of pairs come within 1.0, so closeness here is
// genuinely unusual rather than the default state of a crowded room.
// torsoLength is the shoulder-line-to-hip-line distance: a size measure that
// survives someone turning in their seat, unlike horizontal shoulder spread.
func torsoLength(pose YOLOPose) (float64, bool) {
	lSho, okL := joint(pose, "left_shoulder")
	rSho, okR := joint(pose, "right_shoulder")
	if !okL || !okR {
		return 0, false
	}
	shoulderY := (lSho.Y + rSho.Y) / 2

	var hipYs []float64
	if lHip, ok := joint(pose, "left_hip"); ok {
		hipYs = append(hipYs, lHip.Y)
	}
	if rHip, ok := joint(pose, "right_hip"); ok {
		hipYs = append(hipYs, rHip.Y)
	}
	if len(hipYs) == 0 {
		return 0, false
	}
	hipY := 0.0
	for _, y := range hipYs {
		hipY += y
	}
	hipY /= float64(len(hipYs))

	length := math.Abs(hipY - shoulderY)
	if length < 1 {
		return 0, false
	}
	return length, true
}

// sameSubject reports whether two person boxes are one individual detected
// twice. Containment rather than IoU: a duplicate is typically nested inside
// the larger box, which drags IoU down (0.39 in the measured case) while
// containment stays decisive (0.87).
func sameSubject(a, b []int) bool {
	if len(a) != 4 || len(b) != 4 {
		return false
	}
	x1, y1 := math.Max(float64(a[0]), float64(b[0])), math.Max(float64(a[1]), float64(b[1]))
	x2, y2 := math.Min(float64(a[2]), float64(b[2])), math.Min(float64(a[3]), float64(b[3]))
	if x2 <= x1 || y2 <= y1 {
		return false
	}
	inter := (x2 - x1) * (y2 - y1)
	areaA := float64((a[2] - a[0]) * (a[3] - a[1]))
	areaB := float64((b[2] - b[0]) * (b[3] - b[1]))
	smaller := math.Min(areaA, areaB)
	if smaller <= 0 {
		return false
	}
	return inter/smaller > sameSubjectContainment
}

// detectHandProximity reports one person's hands coming close to another's.
//
// Reports one finding per pair, attributed to the lower track ID, so a single
// contact is not reported twice from both sides.
func detectHandProximity(track PersonTrack, poses []TrackedPose, posesByTrack map[string][]TrackedPose) []Offence {
	// frames on which this person's wrists were close to each other person's
	type contact struct {
		frames []int
		times  []float64
		peak   float64
		peakAt int
		peakTs float64
	}
	contacts := map[string]*contact{}

	for _, tp := range poses {
		scale, ok := torsoLength(tp.Pose)
		if !ok {
			continue
		}

		for _, side := range []string{"left_wrist", "right_wrist"} {
			wrist, ok := joint(tp.Pose, side)
			if !ok {
				continue // occluded hands stay unreported rather than guessed at
			}

			for otherID, otherPoses := range posesByTrack {
				if otherID == track.TrackID {
					continue
				}
				for _, otp := range otherPoses {
					if otp.FrameIdx != tp.FrameIdx {
						continue
					}
					if sameSubject(tp.Pose.BBox, otp.Pose.BBox) {
						break // same person under two track IDs
					}
					for _, oside := range []string{"left_wrist", "right_wrist"} {
						ow, ook := joint(otp.Pose, oside)
						if !ook {
							continue
						}
						gap := math.Hypot(wrist.X-ow.X, wrist.Y-ow.Y) / scale
						if gap > handProximityThreshold {
							continue
						}
						c := contacts[otherID]
						if c == nil {
							c = &contact{peak: math.MaxFloat64}
							contacts[otherID] = c
						}
						if n := len(c.frames); n == 0 || c.frames[n-1] != tp.FrameIdx {
							c.frames = append(c.frames, tp.FrameIdx)
							c.times = append(c.times, tp.TimestampSec)
						}
						if gap < c.peak {
							c.peak = gap
							c.peakAt = tp.FrameIdx
							c.peakTs = tp.TimestampSec
						}
					}
					break
				}
			}
		}
	}

	var offences []Offence
	for otherID, c := range contacts {
		if len(c.frames) < handProximityMinFrames {
			continue // a single frame is jitter, not a hand-off
		}
		// Attribute the pair once, to the lower ID, so the reciprocal
		// detection on the other track does not duplicate it.
		if track.TrackID > otherID {
			continue
		}
		offences = append(offences, Offence{
			Type:        "hand_proximity",
			Label:       fmt.Sprintf("Hands close to %s over %d frames - possible hand-off", otherID, len(c.frames)),
			TrackID:     track.TrackID,
			StartSec:    c.times[0],
			EndSec:      c.times[len(c.times)-1],
			FrameIdx:    c.peakAt,
			Confidence:  math.Min(1.0, (handProximityThreshold-c.peak)/handProximityThreshold),
			DurationSec: c.times[len(c.times)-1] - c.times[0],
			Count:       2,
		})
	}

	return offences
}

// TrackedPose is one person's skeleton at one moment, already associated
// with a track so findings can be attributed to a specific individual.
type TrackedPose struct {
	FrameIdx     int
	TimestampSec float64
	Pose         YOLOPose
}

// analyseMicroMotions runs every keypoint-based detector for one event.
func analyseMicroMotions(tracks []PersonTrack, posesByTrack map[string][]TrackedPose) []Offence {
	var offences []Offence
	for _, track := range tracks {
		poses := posesByTrack[track.TrackID]
		if len(poses) < headTurnMinFrames {
			continue
		}
		offences = append(offences, detectHeadTurns(track, poses)...)
		offences = append(offences, detectHandGestures(track, poses)...)
		offences = append(offences, detectHandProximity(track, poses, posesByTrack)...)
	}
	return offences
}

// assignPosesToTracks matches each frame's skeletons to the tracked people by
// bounding-box overlap. Pose runs on the whole frame and knows nothing about
// track identity, so without this step findings could not be attributed to a
// person, and "the same candidate turned around four times" would be
// unstateable.
func assignPosesToTracks(tracks []PersonTrack, frames []PoseFrame) map[string][]TrackedPose {
	result := make(map[string][]TrackedPose)

	for _, pf := range frames {
		for _, person := range pf.People {
			if len(person.BBox) != 4 {
				continue
			}
			bestTrack, bestIOU := "", 0.0
			for _, track := range tracks {
				for _, tb := range track.BBoxes {
					if tb.FrameIdx != pf.FrameIdx {
						continue
					}
					iou := boxIOU(person.BBox, []int{tb.X1, tb.Y1, tb.X2, tb.Y2})
					if iou > bestIOU {
						bestIOU, bestTrack = iou, track.TrackID
					}
					break
				}
			}
			if bestTrack != "" && bestIOU > 0.3 {
				result[bestTrack] = append(result[bestTrack], TrackedPose{
					FrameIdx:     pf.FrameIdx,
					TimestampSec: pf.TimestampSec,
					Pose:         person,
				})
			}
		}
	}

	return result
}

func boxIOU(a, b []int) float64 {
	x1 := math.Max(float64(a[0]), float64(b[0]))
	y1 := math.Max(float64(a[1]), float64(b[1]))
	x2 := math.Min(float64(a[2]), float64(b[2]))
	y2 := math.Min(float64(a[3]), float64(b[3]))
	if x2 <= x1 || y2 <= y1 {
		return 0
	}
	inter := (x2 - x1) * (y2 - y1)
	areaA := float64((a[2] - a[0]) * (a[3] - a[1]))
	areaB := float64((b[2] - b[0]) * (b[3] - b[1]))
	union := areaA + areaB - inter
	if union <= 0 {
		return 0
	}
	return inter / union
}
