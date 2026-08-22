package main

import (
	"fmt"
	"math"
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

	// Bounded head-yaw magnitude (see headYaw) above which a head counts as
	// turned. Chosen from the observed distribution on this footage rather
	// than picked a priori: ordinary seated posture sits around 0.31 and the
	// 90th percentile is 0.68, so this flags the clear tail without firing
	// on someone merely leaning over their own paper.
	headTurnYawThreshold = 0.65

	// A turn must persist across this many sampled frames to count. At 5fps
	// that is ~0.4s, which separates a deliberate look from detector jitter
	// or a head bobbing while writing.
	headTurnMinFrames = 2

	// Wrist above the shoulder line reads as a raised hand / signal.
	// Requiring clear separation avoids firing on someone resting a hand.
	handRaiseMargin = 0.15

	// How far a wrist may sit from the person's own centre, in shoulder
	// widths, before it counts as reaching outward rather than working.
	reachDistanceThreshold = 1.6
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
// Measured on real footage here: median 0.31 for ordinary seated posture,
// p90 0.68 — so headTurnYawThreshold sits above normal fidgeting rather than
// at an arbitrary round number.
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

// detectHeadTurns reports sustained sideways looks — the "checking a
// neighbour's paper" pattern. Requires the deviation to hold across several
// consecutive observations so ordinary head movement while writing is ignored.
func detectHeadTurns(track PersonTrack, poses []TrackedPose) []Offence {
	var offences []Offence

	var runPeak float64
	var runPeakFrame int
	consecutive := 0
	var startTime float64
	var startFrame int

	for i, tp := range poses {
		yaw, ok := headYaw(tp.Pose)
		turned := ok && math.Abs(yaw) > headTurnYawThreshold

		if turned {
			if consecutive == 0 {
				startTime = tp.TimestampSec
				startFrame = tp.FrameIdx
				runPeak = math.Abs(yaw)
				runPeakFrame = tp.FrameIdx
			}
			consecutive++
			if math.Abs(yaw) > runPeak {
				runPeak = math.Abs(yaw)
				runPeakFrame = tp.FrameIdx
			}
			continue
		}

		if consecutive >= headTurnMinFrames {
			direction := "left"
			if yawSignAt(poses, startFrame) > 0 {
				direction = "right"
			}

			offences = append(offences, Offence{
				Type:        "head_turn",
				Label:       fmt.Sprintf("Sustained head turn to the %s (looking away from own desk)", direction),
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
			Label:       fmt.Sprintf("Sustained head turn to the %s (looking away from own desk)", direction),
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

// detectNeighbourReach reports a wrist extended well outside the person's own
// working area toward someone else — the physical shape of passing something,
// which a proximity test between two bounding boxes cannot distinguish from
// simply sitting close together.
func detectNeighbourReach(track PersonTrack, poses []TrackedPose, others []PersonTrack) []Offence {
	var offences []Offence

	for _, tp := range poses {
		lSho, okL := joint(tp.Pose, "left_shoulder")
		rSho, okR := joint(tp.Pose, "right_shoulder")
		if !okL || !okR {
			continue
		}
		centreX := (lSho.X + rSho.X) / 2
		centreY := (lSho.Y + rSho.Y) / 2
		shoulderWidth := math.Abs(lSho.X - rSho.X)
		if shoulderWidth < 1 {
			continue
		}

		for _, side := range []string{"left_wrist", "right_wrist"} {
			wrist, ok := joint(tp.Pose, side)
			if !ok {
				continue
			}
			reach := math.Hypot(wrist.X-centreX, wrist.Y-centreY) / shoulderWidth
			if reach < reachDistanceThreshold {
				continue
			}

			// Only meaningful if the hand is heading toward another person.
			for _, other := range others {
				if other.TrackID == track.TrackID {
					continue
				}
				for _, ob := range other.BBoxes {
					if ob.FrameIdx != tp.FrameIdx {
						continue
					}
					if int(wrist.X) >= ob.X1 && int(wrist.X) <= ob.X2 &&
						int(wrist.Y) >= ob.Y1 && int(wrist.Y) <= ob.Y2 {
						offences = append(offences, Offence{
							Type:       "neighbour_reach",
							Label:      fmt.Sprintf("Reached toward %s (possible hand-off)", other.TrackID),
							TrackID:    track.TrackID,
							StartSec:   tp.TimestampSec,
							EndSec:     tp.TimestampSec,
							FrameIdx:   tp.FrameIdx,
							Confidence: math.Min(1.0, wrist.Conf),
							BBox:       []int{ob.X1, ob.Y1, ob.X2, ob.Y2},
							Count:      2,
						})
						return offences
					}
					break
				}
			}
		}
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
		offences = append(offences, detectNeighbourReach(track, poses, tracks)...)
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
