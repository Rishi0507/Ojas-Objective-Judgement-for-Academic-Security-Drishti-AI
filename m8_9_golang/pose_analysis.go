package main

import (
	"fmt"
	"log"
	"math"
	"sort"
)

// Micro-motion offence detection from body keypoints.
//
// Bounding boxes can say where a person is, never which way they are facing
// or where their hands are â€” so head turns, signalling and reaching toward a
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
	// as a turn. A still person's yaw was measured holding to Â±0.03 over eight
	// consecutive frames, so this sits an order of magnitude above measurement
	// noise while remaining reachable: someone facing forward who looks to a
	// neighbour moves roughly 0.5-0.7 on this scale.
	headTurnDeviationThreshold = 0.35

	// Minimum observations before a resting posture can be claimed. Too few
	// and the median is just one of the samples, so a genuine turn would
	// define the baseline it is meant to deviate from.
	headTurnMinBaselineSamples = 4

	// A turn must persist across this many sampled frames to count.
	//
	// Was 2, documented as "~0.4s at 5fps" - which was wrong arithmetic: two
	// frames span one interval, so 0.2s. That is not a head turn by any
	// definition, and it showed: a seated subject 44px wide, facing their own
	// monitor, was reported for a 0.20s "sustained" turn produced entirely by
	// pose jitter.
	//
	// 5 frames spans four intervals - about 0.8s at an effective 5fps, 1.0s at
	// the 4fps a 5fps request actually yields against 8fps source. A deliberate
	// look at a neighbour's screen lasts at least that; jitter does not persist
	// across five consecutive samples in one direction.
	headTurnMinFrames = 5

	// Below this shoulder width in pixels, head yaw cannot be measured.
	//
	// Yaw is (dLeft-dRight)/(dLeft+dRight), so shoulder width is effectively the
	// denominator: at 20px shoulders a 2px nose-keypoint wobble is 0.1 of yaw,
	// and a few of those in the same direction clear the 0.35 threshold without
	// the head having moved. At 40px the same wobble is 0.05. Set from the
	// measured distribution - see the [head_turn] shoulder log.
	headTurnMinShoulderPx = 0.0

	// Wrist above the shoulder line reads as a raised hand / signal.
	// Requiring clear separation avoids firing on someone resting a hand.
	handRaiseMargin = 0.15

	// A raised wrist must persist across this many sampled frames to count.
	//
	// There was previously no minimum at all: one frame with a wrist above the
	// shoulder line produced a finding. That is the same class of bug that gave
	// 0.20s "sustained" head turns before headTurnMinFrames was corrected, and
	// the adjudications in evaluation/ground_truth.json show what it cost - a
	// woman walking down the aisle with a hand at her own head, and a man
	// leaning toward a staff member, each reported off a single frame.
	//
	// 3 frames spans two intervals, roughly 0.4-0.5s at the effective sample
	// rate. A signal held up for a neighbour lasts at least that; a hand passing
	// through the shoulder line on its way somewhere else does not. It is
	// deliberately below headTurnMinFrames: a raise is a briefer act than a
	// sustained look, and analyseMicroMotions records what happened the last
	// time these two detectors were held to one shared minimum.
	handRaiseMinFrames = 3

	// hand_proximity was removed on request after review: on this footage its
	// findings did not survive eyeball checking. The measured rework that
	// preceded this removal (torso-length scaling, frame persistence,
	// duplicate-subject rejection) is retained below because those utilities
	// are sound and apply beyond that one detector.

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
// forward, Â±1 is the nose fully over one shoulder. Sign gives direction â€”
// negative toward image-left, positive toward image-right.
//
// Shoulders are the reference rather than the face itself, because they stay
// put while someone glances sideways, so the nose drifting off their midline
// is precisely the movement worth catching.
//
// The measure is the *relative* difference in horizontal distance from the
// nose to each shoulder, (dL-dR)/(dL+dR). An earlier version divided the nose
// offset by shoulder width, which blows up as someone turns side-on and that
// width collapses toward zero â€” on this footage it produced values up to 15.6
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
// a large constant offset with their head perfectly still â€” one such person
// here held -0.65 Â± 0.03 across eight consecutive frames and was reported as
// "sustained head turn" purely for sitting at an angle. Absolute yaw describes
// head *orientation*; a turn is a *change*, so the baseline is subtracted.
//
// The low spread of that measurement (Â±0.03) is also why no minimum-size gate
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
			if sh, ok := medianShoulderPx(poses); ok {
				log.Printf("[head_turn] %s @%.2fs shoulders=%.1fpx frames=%d", track.TrackID, startTime, sh, consecutive)
				if sh < headTurnMinShoulderPx {
					consecutive = 0
					continue
				}
			}

			if moved, ok := locomotionDuring(poses, 0, 1<<30); ok && moved > headTurnMaxLocomotion {
				log.Printf("[head_turn] %s @%.2fs dropped: subject travelled %.1f shoulder-widths during this event, so the turn measures locomotion",
					track.TrackID, startTime, moved)
				consecutive = 0
				continue
			}

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

		if sh, ok := medianShoulderPx(poses); ok {
			log.Printf("[head_turn] %s @%.2fs shoulders=%.1fpx frames=%d", track.TrackID, startTime, sh, consecutive)
			if sh < headTurnMinShoulderPx {
				return offences
			}
		}

		if moved, ok := locomotionDuring(poses, 0, 1<<30); ok && moved > headTurnMaxLocomotion {
			log.Printf("[head_turn] %s @%.2fs dropped: subject travelled %.1f shoulder-widths during this event, so the turn measures locomotion",
				track.TrackID, startTime, moved)
			return offences
		}

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


// ---------------------------------------------------------------------------
// Locomotion gate for head turns
// ---------------------------------------------------------------------------

// headTurnMaxLocomotion is how far a subject may travel across an event,
// measured in their own shoulder-widths, before their head turns stop counting
// as evidence.
//
// A head turn is only informative for someone stationary: a candidate at a desk
// should be facing their own work, so looking away is a departure from it. A
// person walking through the hall turns their head as a function of walking,
// and reporting that is measuring locomotion, not attention. Every flagged
// subject in this footage was standing or mid-stride in the aisle; the seated
// candidates were never flagged at all.
//
// Measured on the exam footage, whole-event travel per track:
//
//   Track-01  112 frames  7.89   (8 head turns)
//   Track-28  106 frames  8.91   (1)
//   Track-30   50 frames  5.65
//   Track-06   54 frames  4.65   (3)
//   Track-07   37 frames  4.34   (4)
//   Track-02    5 frames  0.33
//   Track-21    2 frames  0.04
//
// 2.0 sits well clear of every walker observed (lowest 4.34) and far above any
// plausible shift by someone anchored to a chair - at ~21px shoulder width here
// that is roughly 40px of travel.
//
// Two honest caveats. The threshold could NOT be calibrated against a
// stationary population, because this footage contains none: the only
// low-travel tracks were observed for 2-5 frames, too briefly to move rather
// than genuinely still. And measuring across the whole event rather than the
// turn window is deliberate - a turn lasts about a second, in which even a
// walker covers barely one shoulder-width, so the window cannot separate the
// two (measured: window values 0.02-3.81 with no useful split).
var headTurnMaxLocomotion = 2.0

// Legs cannot be used to tell sitting from standing here: ankles come back at
// ~0.03 confidence because desks occlude them (see the note at the top of this
// file). Displacement of the whole subject is the signal that survives at this
// resolution, and it targets the actual failure more directly than posture
// would - a person standing still at their own desk is fine; one crossing the
// room is not making a meaningful head turn either way.
//
// Returns the span of the subject's box centre over the window, in shoulder
// widths, and false when there is too little to measure.

// medianShoulderPx is the subject's typical shoulder width in pixels across the
// frames where both shoulders were confidently detected. It is the denominator
// of the yaw calculation, so it sets how much a one-pixel keypoint wobble is
// worth: small subjects produce large apparent yaw from noise alone.
func medianShoulderPx(poses []TrackedPose) (float64, bool) {
	var widths []float64
	for _, tp := range poses {
		lSho, okL := joint(tp.Pose, "left_shoulder")
		rSho, okR := joint(tp.Pose, "right_shoulder")
		if okL && okR {
			widths = append(widths, math.Abs(lSho.X-rSho.X))
		}
	}
	if len(widths) == 0 {
		return 0, false
	}
	return medianFloat(widths), true
}

func locomotionDuring(poses []TrackedPose, startFrame, endFrame int) (float64, bool) {
	var cx, cy, widths []float64

	for _, tp := range poses {
		if tp.FrameIdx < startFrame || tp.FrameIdx > endFrame {
			continue
		}
		if len(tp.Pose.BBox) != 4 {
			continue
		}
		cx = append(cx, float64(tp.Pose.BBox[0]+tp.Pose.BBox[2])/2)
		cy = append(cy, float64(tp.Pose.BBox[1]+tp.Pose.BBox[3])/2)

		lSho, okL := joint(tp.Pose, "left_shoulder")
		rSho, okR := joint(tp.Pose, "right_shoulder")
		if okL && okR {
			widths = append(widths, math.Abs(lSho.X-rSho.X))
		}
	}

	if len(cx) < 2 || len(widths) == 0 {
		return 0, false
	}

	// Span rather than net displacement: someone who walks out of shot and
	// back would net to zero, and normalising by their own shoulder width
	// keeps this comparable between a subject at the front of the room and
	// one at the back.
	minX, maxX := cx[0], cx[0]
	minY, maxY := cy[0], cy[0]
	for i := range cx {
		minX = math.Min(minX, cx[i])
		maxX = math.Max(maxX, cx[i])
		minY = math.Min(minY, cy[i])
		maxY = math.Max(maxY, cy[i])
	}
	span := math.Hypot(maxX-minX, maxY-minY)

	shoulder := medianFloat(widths)
	if shoulder < 1 {
		return 0, false
	}
	return span / shoulder, true
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

// handRaiseMaxLocomotion is how far a subject may travel across an event,
// in their own shoulder-widths, before a raised wrist stops counting as
// evidence of signalling.
//
// The reasoning is headTurnMaxLocomotion's, applied to the other detector:
// raising a hand is only informative for someone anchored to a desk. A person
// crossing the hall raises an arm as a function of walking - adjusting hair,
// carrying paper, reaching for a door - and reporting that measures locomotion,
// not communication. evaluation/ground_truth.json records this directly: of the
// six confirmed false positives on this footage, three are people walking in
// the aisle with an arm up.
//
// It shares headTurnMaxLocomotion's value because it is calibrated from the
// same measured travel table (walkers 4.34-8.91 shoulder-widths, seated tracks
// 0.04-0.33), and is kept as a separate variable so the two detectors can be
// tuned apart once there is footage that justifies it. The same caveat applies:
// this footage contains no stationary population to calibrate the low end
// against.
var handRaiseMaxLocomotion = 2.0

// wristLift measures how far the higher of the two wrists sits above the
// shoulder line, in shoulder widths, and returns that wrist's own confidence.
// Image Y grows downward, so "above" is a smaller Y.
//
// Split out of detectHandGestures so the per-frame measurement is separable
// from the run-length and locomotion gating around it.
func wristLift(p YOLOPose) (lift float64, conf float64, ok bool) {
	lSho, okL := joint(p, "left_shoulder")
	rSho, okR := joint(p, "right_shoulder")
	if !okL || !okR {
		return 0, 0, false
	}
	shoulderY := (lSho.Y + rSho.Y) / 2
	shoulderWidth := math.Abs(lSho.X - rSho.X)
	if shoulderWidth < 1 {
		return 0, 0, false
	}

	var best, bestConf float64
	found := false
	for _, side := range []string{"left_wrist", "right_wrist"} {
		wrist, okW := joint(p, side)
		if !okW {
			continue
		}
		l := (shoulderY - wrist.Y) / shoulderWidth
		if !found || l > best {
			best, bestConf, found = l, wrist.Conf, true
		}
	}
	if !found {
		return 0, 0, false
	}
	return best, bestConf, true
}

// detectHandGestures reports a wrist held clearly above the shoulder line -
// the signalling posture. Writing and page-turning keep hands low, so the
// shoulder line separates the two well without needing gesture classification.
//
// Two gates stand between that measurement and a finding, both added after
// adjudication showed the ungated version reporting people who were simply
// walking past with an arm up: the raise must persist (handRaiseMinFrames) and
// the subject must be roughly stationary (handRaiseMaxLocomotion).
func detectHandGestures(track PersonTrack, poses []TrackedPose) []Offence {
	// Travel is measured once over the whole event rather than per run, for the
	// reason set out at headTurnMaxLocomotion: a raise lasts well under a
	// second, in which even a walker covers barely one shoulder-width, so the
	// run window cannot separate a signal from a stride.
	moved, movedOK := locomotionDuring(poses, 0, 1<<30)
	walking := movedOK && moved > handRaiseMaxLocomotion

	consecutive := 0
	var startTime, endTime float64
	var peakLift, peakConf float64
	var peakFrame int

	// report closes out a completed run. It returns nil for a subject who was
	// travelling: the locomotion measure spans the event, so every other run in
	// this event would be dropped for the same reason.
	report := func() []Offence {
		if walking {
			log.Printf("[hand_gesture] %s @%.2fs dropped: subject travelled %.1f shoulder-widths during this event, so the raise measures locomotion",
				track.TrackID, startTime, moved)
			return nil
		}
		return []Offence{{
			Type:        "hand_gesture",
			Label:       "Hand raised above shoulder (possible signalling)",
			TrackID:     track.TrackID,
			StartSec:    startTime,
			EndSec:      endTime,
			FrameIdx:    peakFrame,
			Confidence:  math.Min(1.0, peakConf),
			DurationSec: endTime - startTime,
		}}
	}

	for _, tp := range poses {
		lift, conf, ok := wristLift(tp.Pose)
		if ok && lift > handRaiseMargin {
			if consecutive == 0 {
				startTime = tp.TimestampSec
				peakLift, peakConf, peakFrame = lift, conf, tp.FrameIdx
			}
			consecutive++
			endTime = tp.TimestampSec
			if lift > peakLift {
				peakLift, peakConf, peakFrame = lift, conf, tp.FrameIdx
			}
			continue
		}

		if consecutive >= handRaiseMinFrames {
			return report() // one report per track is enough
		}
		consecutive = 0
	}

	// A raise still in progress when the event ends.
	if consecutive >= handRaiseMinFrames {
		return report()
	}

	return nil
}

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
		if len(poses) == 0 {
			continue
		}
		// Each detector applies its own minimum, and they are not the same:
		// a head turn needs a baseline plus a run of headTurnMinFrames, while a
		// raised wrist needs only handRaiseMinFrames and no baseline at all.
		//
		// This guard used to be `< headTurnMinFrames`, which silently coupled
		// them. Raising that constant from 2 to 5 then stopped hand gestures
		// being detected at all on anyone tracked for fewer than five frames -
		// people at the edge of a shot, or briefly occluded, vanished from
		// detection entirely rather than just from head-turn detection.
		offences = append(offences, detectHeadTurns(track, poses)...)
		offences = append(offences, detectHandGestures(track, poses)...)
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
