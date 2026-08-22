package main

import (
	"fmt"
	"image"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// processEvents enriches events with person detection and object detection
func processEvents(events []Event, roisData *ROIsData, framesDir string, detector *YOLODetector, header *Header, outDir string, baselinesPath string) []EnrichedEvent {
	enriched := make([]EnrichedEvent, 0, len(events))

	// Feature 10.4. Loaded once for the video, not per event: the baselines
	// describe the whole recording. Nil when the stage did not run, and every
	// use below tolerates that.
	baselines := loadRegionBaselines(resolveBaselinesPath(outDir, baselinesPath))

	// One tracker for the whole video, so identities carry across events:
	// a person seen in two events keeps one ID instead of being renumbered
	// from 1 each time, which previously made cross-event comparisons
	// meaningless (every event had its own unrelated "Track-01").
	tracker := NewByteTracker()

	// Real (downscaled) frame size — detections are in this space, not the
	// source resolution recorded in header.json.
	procW, procH := frameDimensions(framesDir, header.VideoID)
	if procW == 0 || procH == 0 {
		procW, procH = header.Width, header.Height
	}

	// Build frame index lookup for ROIs (if available)
	frameROIsMap := make(map[int]FrameROIs)
	if roisData != nil {
		for _, frame := range roisData.Frames {
			frameROIsMap[frame.FrameIdx] = frame
		}
	}

	for i, event := range events {
		log.Printf("[INFO] Processing event %d/%d (ID: %d, %.2fs-%.2fs)",
			i+1, len(events), event.EventID, event.Start, event.End)

		enrichedEvent := EnrichedEvent{
			Event:            event,
			PersonTracks:     []PersonTrack{},
			ObjectDetections: []ObjectDetection{},
			DetectionSummary: DetectionSummary{},
		}

		// Get frames for this event (use unpadded range for detection)
		eventFrames := getEventFrames(event, frameROIsMap)
		if len(eventFrames) == 0 {
			log.Printf("[WARN] No frames found for event %d", event.EventID)
			enriched = append(enriched, enrichedEvent)
			continue
		}
		
		log.Printf("[DEBUG] Event %d has %d frames to process", event.EventID, len(eventFrames))

		// Run person detection and tracking (Module 8)
		var eventPoses map[string][]TrackedPose
		if detector != nil {
			personTracks, poseFrames := detectAndTrackPersons(event, eventFrames, framesDir, header.VideoID, detector, header, outDir, tracker, procW, procH)
			enrichedEvent.PersonTracks = personTracks
			eventPoses = assignPosesToTracks(personTracks, poseFrames)
		} else {
			// Mock mode: generate fake person tracks
			enrichedEvent.PersonTracks = generateMockPersonTracks(event, eventFrames)
		}

		// Run object detection (Module 9)
		if detector != nil {
			snapshotDir := filepath.Join(outDir, "snapshots")
			objectDetections := detectObjects(event, eventFrames, framesDir, header.VideoID, detector, header, enrichedEvent.PersonTracks, snapshotDir, procW, procH)
			enrichedEvent.ObjectDetections = objectDetections
		} else {
			// Mock mode: generate fake object detections
			enrichedEvent.ObjectDetections = generateMockObjectDetections(event, eventFrames)
		}

		// Build detection summary
		enrichedEvent.DetectionSummary = buildDetectionSummary(enrichedEvent.PersonTracks, enrichedEvent.ObjectDetections)

		// Classify concrete offences from the detections gathered above.
		enrichedEvent.Offences = classifyOffences(event, enrichedEvent, outDir, eventPoses)

		// Keypoint-derived micro-motions: head turns, signalling, reaching
		// toward a neighbour. These need per-joint positions, so they can
		// only be computed where pose ran.
		if len(eventPoses) > 0 {
			enrichedEvent.Offences = append(enrichedEvent.Offences,
				analyseMicroMotions(enrichedEvent.PersonTracks, eventPoses)...)
		}

		// Per-offence stills: the accused person in red, nobody else drawn.
		renderOffenceStills(&enrichedEvent, detector, framesDir, header.VideoID, outDir)

		// Give every offence a still. Only prohibited-object findings write a
		// purpose-built snapshot during detection, so behavioural ones
		// (head turns, gestures, reaches) would otherwise reach the UI with
		// nothing to show. Re-running the annotator just for those would cost
		// another full inference pass, and the images needed are already on
		// disk, so this only picks the best one that exists.
		for i := range enrichedEvent.Offences {
			if enrichedEvent.Offences[i].Snapshot != "" {
				continue
			}
			fIdx := enrichedEvent.Offences[i].FrameIdx
			if fIdx == 0 {
				fIdx = event.StartFrameIdx
			}
			if shot := findEvidenceFrame(outDir, framesDir, header.VideoID, fIdx); shot != "" {
				enrichedEvent.Offences[i].Snapshot = shot
			}
		}

		// Feature 10.4 — annotate each offence with how abnormal its own part
		// of the frame was, by that region's own standard for this video.
		for i := range enrichedEvent.Offences {
			off := &enrichedEvent.Offences[i]
			fIdx := off.FrameIdx
			if fIdx == 0 {
				fIdx = event.StartFrameIdx
			}
			off.Region, off.RegionZ = baselines.annotate(off.BBox, event.ROI, fIdx)
		}

		enriched = append(enriched, enrichedEvent)
	}

	return enriched
}

// getEventFrames returns frames within the event's unpadded time range
// When frameROIsMap is empty, returns a simplified frame list based on event range
func getEventFrames(event Event, frameROIsMap map[int]FrameROIs) []FrameROIs {
	var frames []FrameROIs
	
	// If we have per-frame ROI data, use it
	if len(frameROIsMap) > 0 {
		for frameIdx := event.StartFrameIdx; frameIdx <= event.EndFrameIdx; frameIdx++ {
			if frame, ok := frameROIsMap[frameIdx]; ok {
				// Only include frames within unpadded range
				if frame.TimestampSec >= event.UnpaddedStart && frame.TimestampSec <= event.UnpaddedEnd {
					frames = append(frames, frame)
				}
			}
		}
	} else {
		// No per-frame ROI data - create simple frame entries
		// We'll use event-level ROI in detectAndTrackPersons
		for frameIdx := event.StartFrameIdx; frameIdx <= event.EndFrameIdx; frameIdx++ {
			frames = append(frames, FrameROIs{
				FrameIdx:     frameIdx,
				TimestampSec: 0, // Will be calculated from FPS in detectAndTrackPersons
				ROIs:         []ROI{}, // Empty, will use event-level ROI
			})
		}
	}
	
	return frames
}

// getFrameROIs looks up ROI data for a specific frame
func getFrameROIs(eventFrames []FrameROIs, frameIdx int) (FrameROIs, bool) {
	for _, frame := range eventFrames {
		if frame.FrameIdx == frameIdx {
			return frame, true
		}
	}
	return FrameROIs{}, false
}

// detectAndTrackPersons runs person detection and ByteTrack-style tracking
func detectAndTrackPersons(event Event, eventFrames []FrameROIs, framesDir string, videoID string, detector *YOLODetector, header *Header, outDir string, tracker *ByteTracker, procW, procH int) ([]PersonTrack, []PoseFrame) {
	if detector == nil {
		// Mock mode - generate realistic person tracks
		return generateMockPersonTracks(event, eventFrames), nil
	}

	// The tracker is owned by the caller and shared across every event in
	// this video, so a track ID means "this person" rather than "the Nth
	// person detected in this particular event". Retire anything last seen
	// well before this event starts — see ExpireBefore.
	tracker.ExpireBefore(event.Start - maxTrackGapSeconds)

	trackBBoxes := make(map[int][]BBox)
	var poseFrames []PoseFrame

	// Create annotated frames directory
	annotatedDir := filepath.Join(outDir, "annotated")
	os.MkdirAll(annotatedDir, 0755)

	// Event-level ROI (from events.json)
	eventROI := image.Rectangle{}
	if len(event.ROI) == 4 {
		eventROI = image.Rect(event.ROI[0], event.ROI[1], event.ROI[2], event.ROI[3])
	}

	// Process frames in event range
	log.Printf("[DEBUG] Event frames range: %d to %d", event.StartFrameIdx, event.EndFrameIdx)
	
	framesProcessed := 0
	for frameIdx := event.StartFrameIdx; frameIdx <= event.EndFrameIdx; frameIdx++ {
		// Build frame path using actual naming convention: videoID__f%07d__t*.jpg
		pattern := filepath.Join(framesDir, fmt.Sprintf("%s__f%07d__t*.jpg", videoID, frameIdx))
		matches, err := filepath.Glob(pattern)
		
		if frameIdx == event.StartFrameIdx {
			log.Printf("[DEBUG] First frame pattern: %s", pattern)
			log.Printf("[DEBUG] Matches found: %d", len(matches))
			if len(matches) > 0 {
				log.Printf("[DEBUG] First match: %s", matches[0])
			}
		}
		
		if err != nil || len(matches) == 0 {
			continue
		}
		framesProcessed++
		framePath := matches[0]

		// Determine ROI to use
		var roiToUse image.Rectangle
		frameData, hasFrameROI := getFrameROIs(eventFrames, frameIdx)
		if hasFrameROI && len(frameData.ROIs) > 0 {
			// Use first frame-level ROI
			roi := frameData.ROIs[0]
			roiToUse = image.Rect(roi.BBoxX1, roi.BBoxY1, roi.BBoxX2, roi.BBoxY2)
		} else if !eventROI.Empty() {
			// Use event-level ROI
			roiToUse = eventROI
		} else {
			// Use full frame
			roiToUse = image.Rect(0, 0, header.Width, header.Height)
		}

		// Run detection
		detections, err := detector.DetectFrame(framePath, roiToUse)
		if err != nil {
			log.Printf("[WARN] Detection failed for frame %d: %v", frameIdx, err)
			continue
		}

		// Save annotated frame if there is anything worth boxing.
		shown := relevantDetections(detections, procW, procH)
		if len(shown) > 0 {
			annotatedPath := filepath.Join(annotatedDir, fmt.Sprintf("annotated_frame_%07d.jpg", frameIdx))
			if err := detector.AnnotateFrame(framePath, shown, annotatedPath); err != nil {
				log.Printf("[WARN] Failed to annotate frame %d: %v", frameIdx, err)
			} else {
				log.Printf("[INFO] Annotated frame %d with %d detections", frameIdx, len(shown))
			}
		}

		// Body keypoints for this frame. Run on the full frame rather than
		// per-ROI: a turned head or an outstretched arm routinely crosses
		// the ROI boundary motion detection drew around the body.
		if people, err := detector.DetectPose(framePath); err != nil {
			log.Printf("[WARN] Pose failed for frame %d: %v", frameIdx, err)
		} else if len(people) > 0 {
			poseFrames = append(poseFrames, PoseFrame{
				FrameIdx:     frameIdx,
				TimestampSec: float64(frameIdx) / header.FPS,
				People:       people,
			})
		}

		// Update tracker with person detections
		activeTracks := tracker.Update(detections)

		// Record one bbox per track for THIS frame. Only tracks matched on
		// this frame get an entry (TimeSinceSeen == 0); a coasting track has
		// no observed position to report. Previously every detection the
		// track had ever seen was re-appended here, stamped with the current
		// frame — inflating frame counts and corrupting the timestamps that
		// loitering and crowd detection depend on.
		fps := header.FPS
		timestampSec := float64(frameIdx) / fps
		for _, track := range activeTracks {
			if track.TimeSinceSeen != 0 || len(track.Detections) == 0 {
				continue
			}
			track.LastSeenSec = timestampSec
			trackBBoxes[track.ID] = append(trackBBoxes[track.ID], BBox{
				FrameIdx:     frameIdx,
				TimestampSec: timestampSec,
				X1:           track.LastBBox.Min.X,
				Y1:           track.LastBBox.Min.Y,
				X2:           track.LastBBox.Max.X,
				Y2:           track.LastBBox.Max.Y,
				Confidence:   track.Detections[len(track.Detections)-1].Confidence,
			})
		}
	}
	
	log.Printf("[DEBUG] Event %d: Processed %d frames, found %d tracks", event.EventID, framesProcessed, len(trackBBoxes))

	// Convert tracks to PersonTrack format
	var personTracks []PersonTrack
	for trackID, bboxes := range trackBBoxes {
		if len(bboxes) == 0 {
			continue
		}

		// Calculate average confidence
		var totalConf float64
		for _, bbox := range bboxes {
			totalConf += bbox.Confidence
		}
		avgConf := totalConf / float64(len(bboxes))

		track := PersonTrack{
			TrackID:    FormatTrackID(trackID),
			FirstSeen:  bboxes[0].TimestampSec,
			LastSeen:   bboxes[len(bboxes)-1].TimestampSec,
			FrameCount: len(bboxes),
			BBoxes:     bboxes,
			Confidence: avgConf,
		}
		personTracks = append(personTracks, track)
	}

	return personTracks, poseFrames
}

// detectObjects runs object detection (phone, paper, etc.)
func detectObjects(event Event, eventFrames []FrameROIs, framesDir string, videoID string, detector *YOLODetector, header *Header, personTracks []PersonTrack, snapshotDir string, procW, procH int) []ObjectDetection {
	if detector == nil {
		// Mock mode
		return generateMockObjectDetections(Event{}, eventFrames)
	}
	
	objectBBoxes := make(map[string][]BBox) // object_type -> bboxes

	// Event-level ROI fallback, same as person detection uses.
	eventROI := image.Rectangle{}
	if len(event.ROI) == 4 {
		eventROI = image.Rect(event.ROI[0], event.ROI[1], event.ROI[2], event.ROI[3])
	}

	for frameIdx := event.StartFrameIdx; frameIdx <= event.EndFrameIdx; frameIdx++ {
		// Frames are written by Module 2 as `<videoID>__f%07d__t<ts>.jpg`.
		// This previously looked for `frame_%05d.jpg`, which never matched,
		// so every frame was skipped and prohibited-object detection
		// silently produced nothing on every run.
		pattern := filepath.Join(framesDir, fmt.Sprintf("%s__f%07d__t*.jpg", videoID, frameIdx))
		matches, err := filepath.Glob(pattern)
		if err != nil || len(matches) == 0 {
			continue
		}
		framePath := matches[0]

		timestampSec := float64(frameIdx) / header.FPS

		// Prefer per-frame ROIs from Module 5; fall back to the event ROI,
		// then the whole frame. Without a fallback, events lacking per-frame
		// ROI data would scan nothing at all.
		var roiRects []image.Rectangle
		if frameData, ok := getFrameROIs(eventFrames, frameIdx); ok && len(frameData.ROIs) > 0 {
			for _, roi := range frameData.ROIs {
				roiRects = append(roiRects, image.Rect(roi.BBoxX1, roi.BBoxY1, roi.BBoxX2, roi.BBoxY2))
			}
		} else if !eventROI.Empty() {
			roiRects = append(roiRects, eventROI)
		} else {
			roiRects = append(roiRects, image.Rect(0, 0, header.Width, header.Height))
		}

		var allDetections []Detection
		for _, roiRect := range roiRects {
			detections, err := detector.DetectFrame(framePath, roiRect)
			if err != nil {
				continue
			}
			allDetections = append(allDetections, detections...)
		}

		// Keep only prohibited items — a bare "not a person" filter would
		// flood events with exam-hall furniture (chairs, tables, monitors).
		var prohibited []Detection
		for _, det := range allDetections {
			if !isProhibitedObject(det.ClassName) || det.Confidence < prohibitedMinConfidence {
				continue
			}
			if isOverlayArtifact(det, procW, procH) {
				log.Printf("[INFO] Rejected %s at %v — overlay text or implausible geometry",
					det.ClassName, det.BBox)
				continue
			}
			prohibited = append(prohibited, det)
			objectBBoxes[det.ClassName] = append(objectBBoxes[det.ClassName], BBox{
				FrameIdx:     frameIdx,
				TimestampSec: timestampSec,
				X1:           det.BBox.Min.X,
				Y1:           det.BBox.Min.Y,
				X2:           det.BBox.Max.X,
				Y2:           det.BBox.Max.Y,
				Confidence:   det.Confidence,
			})
		}

		// Automatic evidence capture: the moment a prohibited object is on
		// screen, write an annotated still so an investigator has a dated
		// snapshot without having to scrub the video and press a button.
		if len(prohibited) > 0 && snapshotDir != "" {
			os.MkdirAll(snapshotDir, 0755)
			shot := filepath.Join(snapshotDir,
				fmt.Sprintf("event%d_f%07d.jpg", event.EventID, frameIdx))
			if _, err := os.Stat(shot); os.IsNotExist(err) {
				if err := detector.AnnotateFrame(framePath, relevantDetections(allDetections, procW, procH), shot); err != nil {
					log.Printf("[WARN] snapshot failed for frame %d: %v", frameIdx, err)
				}
			}
		}
	}

	// Convert to ObjectDetection format
	var objectDetections []ObjectDetection
	for objType, bboxes := range objectBBoxes {
		if len(bboxes) == 0 {
			continue
		}

		var totalConf float64
		for _, bbox := range bboxes {
			totalConf += bbox.Confidence
		}
		avgConf := totalConf / float64(len(bboxes))

		// Try to associate with a person track (if object bbox overlaps with person)
		var associatedTrack *string
		if len(personTracks) > 0 {
			// Simple heuristic: find person track with overlapping bbox
			for _, track := range personTracks {
				for _, personBBox := range track.BBoxes {
					for _, objBBox := range bboxes {
						if objBBox.FrameIdx == personBBox.FrameIdx && bboxesOverlap(objBBox, personBBox) {
							associatedTrack = &track.TrackID
							break
						}
					}
					if associatedTrack != nil {
						break
					}
				}
				if associatedTrack != nil {
					break
				}
			}
		}

		detection := ObjectDetection{
			ObjectType: objType,
			FirstSeen:  bboxes[0].TimestampSec,
			LastSeen:   bboxes[len(bboxes)-1].TimestampSec,
			FrameCount: len(bboxes),
			BBoxes:     bboxes,
			Confidence: avgConf,
			TrackID:    associatedTrack,
		}
		objectDetections = append(objectDetections, detection)
	}

	return objectDetections
}

// Prohibited items, expressed as COCO classes YOLO can actually emit.
// "book" is the practical stand-in for paper/chits — COCO has no chit class,
// and a folded sheet on a desk reads as a book far more often than anything
// else. Everything not listed here (chairs, monitors, bottles, furniture) is
// normal exam-hall content and must not raise an offence.
const (
	// An invigilator pausing beside a desk is normal; standing there for the
	// better part of a minute is the pattern worth flagging. Tunable.
	loiteringMinSeconds = 45.0
	// During an exam the baseline is near-static, so three people moving in
	// the same frame is already anomalous.
	crowdMinPersons = 3
	// Centroid drift, as a fraction of the person's own box width, before
	// they count as moving. Measured on stationary people in this footage,
	// frame-to-frame drift reaches 0.167 at p90 and 0.321 at p99 — purely
	// from detector jitter. The previous 0.10 sat below p75, so 18% of
	// perfectly still people registered as moving, and in a room of ten that
	// is enough phantom movers to trip the three-person bar every frame.
	crowdMoveThreshold = 0.35
	// Consecutive sampled frames the crowd must keep moving for. Jitter is
	// independent between frames so a chance alignment seldom repeats.
	crowdMinFrames = 3
	// Frames are sampled with gaps, so "consecutive" allows one sampling step.
	crowdMaxFrameGap = 6
	// How long a track may go unobserved and still be considered the same
	// person when detection resumes. Detection only runs inside events, so
	// this gap is unwatched footage; beyond it, matching on position alone
	// is guesswork rather than tracking.
	maxTrackGapSeconds = 30.0
	// How close a wrist must be to an object, in shoulder widths, to count
	// as holding it. Roughly an arm's reach of the hand itself — tight
	// enough that merely sitting beside the object does not qualify.
	exchangeWristRadius = 0.9
)

// Deliberately narrow. Classes like "remote" and "laptop" fired constantly on
// this footage without corresponding to any real offence — "remote" in
// particular is what YOLO reaches for on any small dark rectangle, so it was
// pure noise. An offence list an investigator cannot trust is worse than a
// shorter one, so only phones and paper/chits are reported.
var prohibitedObjects = map[string]string{
	"cell phone": "mobile phone",
	"book":       "paper/chit",
}

// Detections below this are too weak to put in front of an investigator as a
// prohibited item. The Python service filters at 0.25 for tracking purposes;
// an offence claim is held to a higher bar than mere presence.
const prohibitedMinConfidence = 0.35

const (
	// Fraction of frame height at the top and bottom occupied by the camera's
	// burned-in overlay — timestamp along the top, camera label bottom-right.
	// That text is part of the pixels, so a detector cannot tell it from scene
	// content: a bright high-contrast rectangle on a dark strip reads as a lit
	// phone screen. Observed directly, a single digit of "09:30:52" was
	// reported as a mobile phone at 0.62 confidence.
	osdTopFraction    = 0.10
	osdBottomFraction = 0.08

	// Anything smaller than this cannot be a handheld object at the scale
	// these frames are processed at.
	minProhibitedArea = 250.0

	// Squareness rules out a phone, which is elongated in either orientation
	// (~0.4-0.7 upright, ~1.4-2.5 on its side) — the timestamp glyph that
	// triggered this was 17x18px, essentially square. It deliberately does NOT
	// apply to paper: a folded chit seen from above is often roughly square,
	// so the same rule would discard exactly the object hardest to detect.
	phoneSquareLowAR  = 0.80
	phoneSquareHighAR = 1.25
)

// frameDimensions reads the real pixel size of the sampled frames.
//
// header.json carries the SOURCE resolution, but Module 2 downscales frames
// for processing and every detection coordinate is in that smaller space.
// Deriving overlay bands from the source size would size them against the
// wrong frame — a 10% band computed on 720px applied to a 360px frame masks a
// fifth of the image. Decoding one frame header is cheap and exact.
func frameDimensions(framesDir, videoID string) (int, int) {
	matches, err := filepath.Glob(filepath.Join(framesDir, fmt.Sprintf("%s__f*__t*.jpg", videoID)))
	if err != nil || len(matches) == 0 {
		return 0, 0
	}
	f, err := os.Open(matches[0])
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return 0, 0
	}
	return cfg.Width, cfg.Height
}

// isOverlayArtifact rejects a detection that sits in the camera's burned-in
// text bands, or whose geometry does not resemble the object claimed.
//
// Both tests are deliberately cheap and deterministic. A model-based verifier
// would also reject this, but paying for inference to discard something that
// position and aspect ratio already rule out is the wrong order of operations.
func isOverlayArtifact(det Detection, frameW, frameH int) bool {
	if frameH <= 0 || frameW <= 0 {
		return false
	}

	b := det.BBox
	w := float64(b.Dx())
	h := float64(b.Dy())
	if w <= 0 || h <= 0 {
		return true
	}

	// Sitting inside the overlay bands.
	topBand := float64(frameH) * osdTopFraction
	bottomBand := float64(frameH) * (1 - osdBottomFraction)
	if float64(b.Max.Y) <= topBand || float64(b.Min.Y) >= bottomBand {
		return true
	}

	// Too small to be a real handheld object at this scale.
	if w*h < minProhibitedArea {
		return true
	}

	// Near-square: a glyph rather than a device. Phones only — see above.
	if det.ClassName == "cell phone" {
		if ar := w / h; ar > phoneSquareLowAR && ar < phoneSquareHighAR {
			return true
		}
	}

	return false
}

func isProhibitedObject(className string) bool {
	_, ok := prohibitedObjects[className]
	return ok
}

// relevantDetections keeps only what an investigator should see boxed: people
// and prohibited items. YOLO also reports chairs, monitors, desks and similar
// exam-hall furniture, and drawing boxes around those buries the one detection
// that actually matters.
func relevantDetections(dets []Detection, frameW, frameH int) []Detection {
	out := make([]Detection, 0, len(dets))
	for _, d := range dets {
		if d.ClassName == "person" {
			out = append(out, d)
			continue
		}
		// Same guard as the offence path: an overlay glyph must not be boxed
		// as a phone in the evidence still either.
		if isProhibitedObject(d.ClassName) && d.Confidence >= prohibitedMinConfidence &&
			!isOverlayArtifact(d, frameW, frameH) {
			out = append(out, d)
		}
	}
	return out
}

func prohibitedLabel(className string) string {
	if label, ok := prohibitedObjects[className]; ok {
		return label
	}
	return className
}

// detectLoitering flags a track that stays in essentially one spot for a long
// stretch — the "invigilator parked next to a candidate" pattern. Movement is
// measured as centroid drift relative to the person's own bounding-box size,
// so it behaves the same for someone near the camera as far from it.
func detectLoitering(tracks []PersonTrack, minSeconds float64) []Offence {
	var offences []Offence

	for _, track := range tracks {
		if len(track.BBoxes) < 2 {
			continue
		}

		windowStart := track.BBoxes[0]
		for i := 1; i < len(track.BBoxes); i++ {
			cur := track.BBoxes[i]
			refW := float64(windowStart.X2-windowStart.X1) + 1
			refH := float64(windowStart.Y2-windowStart.Y1) + 1

			dx := float64((cur.X1+cur.X2)/2 - (windowStart.X1+windowStart.X2)/2)
			dy := float64((cur.Y1+cur.Y2)/2 - (windowStart.Y1+windowStart.Y2)/2)
			drift := math.Sqrt(dx*dx+dy*dy) / math.Max(refW, refH)

			// Drifted far enough to count as "moved on" — restart the window.
			if drift > 0.75 {
				windowStart = cur
				continue
			}

			stationaryFor := cur.TimestampSec - windowStart.TimestampSec
			if stationaryFor >= minSeconds {
				offences = append(offences, Offence{
					Type:        "loitering",
					Label:       fmt.Sprintf("Person stationary for %.0fs", stationaryFor),
					TrackID:     track.TrackID,
					StartSec:    windowStart.TimestampSec,
					EndSec:      cur.TimestampSec,
					FrameIdx:    cur.FrameIdx,
					Confidence:  track.Confidence,
					BBox:        []int{cur.X1, cur.Y1, cur.X2, cur.Y2},
					DurationSec: stationaryFor,
				})
				// One report per stationary stretch, then look for the next.
				windowStart = cur
			}
		}
	}

	return offences
}

// detectCrowdDisturbance flags moments where several people move at once —
// during an exam the baseline is near-static, so simultaneous activity across
// multiple tracks is itself the anomaly.
func detectCrowdDisturbance(tracks []PersonTrack, minPersons int) []Offence {
	if len(tracks) < minPersons {
		return nil
	}

	// Bucket per-frame activity by frame index across all tracks.
	movingPerFrame := make(map[int]map[string]bool)
	frameTime := make(map[int]float64)

	for _, track := range tracks {
		for i := 1; i < len(track.BBoxes); i++ {
			prev, cur := track.BBoxes[i-1], track.BBoxes[i]
			refW := float64(cur.X2-cur.X1) + 1
			dx := float64((cur.X1+cur.X2)/2 - (prev.X1+prev.X2)/2)
			dy := float64((cur.Y1+cur.Y2)/2 - (prev.Y1+prev.Y2)/2)
			if math.Sqrt(dx*dx+dy*dy)/refW < crowdMoveThreshold {
				continue // below this it is box jitter, not the person moving
			}
			if movingPerFrame[cur.FrameIdx] == nil {
				movingPerFrame[cur.FrameIdx] = make(map[string]bool)
			}
			movingPerFrame[cur.FrameIdx][track.TrackID] = true
			frameTime[cur.FrameIdx] = cur.TimestampSec
		}
	}

	var qualifying []int
	for f, movers := range movingPerFrame {
		if len(movers) >= minPersons {
			qualifying = append(qualifying, f)
		}
	}
	if len(qualifying) == 0 {
		return nil
	}
	sort.Ints(qualifying)

	// Require the crowd to stay in motion across consecutive sampled frames.
	// Residual jitter is independent between frames, so a chance alignment of
	// several people rarely repeats — whereas a real disturbance persists.
	var frames []int
	run := 1
	for i := 1; i <= len(qualifying); i++ {
		contiguous := i < len(qualifying) && qualifying[i]-qualifying[i-1] <= crowdMaxFrameGap
		if contiguous {
			run++
			continue
		}
		if run >= crowdMinFrames {
			frames = append(frames, qualifying[i-run:i]...)
		}
		run = 1
	}
	if len(frames) == 0 {
		return nil
	}

	peak, peakFrame := 0, frames[0]
	for _, f := range frames {
		if n := len(movingPerFrame[f]); n > peak {
			peak, peakFrame = n, f
		}
	}

	return []Offence{{
		Type:       "crowd_disturbance",
		Label:      fmt.Sprintf("%d people moving simultaneously", peak),
		StartSec:   frameTime[frames[0]],
		EndSec:     frameTime[frames[len(frames)-1]],
		FrameIdx:   peakFrame,
		Confidence: math.Min(1.0, float64(peak)/float64(minPersons+2)),
		Count:      peak,
	}}
}

// detectObjectExchange flags a prohibited object appearing while two or more
// people are close together — the hand-off pattern (passing a chit or phone).
// This is a proximity heuristic, not a verified hand-to-hand observation.
func detectObjectExchange(tracks []PersonTrack, objects []ObjectDetection, posesByTrack map[string][]TrackedPose) []Offence {
	var offences []Offence

	// Exchange requires hands. An earlier version asked only whether the
	// object's box overlapped two person boxes (padded outward by a quarter
	// of their width), which in a full exam hall is true of almost any
	// object: candidates sit shoulder to shoulder, so their boxes already
	// overlap each other heavily and a phone near anyone appeared to be
	// "between two people". That reported crowding as a hand-off.
	//
	// A transfer has a specific physical signature — the object close to a
	// wrist of one person AND a wrist of another. Without keypoints for both
	// parties nothing is claimed, because from boxes alone "two people near
	// a phone" and "two people passing a phone" are indistinguishable.
	if len(posesByTrack) == 0 {
		return nil
	}

	for _, obj := range objects {
		for _, ob := range obj.BBoxes {
			objCX := float64(ob.X1+ob.X2) / 2
			objCY := float64(ob.Y1+ob.Y2) / 2

			var handsNear []string
			for trackID, poses := range posesByTrack {
				for _, tp := range poses {
					if tp.FrameIdx != ob.FrameIdx {
						continue
					}
					lSho, okL := joint(tp.Pose, "left_shoulder")
					rSho, okR := joint(tp.Pose, "right_shoulder")
					if !okL || !okR {
						break
					}
					// Scale the tolerance to the person, so someone at the
					// back of the hall is judged the same as one in front.
					shoulderWidth := math.Abs(lSho.X - rSho.X)
					if shoulderWidth < 1 {
						break
					}
					for _, side := range []string{"left_wrist", "right_wrist"} {
						wrist, ok := joint(tp.Pose, side)
						if !ok {
							continue
						}
						if math.Hypot(wrist.X-objCX, wrist.Y-objCY)/shoulderWidth < exchangeWristRadius {
							handsNear = append(handsNear, trackID)
							break
						}
					}
					break
				}
			}

			// Two *different* people must each have a hand at the object.
			unique := map[string]bool{}
			for _, id := range handsNear {
				unique[id] = true
			}
			if len(unique) >= 2 {
				ids := make([]string, 0, len(unique))
				for id := range unique {
					ids = append(ids, id)
				}
				sort.Strings(ids)
				offences = append(offences, Offence{
					Type:       "object_exchange",
					Label:      fmt.Sprintf("%s at the hands of %s and %s (possible hand-off)", prohibitedLabel(obj.ObjectType), ids[0], ids[1]),
					TrackID:    ids[0],
					StartSec:   ob.TimestampSec,
					EndSec:     ob.TimestampSec,
					FrameIdx:   ob.FrameIdx,
					Confidence: ob.Confidence,
					BBox:       []int{ob.X1, ob.Y1, ob.X2, ob.Y2},
					Count:      len(unique),
				})
				break // one report per object type is enough
			}
		}
	}

	return offences
}

// classifyOffences turns raw detections into the reviewable offence list:
// prohibited objects, loitering, crowd disturbance, object exchange, and
// motion anomalies. Each offence carries the frame it happened on, and where
// an auto-captured still exists for that frame it is attached as evidence.
func classifyOffences(event Event, ev EnrichedEvent, outDir string, posesByTrack map[string][]TrackedPose) []Offence {
	var offences []Offence

	// ---- prohibited objects (phones, chits/paper, laptops) ----
	for _, obj := range ev.ObjectDetections {
		if len(obj.BBoxes) == 0 {
			continue
		}
		// Report the most confident sighting — that is the frame worth
		// showing an investigator.
		best := obj.BBoxes[0]
		for _, b := range obj.BBoxes {
			if b.Confidence > best.Confidence {
				best = b
			}
		}
		offences = append(offences, Offence{
			Type:       "prohibited_object",
			Label:      fmt.Sprintf("%s detected", prohibitedLabel(obj.ObjectType)),
			TrackID:    derefTrackID(obj.TrackID),
			StartSec:   obj.FirstSeen,
			EndSec:     obj.LastSeen,
			FrameIdx:   best.FrameIdx,
			Confidence: best.Confidence,
			BBox:       []int{best.X1, best.Y1, best.X2, best.Y2},
			Count:      obj.FrameCount,
		})
	}

	// ---- object exchange (chit/phone passed between people) ----
	offences = append(offences, detectObjectExchange(ev.PersonTracks, ev.ObjectDetections, posesByTrack)...)

	// ---- loitering (e.g. invigilator parked beside a candidate) ----
	offences = append(offences, detectLoitering(ev.PersonTracks, loiteringMinSeconds)...)

	// ---- crowd-level simultaneous movement ----
	offences = append(offences, detectCrowdDisturbance(ev.PersonTracks, crowdMinPersons)...)

	// Motion anomaly is deliberately not reported as an offence. The jerk
	// score describes a segment's motion character, not anyone's conduct, and
	// in practice it fired hardest on the decoder recovering from the
	// undecodable frames at t=0 — an artefact of the recording, not behaviour.
	// The score remains on the event for ranking and filtering.

	// Attach any auto-captured still that matches the offence's frame.
	snapshotDir := filepath.Join(outDir, "snapshots")
	for i := range offences {
		shot := filepath.Join(snapshotDir, fmt.Sprintf("event%d_f%07d.jpg", event.EventID, offences[i].FrameIdx))
		if _, err := os.Stat(shot); err == nil {
			offences[i].Snapshot = filepath.ToSlash(shot)
		}
	}

	return offences
}

// renderOffenceStills gives each finding its own image showing just the accused
// person, outlined in red and captioned with who and what.
//
// Replaces reuse of the shared annotated frame, which drew every detected
// person in green: at thumbnail size that is a cluster of identical boxes that
// never answers the reviewer's actual question — which of these people is this
// finding about. Offences with no attributable person (crowd disturbance,
// motion anomaly) keep the general frame, since there is no single subject.
func renderOffenceStills(ev *EnrichedEvent, detector *YOLODetector, framesDir, videoID, outDir string) {
	if detector == nil {
		return
	}

	subjectDir := filepath.Join(outDir, "offence_stills")
	os.MkdirAll(subjectDir, 0755)

	for i := range ev.Offences {
		off := &ev.Offences[i]
		if off.TrackID == "" {
			continue // no single subject to highlight
		}

		// The subject's box on the frame this finding refers to.
		var subject []int
		for _, t := range ev.PersonTracks {
			if t.TrackID != off.TrackID {
				continue
			}
			for _, b := range t.BBoxes {
				if b.FrameIdx == off.FrameIdx {
					subject = []int{b.X1, b.Y1, b.X2, b.Y2}
					break
				}
			}
			break
		}
		if subject == nil {
			continue // track wasn't observed on that exact frame
		}

		// Record the subject's box on the offence itself. Pose-derived
		// findings carried no bbox, which left any downstream verifier with
		// only a full-frame still — and a model asked to judge a whole
		// exam hall cannot say anything about one person in it.
		if len(off.BBox) != 4 {
			off.BBox = subject
		}

		pattern := filepath.Join(framesDir, fmt.Sprintf("%s__f%07d__t*.jpg", videoID, off.FrameIdx))
		matches, err := filepath.Glob(pattern)
		if err != nil || len(matches) == 0 {
			continue
		}

		out := filepath.Join(subjectDir, fmt.Sprintf("%s_%s_f%07d.jpg", off.TrackID, off.Type, off.FrameIdx))
		label := fmt.Sprintf("%s - %s", off.TrackID, offenceDisplayName(off.Type))
		if err := detector.AnnotateOffence(matches[0], subject, label, out); err != nil {
			log.Printf("[WARN] offence still failed (%s %s): %v", off.TrackID, off.Type, err)
			continue
		}
		off.Snapshot = filepath.ToSlash(out)
	}
}

func offenceDisplayName(t string) string {
	switch t {
	case "prohibited_object":
		return "Prohibited Object"
	case "object_exchange":
		return "Object Exchange"
	case "loitering":
		return "Loitering"
	case "crowd_disturbance":
		return "Crowd Disturbance"
	case "head_turn":
		return "Head Turn"
	case "hand_gesture":
		return "Hand Gesture"
	case "neighbour_reach":
		return "Neighbour Reach"
	}
	return t
}

// computePersonProximity scores how tightly people cluster during an event,
// as the largest fraction of tracked people that are simultaneously close to
// someone else. Distance is measured between box centres and scaled by box
// width, so two people side by side score the same whether they are near the
// camera or far from it. 0 = everyone isolated, 1 = everyone paired up.
func computePersonProximity(tracks []PersonTrack) float64 {
	if len(tracks) < 2 {
		return 0
	}

	// Regroup per-track boxes by the frame they were observed on.
	byFrame := make(map[int][]BBox)
	for _, t := range tracks {
		for _, b := range t.BBoxes {
			byFrame[b.FrameIdx] = append(byFrame[b.FrameIdx], b)
		}
	}

	best := 0.0
	for _, boxes := range byFrame {
		if len(boxes) < 2 {
			continue
		}
		near := make([]bool, len(boxes))
		for i := 0; i < len(boxes); i++ {
			for j := i + 1; j < len(boxes); j++ {
				a, b := boxes[i], boxes[j]
				ax, ay := float64(a.X1+a.X2)/2, float64(a.Y1+a.Y2)/2
				bx, by := float64(b.X1+b.X2)/2, float64(b.Y1+b.Y2)/2
				width := math.Max(float64(a.X2-a.X1), float64(b.X2-b.X1)) + 1
				if math.Hypot(ax-bx, ay-by)/width < 1.5 {
					near[i], near[j] = true, true
				}
			}
		}
		count := 0
		for _, n := range near {
			if n {
				count++
			}
		}
		if f := float64(count) / float64(len(boxes)); f > best {
			best = f
		}
	}
	return math.Round(best*1000) / 1000
}

// findEvidenceFrame returns the best still already on disk for a frame index,
// as an app-relative path, or "" if nothing exists.
//
// Prefers the annotated frame, which carries the person and prohibited-item
// boxes drawn during detection, over the raw sampled frame — for something
// like "reached toward Track-30" a bare image leaves the investigator to guess
// which person the system meant.
//
// Sampled frames are named "<videoID>__f<7 digits>__t<timestamp>.jpg", so the
// timestamp has to be globbed rather than constructed. Assuming a simpler name
// is a recurring failure here: detectObjects looked for "frame_%05d.jpg" and
// consequently never ran at all, and the first version of this fallback looked
// for "frame_%07d.jpg" and silently matched nothing.
func findEvidenceFrame(outDir, framesDir, videoID string, frameIdx int) string {
	annotated := filepath.Join(outDir, "annotated", fmt.Sprintf("annotated_frame_%07d.jpg", frameIdx))
	if _, err := os.Stat(annotated); err == nil {
		return filepath.ToSlash(annotated)
	}

	pattern := filepath.Join(framesDir, fmt.Sprintf("%s__f%07d__t*.jpg", videoID, frameIdx))
	if matches, err := filepath.Glob(pattern); err == nil && len(matches) > 0 {
		return filepath.ToSlash(matches[0])
	}

	return ""
}

// collectSnapshots returns the distinct evidence stills across an event's
// offences, preserving order so the strongest finding's still comes first.
func collectSnapshots(offences []Offence) []string {
	seen := make(map[string]bool)
	shots := []string{}
	for _, o := range offences {
		if o.Snapshot != "" && !seen[o.Snapshot] {
			seen[o.Snapshot] = true
			shots = append(shots, filepath.ToSlash(o.Snapshot))
		}
	}
	return shots
}

// collectTrackIDs lists the people seen during an event. Because one tracker
// now spans the whole video, these IDs are comparable between events — the
// basis for linking "the same person appears here and here".
func collectTrackIDs(tracks []PersonTrack) []string {
	ids := make([]string, 0, len(tracks))
	seen := make(map[string]bool)
	for _, t := range tracks {
		if t.TrackID != "" && !seen[t.TrackID] {
			seen[t.TrackID] = true
			ids = append(ids, t.TrackID)
		}
	}
	sort.Strings(ids)
	return ids
}

// computeObjectScore reduces prohibited-item findings to a single 0-1 signal
// for weighted re-scoring, using the strongest detection in the event.
func computeObjectScore(offences []Offence) float64 {
	best := 0.0
	for _, o := range offences {
		if o.Type == "prohibited_object" && o.Confidence > best {
			best = o.Confidence
		}
	}
	return math.Round(best*1000) / 1000
}

func derefTrackID(id *string) string {
	if id == nil {
		return ""
	}
	return *id
}

// bboxesOverlap checks if two bboxes overlap
func bboxesOverlap(a, b BBox) bool {
	return !(a.X2 < b.X1 || a.X1 > b.X2 || a.Y2 < b.Y1 || a.Y1 > b.Y2)
}

// buildDetectionSummary creates a summary of all detections in an event
func buildDetectionSummary(personTracks []PersonTrack, objectDetections []ObjectDetection) DetectionSummary {
	summary := DetectionSummary{
		TotalPersons: len(personTracks),
		TotalObjects: len(objectDetections),
		ObjectTypes:  []string{},
		HasPhone:     false,
		HasPaper:     false,
	}

	objTypeSet := make(map[string]bool)
	for _, obj := range objectDetections {
		objTypeSet[obj.ObjectType] = true
		if obj.ObjectType == "cell phone" {
			summary.HasPhone = true
		}
		if obj.ObjectType == "book" {
			summary.HasPaper = true
		}
	}

	for objType := range objTypeSet {
		summary.ObjectTypes = append(summary.ObjectTypes, objType)
	}

	return summary
}

// ============================================================
// Mock mode functions (when YOLO is not available)
// ============================================================

func generateMockPersonTracks(event Event, eventFrames []FrameROIs) []PersonTrack {
	// Generate 1-2 mock person tracks for demo
	numTracks := 1
	if event.ROISummary != nil {
		numTracks = min(2, max(1, len(eventFrames)/3))
	}

	tracks := make([]PersonTrack, numTracks)
	for i := 0; i < numTracks; i++ {
		bboxes := make([]BBox, 0, len(eventFrames))
		for j, frame := range eventFrames {
			if len(frame.ROIs) > 0 {
				roi := frame.ROIs[min(i, len(frame.ROIs)-1)]
				// Use ROI bbox as person bbox (with some shrinkage)
				shrink := 0.1
				w := float64(roi.BBoxX2 - roi.BBoxX1)
				h := float64(roi.BBoxY2 - roi.BBoxY1)
				bboxes = append(bboxes, BBox{
					FrameIdx:     frame.FrameIdx,
					TimestampSec: frame.TimestampSec,
					X1:           roi.BBoxX1 + int(w*shrink),
					Y1:           roi.BBoxY1 + int(h*shrink),
					X2:           roi.BBoxX2 - int(w*shrink),
					Y2:           roi.BBoxY2 - int(h*shrink),
					Confidence:   0.85 + float64(j%10)*0.01,
				})
			}
		}

		if len(bboxes) > 0 {
			tracks[i] = PersonTrack{
				TrackID:    fmt.Sprintf("Track-%02d", i+1),
				FirstSeen:  bboxes[0].TimestampSec,
				LastSeen:   bboxes[len(bboxes)-1].TimestampSec,
				FrameCount: len(bboxes),
				BBoxes:     bboxes,
				Confidence: 0.87,
			}
		}
	}

	return tracks
}

func generateMockObjectDetections(event Event, eventFrames []FrameROIs) []ObjectDetection {
	// 30% chance of detecting a phone, 20% chance of paper
	detections := []ObjectDetection{}

	// Mock phone detection
	if event.EventID%3 == 1 { // Every 3rd event has a phone
		phoneBBoxes := make([]BBox, 0)
		for _, frame := range eventFrames {
			if len(frame.ROIs) > 0 {
				roi := frame.ROIs[0]
				// Small bbox within ROI (phone is small)
				centerX := (roi.BBoxX1 + roi.BBoxX2) / 2
				centerY := (roi.BBoxY1 + roi.BBoxY2) / 2
				size := 40
				phoneBBoxes = append(phoneBBoxes, BBox{
					FrameIdx:     frame.FrameIdx,
					TimestampSec: frame.TimestampSec,
					X1:           centerX - size,
					Y1:           centerY - size,
					X2:           centerX + size,
					Y2:           centerY + size,
					Confidence:   0.78,
				})
			}
		}

		if len(phoneBBoxes) > 0 {
			detections = append(detections, ObjectDetection{
				ObjectType: "cell phone",
				FirstSeen:  phoneBBoxes[0].TimestampSec,
				LastSeen:   phoneBBoxes[len(phoneBBoxes)-1].TimestampSec,
				FrameCount: len(phoneBBoxes),
				BBoxes:     phoneBBoxes,
				Confidence: 0.78,
				TrackID:    stringPtr("Track-01"),
			})
		}
	}

	return detections
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func stringPtr(s string) *string {
	return &s
}

// ============================================================
// API response builder (matches frontend CONTRACT)
// ============================================================

func buildAPIResponse(header *Header, enrichedEvents []EnrichedEvent, eventsData *EventsData) APIResponse {
	metadata := VideoMetadata{
		Resolution:     fmt.Sprintf("%dx%d", header.Width, header.Height),
		FPS:            header.FPS,
		Sampling:       "5 fps", // Default from Module 2
		Frames:         header.FrameCount,
		ProcessingTime: "N/A",
	}

	// Compute average quality metrics from events
	var totalObs, totalShake float64
	eventCount := float64(len(enrichedEvents))
	for _, ev := range enrichedEvents {
		totalObs += ev.MeanQObservability
		// CameraShake not in Module 7 output, use camera_motion_pct as proxy
		totalShake += ev.CameraMotionPct
	}

	qualityMetrics := QualityMetrics{
		Observability: totalObs / math.Max(eventCount, 1),
		CameraShake:   totalShake / math.Max(eventCount, 1),
		Blur:          0.0, // Not available yet
		Lighting:      0.0, // Not available yet
		Occlusion:     0.0, // Not available yet
	}

	// Convert enriched events to API format
	apiEvents := make([]APIEvent, 0, len(enrichedEvents))
	for _, ev := range enrichedEvents {
		// Determine priority based on motion score and detection summary
		priority := determinePriority(ev)

		// Build description
		description := buildEventDescription(ev)

		// Get primary track ID
		trackID := "N/A"
		if len(ev.PersonTracks) > 0 {
			trackID = ev.PersonTracks[0].TrackID
		}

		// Build evidence list
		evidence := buildEvidence(ev)

		// Clip URLs
		clipURL := ""
		annotatedURL := ""
		if ev.ClipPath != nil {
			clipURL = *ev.ClipPath
			annotatedURL = *ev.ClipPath // Same for now, would need separate annotated clip generation
		}

		// Detection info
		detectionInfo := DetectionInfo{
			Confidence: ev.MeanSFinal,
			Object:     "person", // Default
		}
		if ev.DetectionSummary.HasPhone {
			detectionInfo.Object = "person with phone"
		}

		apiEvent := APIEvent{
			ID:            fmt.Sprintf("event-%d", ev.EventID),
			VideoID:       eventsData.VideoID,
			Start:         ev.Start,
			End:           ev.End,
			Duration:      ev.Duration,
			MotionScore:   ev.PeakSFinal,
			CameraShake:   ev.CameraMotionPct,
			Priority:      priority,
			Type:          determineEventType(ev),
			Description:   description,
			TrackID:       trackID,
			ROI:           ev.ROI,
			ClipURL:       clipURL,
			AnnotatedURL:  annotatedURL,
			Detection:     detectionInfo,
			Observability: ev.MeanQObservability,
			QualityFactors: QualityMetrics{
				CameraShake: ev.CameraMotionPct,
				Blur:        0.0,
				Occlusion:   0.0,
				Lighting:    1.0 - ev.MeanQObservability, // Proxy
			},
			Evidence:        evidence,
			Status:          ev.Status,
			MotionCharacter: ev.MotionCharacter,
			PeakJerkScore:   ev.PeakJerkScore,
			Offences:        ev.Offences,
			Snapshots:       collectSnapshots(ev.Offences),
			TrackIDs:        collectTrackIDs(ev.PersonTracks),
			PersonCount:     len(ev.PersonTracks),
			ObjectClasses:   ev.DetectionSummary.ObjectTypes,
			ObjectScore:     computeObjectScore(ev.Offences),
			PersonProximity: computePersonProximity(ev.PersonTracks),
		}
		apiEvent.UncertaintyReasons = buildUncertaintyReasons(ev)
		apiEvent.Explanations = buildExplanations(apiEvent, ev)
		apiEvents = append(apiEvents, apiEvent)
	}

	return APIResponse{
		VideoID:        header.VideoID,
		VideoPath:      header.VideoPath,
		Metadata:       metadata,
		QualityMetrics: qualityMetrics,
		EventCount:     len(apiEvents),
		Events:         apiEvents,
		ProcessingInfo: ProcessingInfo{
			TotalElapsedSec: 0.0, // Would track actual time
			ModulesRun:      []string{"1-7 (Python)", "8-9 (Golang)"},
			Timestamp:       filepath.Base(header.VideoID),
		},
	}
}

func determinePriority(ev EnrichedEvent) string {
	// High: phone detected OR high motion score
	// Medium: person detected OR moderate motion
	// Low: everything else
	if ev.DetectionSummary.HasPhone || ev.PeakSFinal > 0.7 {
		return "high"
	}
	if ev.DetectionSummary.TotalPersons > 0 || ev.PeakSFinal > 0.4 {
		return "medium"
	}
	return "low"
}

func determineEventType(ev EnrichedEvent) string {
	if ev.DetectionSummary.HasPhone {
		return "phone_activity"
	}
	if ev.DetectionSummary.HasPaper {
		return "paper_activity"
	}
	if ev.DetectionSummary.TotalPersons > 1 {
		return "proximity"
	}
	if ev.CameraMotionPct > 0.5 {
		return "camera_motion"
	}
	return "unusual_motion"
}

func buildEventDescription(ev EnrichedEvent) string {
	if ev.DetectionSummary.HasPhone {
		return fmt.Sprintf("Person detected with cell phone (%d tracks, %.1f%% motion)",
			ev.DetectionSummary.TotalPersons, ev.PeakSFinal*100)
	}
	if ev.DetectionSummary.TotalPersons > 1 {
		return fmt.Sprintf("Multiple persons detected in proximity (%d tracks)",
			ev.DetectionSummary.TotalPersons)
	}
	if ev.DetectionSummary.TotalPersons == 1 {
		return fmt.Sprintf("Person detected with unusual motion (score: %.2f)", ev.PeakSFinal)
	}
	return fmt.Sprintf("Motion detected (score: %.2f, observability: %.2f)",
		ev.PeakSFinal, ev.MeanQObservability)
}

func buildEvidence(ev EnrichedEvent) []string {
	evidence := []string{
		fmt.Sprintf("Motion score: %.2f (peak), %.2f (mean)", ev.PeakSFinal, ev.MeanSFinal),
		fmt.Sprintf("Observability: %.2f", ev.MeanQObservability),
		fmt.Sprintf("Frames analyzed: %d", ev.FrameCount),
	}

	if ev.DetectionSummary.TotalPersons > 0 {
		evidence = append(evidence, fmt.Sprintf("Person tracks detected: %d", ev.DetectionSummary.TotalPersons))
	}

	if ev.DetectionSummary.HasPhone {
		evidence = append(evidence, "Cell phone detected in frame")
	}

	if ev.DetectionSummary.HasPaper {
		evidence = append(evidence, "Paper/book detected in frame")
	}

	if ev.CameraMotionPct > 0.3 {
		evidence = append(evidence, fmt.Sprintf("Possible camera motion: %.1f%% of frames", ev.CameraMotionPct*100))
	}

	if ev.MotionCharacter == "sudden" {
		evidence = append(evidence, fmt.Sprintf("Sudden onset detected (jerk saliency: %.2f) — abrupt, non-periodic motion rather than gradual movement", ev.PeakJerkScore))
	}

	return evidence
}


// ---------------------------------------------------------------------------
// Feature 10.3 — camera-aware uncertainty
// ---------------------------------------------------------------------------

// uncertaintyBand converts a 0-1 quality signal into the band an investigator
// reads. Thresholds are the agreed ones: >0.6 high, 0.3-0.6 medium, <0.3 low.
func uncertaintyBand(v float64) string {
	switch {
	case v > 0.6:
		return "high"
	case v >= 0.3:
		return "medium"
	default:
		return "low"
	}
}

// buildUncertaintyReasons re-presents signals that already exist on the event;
// it measures nothing new.
//
// lighting_change reuses the same (1 - observability) proxy that
// QualityFactors.Lighting already reports, so the label can never disagree
// with the number rendered beside it. blur and occlusion are reported as
// "unavailable" because Module 6 does not currently feed them through — see
// UncertaintyReasons' doc comment.
func buildUncertaintyReasons(ev EnrichedEvent) UncertaintyReasons {
	return UncertaintyReasons{
		CameraShake:    uncertaintyBand(ev.CameraMotionPct),
		Blur:           "unavailable",
		LightingChange: uncertaintyBand(1.0 - ev.MeanQObservability),
		Occlusion:      "unavailable",
	}
}

// dominantUncertainty names the single worst *measured* factor, for use as an
// explanation's one-line caveat. Unavailable factors are skipped rather than
// competing as if they scored zero.
func dominantUncertainty(u UncertaintyReasons) string {
	rank := map[string]int{"low": 0, "medium": 1, "high": 2}
	best, bestRank := "", -1
	for _, f := range []struct{ name, band string }{
		{"camera_shake", u.CameraShake},
		{"lighting_change", u.LightingChange},
		{"blur", u.Blur},
		{"occlusion", u.Occlusion},
	} {
		r, ok := rank[f.band]
		if !ok {
			continue // "unavailable"
		}
		if r > bestRank {
			best, bestRank = fmt.Sprintf("%s: %s", f.name, f.band), r
		}
	}
	if best == "" {
		return "unavailable"
	}
	return best
}

// ---------------------------------------------------------------------------
// Feature 10.6 — grounded explanations
// ---------------------------------------------------------------------------

// frameURL points at the annotated still for a frame. The route falls back to
// the raw sampled frame when no annotated version exists, so the link is valid
// whether or not that frame carried a detection.
func frameURL(frameIdx int) string {
	return fmt.Sprintf("/api/annotated?frame=%d", frameIdx)
}

// validateGrounding enforces the promise 10.6 makes: an explanation shown to an
// investigator must be traceable back to the pixels it came from.
//
// Until now that was only a doc comment, and comments do not hold. Offences
// legitimately reach here with an empty BBox (crowd_disturbance is a
// property of a group, not a box) and an event whose ROI never resolved
// carries an empty one too — so a claim could be emitted labelled "grounded"
// while pointing at nothing checkable.
//
// The rule is deliberately asymmetric. A claim missing *some* grounding is
// labelled with what it does have, so a reviewer can see the difference
// between "here is the box" and "here is only the frame". A claim missing
// *all* of it is dropped: an unfalsifiable assertion in a surveillance
// report is worse than a gap, because it still accuses someone.
func validateGrounding(ex Explanation) (Explanation, bool) {
	if strings.TrimSpace(ex.Claim) == "" {
		return ex, false
	}
	hasSpatial := len(ex.ObjectBBox) == 4 || len(ex.ROI) == 4
	hasTemporal := len(ex.SupportingFrameURLs) > 0

	switch {
	case hasSpatial && hasTemporal:
		ex.Grounding = "full"
	case hasSpatial:
		ex.Grounding = "spatial"
	case hasTemporal:
		ex.Grounding = "temporal"
	default:
		return ex, false // nothing to point at — do not make the claim
	}
	if ex.UncertaintyReason == "" {
		ex.UncertaintyReason = "unavailable"
	}
	return ex, true
}

// buildExplanations emits one grounded explanation per claim the API makes
// about an event (feature 10.6).
//
// Every offence becomes an explanation carrying the frame, ROI, object box and
// track it was derived from, so nothing shown to an investigator is a floating
// assertion. A final entry covers the event-level motion claim, which is
// otherwise stated only as free text in Evidence.
func buildExplanations(api APIEvent, ev EnrichedEvent) []Explanation {
	explanations := make([]Explanation, 0, len(ev.Offences)+1)
	caveat := dominantUncertainty(api.UncertaintyReasons)

	for _, off := range ev.Offences {
		urls := []string{frameURL(off.FrameIdx)}
		if off.Snapshot != "" {
			urls = append(urls, "/api/snapshot?path="+filepath.ToSlash(off.Snapshot))
		}

		// Feature 10.4 feeding 10.6: state the claim together with how that
		// part of the room was behaving, so a reviewer sees the corroboration
		// or the lack of it instead of having to assume it.
		claim := off.Label
		if off.Region != "" {
			if off.RegionZ != 0 {
				claim = fmt.Sprintf("%s (region %s was %.1f sigma above its own baseline)",
					claim, off.Region, off.RegionZ)
			} else {
				claim = fmt.Sprintf("%s (region %s was within its normal range)",
					claim, off.Region)
			}
		}
		ex, ok := validateGrounding(Explanation{
			EventID:             api.ID,
			Claim:               claim,
			Timestamp:           off.StartSec,
			TrackID:             off.TrackID,
			ROI:                 ev.ROI,
			ObjectBBox:          off.BBox,
			SupportingFrameURLs: urls,
			UncertaintyReason:   caveat,
		})
		if ok {
			explanations = append(explanations, ex)
		} else {
			log.Printf("[10.6] dropped ungrounded claim on event %s: %q", api.ID, off.Label)
		}
	}

	// Event-level motion claim, grounded on the frame where the event starts.
	motionEx, ok := validateGrounding(Explanation{
		EventID: api.ID,
		Claim: fmt.Sprintf("Motion peaked at %.2f over %d analysed frames (%s onset)",
			ev.PeakSFinal, ev.FrameCount, motionCharacterOrUnknown(ev.MotionCharacter)),
		Timestamp:           ev.Start,
		TrackID:             api.TrackID,
		ROI:                 ev.ROI,
		SupportingFrameURLs: []string{frameURL(ev.StartFrameIdx)},
		UncertaintyReason:   caveat,
	})
	if ok {
		explanations = append(explanations, motionEx)
	}

	return explanations
}

func motionCharacterOrUnknown(mc string) string {
	if mc == "" {
		return "unclassified"
	}
	return mc
}
