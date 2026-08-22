// +build !cgo

package main

import (
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"os"
)

// YOLOInference handles YOLO inference
// This is the NO-CGO version - ready to be replaced when CGO is available
type YOLOInference struct {
	confidenceThresh float64
	nmsThresh        float64
	inputSize        int
	classNames       []string
	personClassID    int
	phoneClassID     int
	bookClassID      int
	initialized      bool
}

type YOLODetectionResult struct {
	BBox       image.Rectangle
	ClassID    int
	ClassName  string
	Confidence float64
}

// NewYOLOInference creates inference engine (NO-CGO stub)
func NewYOLOInference(modelPath string, confidenceThresh float64) (*YOLOInference, error) {
	log.Println("[WARN] Running in NO-CGO mode - real YOLO inference disabled")
	log.Println("[INFO] To enable real YOLO:")
	log.Println("[INFO]   1. Install MinGW-w64 (x86_64)")
	log.Println("[INFO]   2. Set CGO_ENABLED=1")
	log.Println("[INFO]   3. Rebuild with: go build -tags cgo")
	log.Println("[INFO] See YOLO_CGO_ISSUE.md for details")
	
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

	inf := &YOLOInference{
		confidenceThresh: confidenceThresh,
		nmsThresh:        0.4,
		inputSize:        640,
		classNames:       classNames,
		personClassID:    personID,
		phoneClassID:     phoneID,
		bookClassID:      bookID,
		initialized:      false,
	}

	// Check if model exists (for future use)
	if _, err := os.Stat(modelPath); os.IsNotExist(err) {
		log.Printf("[INFO] Model will be loaded when CGO is enabled: %s", modelPath)
	}

	return inf, nil
}

// InferFrame returns error indicating CGO is needed
func (yi *YOLOInference) InferFrame(framePath string, roi image.Rectangle) ([]YOLODetectionResult, error) {
	return nil, fmt.Errorf("real YOLO inference requires CGO - see YOLO_CGO_ISSUE.md")
}

// Close releases resources (no-op)
func (yi *YOLOInference) Close() error {
	return nil
}
