package main

import (
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"log"
)

// YOLODetector wraps YOLO model for person and object detection (real inference via Python)
type YOLODetector struct {
	confidenceThresh float64
	nmsThresh        float64
	inputSize        int
	classNames       []string
	personClassID    int
	phoneClassID     int
	bookClassID      int
	pythonBridge     *YOLOPythonBridge
}

// Detection represents a single detection (bbox + class + confidence)
type Detection struct {
	BBox       image.Rectangle
	ClassID    int
	ClassName  string
	Confidence float64
}

// NewYOLODetector initializes YOLO detector with Python bridge
func NewYOLODetector(modelPath string, confidenceThresh float64) (*YOLODetector, error) {
	log.Println("[INFO] Initializing YOLO detector...")
	
	// Start Python YOLO service
	pythonScript := "yolo_python_inference.py"
	bridge, err := NewYOLOPythonBridge(pythonScript)
	if err != nil {
		return nil, fmt.Errorf("failed to start Python YOLO service: %v", err)
	}
	
	classNames := []string{
		"person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
		"traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat",
		"dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
		"umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball",
		"kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
		"bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
		"sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake",
		"chair", "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop",
		"mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
		"refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
	}

	// Find class IDs
	personID := -1
	phoneID := -1
	bookID := -1
	for i, name := range classNames {
		if name == "person" {
			personID = i
		} else if name == "cell phone" {
			phoneID = i
		} else if name == "book" {
			bookID = i
		}
	}

	detector := &YOLODetector{
		confidenceThresh: confidenceThresh,
		nmsThresh:        0.4,
		inputSize:        640,
		classNames:       classNames,
		personClassID:    personID,
		phoneClassID:     phoneID,
		bookClassID:      bookID,
		pythonBridge:     bridge,
	}

	return detector, nil
}

// DetectFrame runs detection on a frame using real YOLO via Python
func (d *YOLODetector) DetectFrame(framePath string, roi image.Rectangle) ([]Detection, error) {
	// Convert ROI to slice
	var roiSlice []int
	if !roi.Empty() {
		roiSlice = []int{roi.Min.X, roi.Min.Y, roi.Max.X, roi.Max.Y}
	}
	
	// Call Python YOLO service
	pythonDetections, err := d.pythonBridge.InferFrame(framePath, roiSlice)
	if err != nil {
		return nil, fmt.Errorf("YOLO inference failed: %v", err)
	}
	
	// Convert to Detection format
	detections := make([]Detection, len(pythonDetections))
	for i, pdet := range pythonDetections {
		detections[i] = Detection{
			BBox:       image.Rect(pdet.BBox[0], pdet.BBox[1], pdet.BBox[2], pdet.BBox[3]),
			ClassID:    pdet.ClassID,
			ClassName:  pdet.ClassName,
			Confidence: pdet.Confidence,
		}
	}
	
	return detections, nil
}

// PoseFrame is everyone's skeleton on one frame.
type PoseFrame struct {
	FrameIdx     int
	TimestampSec float64
	People       []YOLOPose
}

// DetectPose returns body keypoints for everyone in a frame.
func (d *YOLODetector) DetectPose(framePath string) ([]YOLOPose, error) {
	if d.pythonBridge == nil {
		return nil, fmt.Errorf("pose requires the Python inference service")
	}
	return d.pythonBridge.InferPose(framePath)
}

// AnnotateFrame draws bounding boxes using Python service
func (d *YOLODetector) AnnotateFrame(framePath string, detections []Detection, outputPath string) error {
	// Convert detections to Python format
	pythonDets := make([]YOLODetection, len(detections))
	for i, det := range detections {
		pythonDets[i] = YOLODetection{
			BBox:       []int{det.BBox.Min.X, det.BBox.Min.Y, det.BBox.Max.X, det.BBox.Max.Y},
			ClassID:    det.ClassID,
			ClassName:  det.ClassName,
			Confidence: det.Confidence,
		}
	}
	
	return d.pythonBridge.AnnotateFrame(framePath, pythonDets, outputPath)
}

// Close releases resources
func (d *YOLODetector) Close() {
	if d.pythonBridge != nil {
		d.pythonBridge.Close()
	}
	log.Println("[INFO] Detector closed")
}

// ByteTracker implements simple person tracking
type ByteTracker struct {
	tracks         []*Track
	nextTrackID    int
	maxAge         int
	minHits        int
	iouThreshold   float64
	frameCount     int
}

// Track represents a tracked person
type Track struct {
	ID           int
	BBox         image.Rectangle
	LastBBox     image.Rectangle
	Detections   []Detection
	Age          int
	Hits         int
	TimeSinceSeen int
	IsActive     bool
	// Wall-clock position in the video when this track was last matched.
	// Needed because the tracker now spans a whole video: detection only
	// runs inside event windows, so consecutive Update() calls can be
	// separated by long stretches of unprocessed footage, and "how many
	// updates ago" is no longer a usable proxy for "how long ago".
	LastSeenSec float64
}

// NewByteTracker creates a new tracker
func NewByteTracker() *ByteTracker {
	return &ByteTracker{
		tracks:       []*Track{},
		nextTrackID:  1,
		maxAge:       30,
		minHits:      3,
		iouThreshold: 0.3,
		frameCount:   0,
	}
}

// Update processes new detections and updates tracks
func (bt *ByteTracker) Update(detections []Detection) []*Track {
	bt.frameCount++
	
	// Filter for person detections only
	personDetections := []Detection{}
	for _, det := range detections {
		if det.ClassName == "person" {
			personDetections = append(personDetections, det)
		}
	}
	
	// Match detections to existing tracks
	matched := make(map[int]bool)
	for i, track := range bt.tracks {
		if !track.IsActive {
			continue
		}
		
		// Find best matching detection
		bestIOU := 0.0
		bestIdx := -1
		for j, det := range personDetections {
			if matched[j] {
				continue
			}
			iou := computeIOU(track.LastBBox, det.BBox)
			if iou > bestIOU && iou > bt.iouThreshold {
				bestIOU = iou
				bestIdx = j
			}
		}
		
		if bestIdx >= 0 {
			// Update track. Only the most recent detection is retained —
			// callers read the current position, and accumulating every
			// past detection grew without bound and let callers re-emit
			// the whole history on every frame.
			track.LastBBox = personDetections[bestIdx].BBox
			track.Detections = []Detection{personDetections[bestIdx]}
			track.Hits++
			track.TimeSinceSeen = 0
			matched[bestIdx] = true
		} else {
			// Track not matched
			track.TimeSinceSeen++
			if track.TimeSinceSeen > bt.maxAge {
				bt.tracks[i].IsActive = false
			}
		}
	}
	
	// Create new tracks for unmatched detections
	for i, det := range personDetections {
		if !matched[i] {
			track := &Track{
				ID:           bt.nextTrackID,
				BBox:         det.BBox,
				LastBBox:     det.BBox,
				Detections:   []Detection{det},
				Age:          0,
				Hits:         1,
				TimeSinceSeen: 0,
				IsActive:     true,
			}
			bt.tracks = append(bt.tracks, track)
			bt.nextTrackID++
		}
	}
	
	// Return active tracks with enough hits
	activeTracks := []*Track{}
	for _, track := range bt.tracks {
		if track.IsActive && track.Hits >= bt.minHits {
			activeTracks = append(activeTracks, track)
		}
	}
	
	return activeTracks
}

// ExpireBefore retires tracks last seen earlier than cutoffSec.
//
// One tracker now spans an entire video so that IDs identify a person rather
// than "whoever was detected first in this event". The trade-off is that
// between two events lies footage nobody looked at, and a track left alive
// across that gap will happily match, by position alone, whoever is standing
// there when detection resumes. Past a modest gap that inference is not
// credible, so those tracks are retired and the next person to appear there
// gets a fresh identity instead of inheriting someone else's history.
func (bt *ByteTracker) ExpireBefore(cutoffSec float64) {
	for _, track := range bt.tracks {
		if track.IsActive && track.LastSeenSec < cutoffSec {
			track.IsActive = false
		}
	}
}

// GetActiveTracks returns currently active tracks
func (bt *ByteTracker) GetActiveTracks() []*Track {
	active := []*Track{}
	for _, track := range bt.tracks {
		if track.IsActive && track.Hits >= bt.minHits {
			active = append(active, track)
		}
	}
	return active
}

// computeIOU calculates Intersection over Union
func computeIOU(box1, box2 image.Rectangle) float64 {
	intersection := box1.Intersect(box2)
	if intersection.Empty() {
		return 0.0
	}
	
	interArea := float64(intersection.Dx() * intersection.Dy())
	box1Area := float64(box1.Dx() * box1.Dy())
	box2Area := float64(box2.Dx() * box2.Dy())
	
	union := box1Area + box2Area - interArea
	if union <= 0 {
		return 0.0
	}
	
	return interArea / union
}

// FormatTrackID returns anonymized track ID
func FormatTrackID(trackID int) string {
	return fmt.Sprintf("Track-%02d", trackID)
}
