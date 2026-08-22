// +build cgo

package main

import (
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"math"
	"os"
	"sort"

	ort "github.com/yalue/onnxruntime_go"
	"github.com/nfnt/resize"
)

// YOLOInference handles real YOLO inference using ONNX Runtime
type YOLOInference struct {
	session          *ort.AdvancedSession
	inputShape       []int64
	outputShape      []int64
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

// NewYOLOInference creates a real YOLO inference engine
func NewYOLOInference(modelPath string, confidenceThresh float64) (*YOLOInference, error) {
	log.Println("[INFO] Initializing YOLO inference engine...")

	// COCO class names (80 classes)
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

	inf := &YOLOInference{
		inputShape:       []int64{1, 3, 640, 640},
		confidenceThresh: confidenceThresh,
		nmsThresh:        0.4,
		inputSize:        640,
		classNames:       classNames,
		personClassID:    personID,
		phoneClassID:     phoneID,
		bookClassID:      bookID,
		initialized:      false,
	}

	// Check if model file exists
	if _, err := os.Stat(modelPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("YOLO model not found at %s - please download yolov8n.onnx", modelPath)
	}

	// Initialize ONNX Runtime
	if !ort.IsInitialized() {
		ort.SetSharedLibraryPath("onnxruntime.dll") // Windows
		err := ort.InitializeEnvironment()
		if err != nil {
			return nil, fmt.Errorf("failed to initialize ONNX runtime: %v", err)
		}
	}

	// Create session
	session, err := ort.NewAdvancedSession(modelPath,
		[]string{"images"}, []string{"output0"},
		[][]int64{inf.inputShape}, [][]int64{{1, 84, 8400}},
		nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create ONNX session: %v", err)
	}

	inf.session = session
	inf.initialized = true

	log.Printf("[INFO] YOLO model loaded: %s", modelPath)
	log.Println("[INFO] Running in REAL YOLO inference mode")

	return inf, nil
}

// InferFrame runs real YOLO inference on a frame
func (yi *YOLOInference) InferFrame(framePath string, roi image.Rectangle) ([]YOLODetectionResult, error) {
	if !yi.initialized {
		return nil, fmt.Errorf("YOLO not initialized")
	}

	// 1. Load image
	img, err := yi.loadImage(framePath)
	if err != nil {
		return nil, fmt.Errorf("failed to load image: %v", err)
	}

	// 2. Preprocess: resize and normalize
	inputTensor, originalSize := yi.preprocessImage(img)

	// 3. Run ONNX inference
	outputs, err := yi.session.Run([]ort.ArbitraryTensor{inputTensor})
	if err != nil {
		inputTensor.Destroy()
		return nil, fmt.Errorf("inference failed: %v", err)
	}

	// 4. Post-process: decode boxes and apply NMS
	detections := yi.postProcess(outputs[0], originalSize, roi)

	// Cleanup
	inputTensor.Destroy()
	outputs[0].Destroy()

	return detections, nil
}

// loadImage loads an image from disk
func (yi *YOLOInference) loadImage(path string) (image.Image, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	img, _, err := image.Decode(file)
	return img, err
}

// preprocessImage resizes and normalizes image for YOLO
func (yi *YOLOInference) preprocessImage(img image.Image) (ort.ArbitraryTensor, image.Point) {
	bounds := img.Bounds()
	originalSize := image.Point{X: bounds.Dx(), Y: bounds.Dy()}

	// Resize to 640x640
	resized := resize.Resize(uint(yi.inputSize), uint(yi.inputSize), img, resize.Bilinear)

	// Convert to float32 tensor [1, 3, 640, 640]
	// Channel order: RGB, normalized to [0, 1]
	tensorData := make([]float32, 1*3*yi.inputSize*yi.inputSize)

	idx := 0
	// R channel
	for y := 0; y < yi.inputSize; y++ {
		for x := 0; x < yi.inputSize; x++ {
			r, _, _, _ := resized.At(x, y).RGBA()
			tensorData[idx] = float32(r>>8) / 255.0
			idx++
		}
	}
	// G channel
	for y := 0; y < yi.inputSize; y++ {
		for x := 0; x < yi.inputSize; x++ {
			_, g, _, _ := resized.At(x, y).RGBA()
			tensorData[idx] = float32(g>>8) / 255.0
			idx++
		}
	}
	// B channel
	for y := 0; y < yi.inputSize; y++ {
		for x := 0; x < yi.inputSize; x++ {
			_, _, b, _ := resized.At(x, y).RGBA()
			tensorData[idx] = float32(b>>8) / 255.0
			idx++
		}
	}

	tensor, err := ort.NewTensor(ort.NewShape(yi.inputShape...), tensorData)
	if err != nil {
		log.Printf("[ERROR] Failed to create tensor: %v", err)
		return nil, originalSize
	}

	return tensor, originalSize
}

// postProcess decodes YOLO output and applies NMS
func (yi *YOLOInference) postProcess(output ort.ArbitraryTensor, originalSize image.Point, roi image.Rectangle) []YOLODetectionResult {
	// YOLOv8 output shape: [1, 84, 8400]
	// 84 = 4 (bbox) + 80 (classes)
	// 8400 = 80*80 + 40*40 + 20*20 (three detection scales)

	outputData := output.GetData()
	floatData, ok := outputData.([]float32)
	if !ok {
		log.Println("[ERROR] Output tensor is not float32")
		return nil
	}

	var rawDetections []YOLODetectionResult

	// Parse 8400 detections
	for i := 0; i < 8400; i++ {
		// Get bbox coordinates (center format)
		cx := floatData[i]
		cy := floatData[8400+i]
		w := floatData[2*8400+i]
		h := floatData[3*8400+i]

		// Find max class confidence and ID
		maxConf := float32(0.0)
		maxClassID := 0
		for c := 0; c < 80; c++ {
			conf := floatData[(4+c)*8400+i]
			if conf > maxConf {
				maxConf = conf
				maxClassID = c
			}
		}

		// Filter by confidence threshold
		if maxConf < float32(yi.confidenceThresh) {
			continue
		}

		// Convert center format to corner format
		// Scale from 640x640 to original size
		scaleX := float32(originalSize.X) / float32(yi.inputSize)
		scaleY := float32(originalSize.Y) / float32(yi.inputSize)

		x1 := int((cx - w/2) * scaleX)
		y1 := int((cy - h/2) * scaleY)
		x2 := int((cx + w/2) * scaleX)
		y2 := int((cy + h/2) * scaleY)

		// Clamp to image bounds
		if x1 < 0 {
			x1 = 0
		}
		if y1 < 0 {
			y1 = 0
		}
		if x2 > originalSize.X {
			x2 = originalSize.X
		}
		if y2 > originalSize.Y {
			y2 = originalSize.Y
		}

		bbox := image.Rect(x1, y1, x2, y2)

		// Filter by ROI if specified
		if !roi.Empty() {
			// Check if detection overlaps with ROI
			if !bbox.Overlaps(roi) {
				continue
			}
		}

		className := "unknown"
		if maxClassID >= 0 && maxClassID < len(yi.classNames) {
			className = yi.classNames[maxClassID]
		}

		rawDetections = append(rawDetections, YOLODetectionResult{
			BBox:       bbox,
			ClassID:    maxClassID,
			ClassName:  className,
			Confidence: float64(maxConf),
		})
	}

	// Apply Non-Maximum Suppression
	finalDetections := yi.applyNMS(rawDetections)

	log.Printf("[INFO] Detected %d objects (after NMS from %d raw detections)", len(finalDetections), len(rawDetections))

	return finalDetections
}

// applyNMS performs Non-Maximum Suppression
func (yi *YOLOInference) applyNMS(detections []YOLODetectionResult) []YOLODetectionResult {
	if len(detections) <= 1 {
		return detections
	}

	// Sort by confidence (descending)
	sort.Slice(detections, func(i, j int) bool {
		return detections[i].Confidence > detections[j].Confidence
	})

	var keep []YOLODetectionResult

	for i := 0; i < len(detections); i++ {
		shouldKeep := true

		for j := 0; j < len(keep); j++ {
			// Only apply NMS within same class
			if detections[i].ClassID == keep[j].ClassID {
				iou := computeIOUInference(detections[i].BBox, keep[j].BBox)
				if iou > yi.nmsThresh {
					shouldKeep = false
					break
				}
			}
		}

		if shouldKeep {
			keep = append(keep, detections[i])
		}
	}

	return keep
}

// computeIOUInference calculates Intersection over Union
func computeIOUInference(box1, box2 image.Rectangle) float64 {
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

// Close releases ONNX session resources
func (yi *YOLOInference) Close() error {
	if yi.session != nil {
		yi.session.Destroy()
	}
	return nil
}
