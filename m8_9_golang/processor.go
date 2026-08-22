package main

import (
	"fmt"
	"image"
	"log"
	"math"
	"os"
	"path/filepath"
)

// processEvents enriches events with person detection and object detection
func processEvents(events []Event, roisData *ROIsData, framesDir string, detector *YOLODetector, header *Header, outDir string) []EnrichedEvent {
	enriched := make([]EnrichedEvent, 0, len(events))

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
		if detector != nil {
			personTracks := detectAndTrackPersons(event, eventFrames, framesDir, header.VideoID, detector, header, outDir)
			enrichedEvent.PersonTracks = personTracks
		} else {
			// Mock mode: generate fake person tracks
			enrichedEvent.PersonTracks = generateMockPersonTracks(event, eventFrames)
		}

		// Run object detection (Module 9)
		if detector != nil {
			objectDetections := detectObjects(event, eventFrames, framesDir, header.VideoID, detector, header, enrichedEvent.PersonTracks)
			enrichedEvent.ObjectDetections = objectDetections
		} else {
			// Mock mode: generate fake object detections
			enrichedEvent.ObjectDetections = generateMockObjectDetections(event, eventFrames)
		}

		// Build detection summary
		enrichedEvent.DetectionSummary = buildDetectionSummary(enrichedEvent.PersonTracks, enrichedEvent.ObjectDetections)

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
func detectAndTrackPersons(event Event, eventFrames []FrameROIs, framesDir string, videoID string, detector *YOLODetector, header *Header, outDir string) []PersonTrack {
	if detector == nil {
		// Mock mode - generate realistic person tracks
		return generateMockPersonTracks(event, eventFrames)
	}
	
	tracker := NewByteTracker()
	trackBBoxes := make(map[int][]BBox)

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

		// Save annotated frame if detections found
		if len(detections) > 0 {
			annotatedPath := filepath.Join(annotatedDir, fmt.Sprintf("annotated_frame_%07d.jpg", frameIdx))
			if err := detector.AnnotateFrame(framePath, detections, annotatedPath); err != nil {
				log.Printf("[WARN] Failed to annotate frame %d: %v", frameIdx, err)
			} else {
				log.Printf("[INFO] Annotated frame %d with %d detections", frameIdx, len(detections))
			}
		}

		// Update tracker with person detections
		activeTracks := tracker.Update(detections)

		// Store bboxes per track
		fps := header.FPS
		timestampSec := float64(frameIdx) / fps
		for _, track := range activeTracks {
			for _, det := range track.Detections {
				bbox := BBox{
					FrameIdx:     frameIdx,
					TimestampSec: timestampSec,
					X1:           det.BBox.Min.X,
					Y1:           det.BBox.Min.Y,
					X2:           det.BBox.Max.X,
					Y2:           det.BBox.Max.Y,
					Confidence:   det.Confidence,
				}
				trackBBoxes[track.ID] = append(trackBBoxes[track.ID], bbox)
			}
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

	return personTracks
}

// detectObjects runs object detection (phone, paper, etc.)
func detectObjects(event Event, eventFrames []FrameROIs, framesDir string, videoID string, detector *YOLODetector, header *Header, personTracks []PersonTrack) []ObjectDetection {
	if detector == nil {
		// Mock mode
		return generateMockObjectDetections(Event{}, eventFrames)
	}
	
	objectBBoxes := make(map[string][]BBox) // object_type -> bboxes

	for _, frame := range eventFrames {
		// Build frame path
		framePath := filepath.Join(framesDir, fmt.Sprintf("frame_%05d.jpg", frame.FrameIdx))
		if _, err := os.Stat(framePath); os.IsNotExist(err) {
			continue
		}

		// Run detection on each ROI
		var allDetections []Detection
		for _, roi := range frame.ROIs {
			roiRect := image.Rect(roi.BBoxX1, roi.BBoxY1, roi.BBoxX2, roi.BBoxY2)
			detections, err := detector.DetectFrame(framePath, roiRect)
			if err != nil {
				continue
			}
			allDetections = append(allDetections, detections...)
		}

		// Store bboxes per object type (filter out persons)
		for _, det := range allDetections {
			if det.ClassName != "person" {
				bbox := BBox{
					FrameIdx:     frame.FrameIdx,
					TimestampSec: frame.TimestampSec,
					X1:           det.BBox.Min.X,
					Y1:           det.BBox.Min.Y,
					X2:           det.BBox.Max.X,
					Y2:           det.BBox.Max.Y,
					Confidence:   det.Confidence,
				}
				objectBBoxes[det.ClassName] = append(objectBBoxes[det.ClassName], bbox)
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
		}
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
