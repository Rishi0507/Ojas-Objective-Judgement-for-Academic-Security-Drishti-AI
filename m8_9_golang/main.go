package main

import (
	"encoding/json"
	"flag"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"time"
)

func main() {
	// CLI arguments
	eventsJSON := flag.String("events-json", "", "Path to events.json from Module 7")
	roisJSON := flag.String("rois-json", "", "Path to rois_per_frame.json from Module 5 (optional, will use event ROIs if not provided)")
	headerJSON := flag.String("header-json", "", "Path to header.json from Module 1")
	framesDir := flag.String("frames-dir", "", "Directory of sampled frames from Module 2")
	outDir := flag.String("out-dir", "", "Output directory for enriched results")
	yoloModel := flag.String("yolo-model", "yolov8n.onnx", "Path to YOLO ONNX model")
	confidenceThresh := flag.Float64("confidence", 0.5, "Detection confidence threshold")
	flag.Parse()

	if *eventsJSON == "" || *headerJSON == "" || *framesDir == "" || *outDir == "" {
		log.Fatal("Missing required arguments. Usage: --events-json <path> --header-json <path> --frames-dir <path> --out-dir <path> [--rois-json <path>]")
	}

	// Create output directory
	if err := os.MkdirAll(*outDir, 0755); err != nil {
		log.Fatalf("Failed to create output directory: %v", err)
	}

	log.Println("[INFO] Starting Modules 8 & 9: Person Detection + Object Detection")
	startTime := time.Now()

	// Load input data
	log.Println("[INFO] Loading input data from Python modules 1-7...")
	header, err := loadHeaderJSON(*headerJSON)
	if err != nil {
		log.Fatalf("Failed to load header.json: %v", err)
	}

	// Load ROIs if provided, otherwise will use event-level ROIs
	var roisData *ROIsData
	if *roisJSON != "" {
		roisData, err = loadROIsJSON(*roisJSON)
		if err != nil {
			log.Printf("[WARN] Failed to load rois_per_frame.json: %v. Will use event-level ROIs.", err)
			roisData = nil
		} else {
			log.Printf("[INFO] Loaded %d frames with ROI data", len(roisData.Frames))
		}
	} else {
		log.Println("[INFO] No ROIs file provided, will use event-level ROIs from events.json")
		roisData = nil
	}

	eventsData, err := loadEventsJSON(*eventsJSON)
	if err != nil {
		log.Fatalf("Failed to load events.json: %v", err)
	}

	log.Printf("[INFO] Loaded video: %s (%.2fs, %dx%d, %d events)",
		header.VideoID, header.DurationSec, header.Width, header.Height, len(eventsData.Events))

	// Initialize YOLO detector
	log.Println("[INFO] Initializing YOLO detector...")
	detector, err := NewYOLODetector(*yoloModel, *confidenceThresh)
	if err != nil {
		// Fail loudly rather than silently degrading to the mock generators in
		// processor.go. Mock output is shape-compatible with real detections,
		// so a silent fallback ships fabricated person tracks and phone/paper
		// hits to the frontend that are indistinguishable from real ones.
		// A missing/broken YOLO setup is a setup error and must be fixed, not
		// papered over: install `ultralytics` and ensure yolov8n.pt is present.
		log.Fatalf("YOLO initialization failed: %v", err)
	}
	defer detector.Close()

	// Process events with person detection and object detection
	log.Println("[INFO] Processing events with person and object detection...")
	enrichedEvents := processEvents(eventsData.Events, roisData, *framesDir, detector, header, *outDir)

	// Build final output structure matching frontend API contract
	output := buildAPIResponse(header, enrichedEvents, eventsData)

	// Write output files
	outputPath := filepath.Join(*outDir, "enriched_events.json")
	if err := writeJSON(outputPath, output); err != nil {
		log.Fatalf("Failed to write output: %v", err)
	}

	elapsed := time.Since(startTime)
	log.Printf("[INFO] Processing complete in %.2fs", elapsed.Seconds())
	log.Printf("[INFO] Output written to: %s", outputPath)
	log.Printf("[INFO] Total events: %d", len(enrichedEvents))
	log.Printf("[INFO] Events with person detections: %d", countEventsWithDetections(enrichedEvents, "person"))
	log.Printf("[INFO] Events with object detections: %d", countEventsWithDetections(enrichedEvents, "object"))
}

func loadHeaderJSON(path string) (*Header, error) {
	data, err := ioutil.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var header Header
	if err := json.Unmarshal(data, &header); err != nil {
		return nil, err
	}
	return &header, nil
}

func loadROIsJSON(path string) (*ROIsData, error) {
	data, err := ioutil.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var rois ROIsData
	if err := json.Unmarshal(data, &rois); err != nil {
		return nil, err
	}
	return &rois, nil
}

func loadEventsJSON(path string) (*EventsData, error) {
	data, err := ioutil.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var events EventsData
	if err := json.Unmarshal(data, &events); err != nil {
		return nil, err
	}
	return &events, nil
}

func writeJSON(path string, data interface{}) error {
	bytes, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return ioutil.WriteFile(path, bytes, 0644)
}

func countEventsWithDetections(events []EnrichedEvent, detectionType string) int {
	count := 0
	for _, ev := range events {
		if detectionType == "person" && len(ev.PersonTracks) > 0 {
			count++
		} else if detectionType == "object" && len(ev.ObjectDetections) > 0 {
			count++
		}
	}
	return count
}
