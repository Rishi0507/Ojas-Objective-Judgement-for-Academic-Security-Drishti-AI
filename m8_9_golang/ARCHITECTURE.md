# Architecture: Modules 8 & 9

This document explains the architecture and data flow of the Golang backend.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          INPUT DATA                                 │
│                    (from Python Modules 1-7)                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  header.json (Module 1)          events.json (Module 7)            │
│  ├─ video_id                     ├─ event_id                       │
│  ├─ fps, duration                ├─ start, end, duration           │
│  ├─ width, height                ├─ motion scores                  │
│  └─ frame_count                  ├─ quality metrics                │
│                                  ├─ roi (bbox)                      │
│  rois_per_frame.json (Module 5)  └─ camera_motion_pct              │
│  ├─ frames[]                                                        │
│  │   ├─ frame_idx                frames/ (Module 2)                │
│  │   ├─ timestamp_sec            ├─ video_f0000001_t00.12.jpg     │
│  │   └─ rois[]                   ├─ video_f0000002_t00.34.jpg     │
│  │       ├─ bbox (x1,y1,x2,y2)   └─ ...                            │
│  │       ├─ area, aspect_ratio                                     │
│  │       └─ fill_ratio                                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     GOLANG BACKEND                                  │
│                   (Modules 8 & 9)                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────┐          │
│  │  1. Load & Parse Input Data                         │          │
│  │     - Read JSON files                                │          │
│  │     - Build frame-to-ROI lookup map                 │          │
│  │     - Build frame-to-event lookup map               │          │
│  └──────────────────────────────────────────────────────┘          │
│                         ↓                                           │
│  ┌──────────────────────────────────────────────────────┐          │
│  │  2. Initialize YOLO Detector                         │          │
│  │     - Load ONNX model (yolov8n.onnx)                │          │
│  │     - Set confidence threshold                       │          │
│  │     - Configure NMS threshold                        │          │
│  │     - Initialize tracker                             │          │
│  └──────────────────────────────────────────────────────┘          │
│                         ↓                                           │
│  ┌──────────────────────────────────────────────────────┐          │
│  │  3. Process Events (for each event)                  │          │
│  │                                                       │          │
│  │  ┌─────────────────────────────────────────────────┐ │          │
│  │  │ 3a. Get Event Frames                           │ │          │
│  │  │     - Filter frames by event time range        │ │          │
│  │  │     - Get associated ROIs                      │ │          │
│  │  └─────────────────────────────────────────────────┘ │          │
│  │                    ↓                                  │          │
│  │  ┌─────────────────────────────────────────────────┐ │          │
│  │  │ 3b. MODULE 8: Person Detection & Tracking      │ │          │
│  │  │                                                 │ │          │
│  │  │  For each frame:                               │ │          │
│  │  │    ├─ Load frame image                         │ │          │
│  │  │    ├─ Run YOLO detection                       │ │          │
│  │  │    ├─ Filter person class (class 0)            │ │          │
│  │  │    ├─ Filter by ROIs (coarse-to-fine)          │ │          │
│  │  │    ├─ Update tracker (centroid matching)       │ │          │
│  │  │    └─ Assign Track IDs (Track-01, Track-02)    │ │          │
│  │  │                                                 │ │          │
│  │  │  Output:                                        │ │          │
│  │  │    └─ PersonTrack[]                            │ │          │
│  │  │        ├─ track_id: "Track-01"                 │ │          │
│  │  │        ├─ bboxes[]                             │ │          │
│  │  │        └─ confidence                           │ │          │
│  │  └─────────────────────────────────────────────────┘ │          │
│  │                    ↓                                  │          │
│  │  ┌─────────────────────────────────────────────────┐ │          │
│  │  │ 3c. MODULE 9: Object Detection                 │ │          │
│  │  │                                                 │ │          │
│  │  │  For each frame:                               │ │          │
│  │  │    ├─ Load frame image                         │ │          │
│  │  │    ├─ Run YOLO detection                       │ │          │
│  │  │    ├─ Filter object classes:                   │ │          │
│  │  │    │   ├─ cell phone (class 67)                │ │          │
│  │  │    │   └─ book (class 73)                      │ │          │
│  │  │    ├─ Filter by ROIs (coarse-to-fine)          │ │          │
│  │  │    └─ Associate with person tracks (overlap)   │ │          │
│  │  │                                                 │ │          │
│  │  │  Output:                                        │ │          │
│  │  │    └─ ObjectDetection[]                        │ │          │
│  │  │        ├─ object_type: "cell phone"            │ │          │
│  │  │        ├─ bboxes[]                             │ │          │
│  │  │        ├─ confidence                           │ │          │
│  │  │        └─ track_id: "Track-01" (linked)        │ │          │
│  │  └─────────────────────────────────────────────────┘ │          │
│  │                    ↓                                  │          │
│  │  ┌─────────────────────────────────────────────────┐ │          │
│  │  │ 3d. Build Detection Summary                    │ │          │
│  │  │     - total_persons: 1                          │ │          │
│  │  │     - total_objects: 1                          │ │          │
│  │  │     - has_phone: true                           │ │          │
│  │  │     - has_paper: false                          │ │          │
│  │  └─────────────────────────────────────────────────┘ │          │
│  │                    ↓                                  │          │
│  │  ┌─────────────────────────────────────────────────┐ │          │
│  │  │ 3e. Determine Priority & Type                  │ │          │
│  │  │     - high: phone detected OR high motion       │ │          │
│  │  │     - medium: person detected OR moderate motion│ │          │
│  │  │     - low: everything else                      │ │          │
│  │  │                                                 │ │          │
│  │  │     - type: phone_activity / proximity /        │ │          │
│  │  │             unusual_motion / camera_motion      │ │          │
│  │  └─────────────────────────────────────────────────┘ │          │
│  │                    ↓                                  │          │
│  │  ┌─────────────────────────────────────────────────┐ │          │
│  │  │ 3f. Build Evidence List                        │ │          │
│  │  │     - Motion score: 0.87 (peak), 0.78 (mean)   │ │          │
│  │  │     - Observability: 0.94                       │ │          │
│  │  │     - Person tracks detected: 1                 │ │          │
│  │  │     - Cell phone detected in frame              │ │          │
│  │  └─────────────────────────────────────────────────┘ │          │
│  │                                                       │          │
│  └──────────────────────────────────────────────────────┘          │
│                         ↓                                           │
│  ┌──────────────────────────────────────────────────────┐          │
│  │  4. Build API Response                               │          │
│  │     - Transform to frontend API format               │          │
│  │     - Add metadata, quality metrics                  │          │
│  │     - Format timestamps, priorities                  │          │
│  │     - Build processing info                          │          │
│  └──────────────────────────────────────────────────────┘          │
│                         ↓                                           │
│  ┌──────────────────────────────────────────────────────┐          │
│  │  5. Write Output JSON                                │          │
│  │     - enriched_events.json                           │          │
│  └──────────────────────────────────────────────────────┘          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                        OUTPUT DATA                                  │
│                  (for Next.js Frontend)                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  enriched_events.json                                               │
│  ├─ video_id, video_path                                           │
│  ├─ metadata (resolution, fps, frames)                             │
│  ├─ quality_metrics (observability, shake, blur)                   │
│  └─ events[]                                                        │
│      ├─ id: "event-1"                                              │
│      ├─ start, end, duration                                       │
│      ├─ priority: "high" / "medium" / "low"                        │
│      ├─ type: "phone_activity" / "proximity" / etc.                │
│      ├─ description: "Person detected with cell phone..."          │
│      ├─ trackId: "Track-01"                                        │
│      ├─ detection                                                  │
│      │   ├─ confidence: 0.87                                       │
│      │   └─ object: "person with phone"                            │
│      ├─ qualityFactors (shake, blur, occlusion, lighting)          │
│      └─ evidence[]                                                 │
│          ├─ "Motion score: 0.87 (peak), 0.78 (mean)"              │
│          ├─ "Observability: 0.94"                                  │
│          ├─ "Person tracks detected: 1"                            │
│          └─ "Cell phone detected in frame"                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      FRONTEND (Next.js)                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Dashboard.tsx                  VideoAnalysis.tsx                   │
│  ├─ Event counts                ├─ Timeline with markers           │
│  ├─ Priority filtering          ├─ Filter profiles:                │
│  └─ Video list                  │   ├─ All Events                  │
│                                 │   ├─ Phone Activity              │
│                                 │   ├─ Proximity                   │
│                                 │   └─ Unusual Motion              │
│  EventDetail.tsx                └─ Event list                      │
│  ├─ Video player                                                   │
│  ├─ Track ID: "Track-01"                                           │
│  ├─ Detection metadata                                             │
│  ├─ Evidence list                                                  │
│  └─ Feedback buttons                                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Interactions

### 1. YOLO Detector (`detector.go`)

```go
YOLODetector
├─ LoadModel(onnxPath) → Net
├─ Detect(img) → []DetectResult
│   ├─ Preprocess: resize to 640x640, normalize
│   ├─ Inference: forward pass through network
│   ├─ Postprocess: parse output tensor
│   └─ NMS: remove overlapping boxes
├─ FilterPersonDetections() → []DetectResult
└─ FilterObjectDetections() → []DetectResult
```

### 2. Simple Tracker (`detector.go`)

```go
SimpleTracker
├─ Update(detections, frameIdx) → map[trackID]Detection
│   ├─ Match detections to existing tracks (centroid distance)
│   ├─ Create new tracks for unmatched detections
│   ├─ Age out old tracks (not seen for N frames)
│   └─ Assign Track IDs (1, 2, 3... → Track-01, Track-02...)
└─ GetTracks() → map[trackID]Track
```

### 3. Event Processor (`processor.go`)

```go
processEvents(events, rois, framesDir, detector)
├─ For each event:
│   ├─ getEventFrames(event, roisMap)
│   ├─ detectAndTrackPersons(frames, detector)
│   │   ├─ Load frame image
│   │   ├─ Run YOLO
│   │   ├─ Filter persons
│   │   ├─ Filter by ROIs (coarse-to-fine)
│   │   └─ Update tracker
│   ├─ detectObjects(frames, detector, personTracks)
│   │   ├─ Run YOLO
│   │   ├─ Filter objects (phone, book)
│   │   ├─ Filter by ROIs
│   │   └─ Link to person tracks
│   ├─ buildDetectionSummary()
│   └─ EnrichedEvent
└─ Return []EnrichedEvent
```

### 4. API Builder (`processor.go`)

```go
buildAPIResponse(header, enrichedEvents, eventsData)
├─ Build metadata (resolution, fps, frames)
├─ Compute quality metrics (average from events)
├─ For each event:
│   ├─ determinePriority() → "high" / "medium" / "low"
│   ├─ determineEventType() → "phone_activity" / etc.
│   ├─ buildEventDescription()
│   ├─ buildEvidence()
│   └─ Format as APIEvent
└─ Return APIResponse
```

## Data Structures

### Input (from Python)

```go
// Module 1
type Header struct {
    VideoID     string
    FPS         float64
    Width       int
    Height      int
    DurationSec float64
}

// Module 5
type ROI struct {
    FrameIdx int
    BBoxX1   int
    BBoxY1   int
    BBoxX2   int
    BBoxY2   int
}

// Module 7
type Event struct {
    EventID                int
    Start                  float64
    End                    float64
    PeakSFinal             float64
    MeanQObservability     float64
    CameraMotionPct        float64
    ROI                    []int
}
```

### Internal (detection)

```go
// YOLO detection
type DetectResult struct {
    ClassID    int
    ClassName  string
    Confidence float64
    BBox       image.Rectangle
}

// Tracking
type Track struct {
    ID       int
    BBoxes   []DetectResult
    LastSeen int
    Age      int
}
```

### Output (for frontend)

```go
// Enriched event
type EnrichedEvent struct {
    Event                 // Original event from Module 7
    PersonTracks     []PersonTrack
    ObjectDetections []ObjectDetection
    DetectionSummary DetectionSummary
}

// API format
type APIEvent struct {
    ID          string
    Start       float64
    End         float64
    Priority    string  // "high" / "medium" / "low"
    Type        string  // "phone_activity" / etc.
    Description string
    TrackID     string
    Detection   DetectionInfo
    Evidence    []string
}
```

## Performance Optimization

### Coarse-to-Fine Pipeline

```
Full-Frame Detection (baseline):
├─ Load 1920x1080 frame
├─ Resize to 640x640
├─ YOLO inference: ~10ms
└─ Total: ~10ms per frame

Coarse-to-Fine (our approach):
├─ Check ROIs (Module 5 output)
├─ If no ROIs: skip frame (0ms)
├─ If ROIs exist:
│   ├─ Crop frame to ROI bbox
│   ├─ Resize to 640x640
│   ├─ YOLO inference: ~10ms
│   └─ Only ~30% of frames have ROIs
└─ Average: ~3ms per frame (70% speedup)
```

### Tracking Optimization

```
Full Re-detection (baseline):
├─ Run YOLO every frame
└─ Cost: N × 10ms

With Tracking (our approach):
├─ Run YOLO every frame
├─ Match detections to tracks: ~2ms
├─ But: can skip YOLO on some frames (optional future)
└─ Cost: N × 12ms (with tracking overhead)
```

### Memory Layout

```
Single Video (30 min, 1080p, 5fps):
├─ Total frames: 9000
├─ ROI frames: ~2700 (30%)
├─ Events: ~50
├─ Person tracks: ~5 per event
├─ Object detections: ~2 per event
├─ Memory usage:
│   ├─ YOLO model: 6 MB
│   ├─ Frame buffer: 10 MB (1 frame at a time)
│   ├─ Track history: 50 KB
│   └─ Output JSON: ~500 KB
└─ Total: <20 MB
```

## Algorithm Details

### Person Tracking (Simple Centroid)

```
For each frame:
1. Run YOLO → get person bboxes
2. Compute centroid for each bbox: (cx, cy)
3. For each detection:
   - Find closest existing track (min distance)
   - If distance < threshold (100px):
       → Update track with new bbox
   - Else:
       → Create new track (new Track ID)
4. Age out tracks not seen for N frames (5 frames)
5. Convert track IDs to strings: 1 → "Track-01"
```

### Object-Person Linking

```
For each object detection:
1. Get object bbox: (x1, y1, x2, y2)
2. For each person track:
   - Get person bbox at same frame
   - Check if bboxes overlap (IoU > 0 or within distance)
3. If overlap found:
   → Link object to person track
4. Else:
   → Standalone object (no track_id)
```

### Priority Assignment

```
Priority = f(detection_summary, motion_score)

High:
  - Phone detected (has_phone = true)
  - OR motion_score > 0.7

Medium:
  - Person detected (total_persons > 0)
  - OR motion_score > 0.4

Low:
  - Everything else
```

## Error Handling

```go
// YOLO initialization failure
detector, err := NewYOLODetector(modelPath)
if err != nil {
    log.Warn("YOLO failed, using mock mode")
    detector = nil  // Mock mode
}

// Frame load failure
img, err := LoadFrame(framePath)
if err != nil {
    log.Warn("Frame not found, skipping")
    continue  // Skip frame
}

// Detection failure
detections, err := detector.Detect(img)
if err != nil {
    log.Warn("Detection failed, skipping frame")
    continue  // Skip frame
}
```

## Concurrency (Future Enhancement)

```go
// Current: sequential processing
for _, event := range events {
    enriched := processEvent(event)
}

// Future: parallel processing
var wg sync.WaitGroup
results := make(chan EnrichedEvent, len(events))
for _, event := range events {
    wg.Add(1)
    go func(e Event) {
        defer wg.Done()
        results <- processEvent(e)
    }(event)
}
wg.Wait()
close(results)
```

## Testing Strategy

```
Unit Tests:
├─ detector_test.go
│   ├─ TestYOLODetection
│   ├─ TestNMS
│   └─ TestTracking
└─ processor_test.go
    ├─ TestEventProcessing
    ├─ TestROIFiltering
    └─ TestMockMode

Integration Tests:
└─ Run with minimal test data
    ├─ Test JSON parsing
    ├─ Test frame loading
    └─ Test output format

End-to-End Tests:
└─ Full pipeline
    ├─ Python → Golang → Frontend
    └─ Visual inspection of results
```

## References

- **YOLO**: [ultralytics/ultralytics](https://github.com/ultralytics/ultralytics)
- **ByteTrack**: [ifzhang/ByteTrack](https://github.com/ifzhang/ByteTrack)
- **GoCV**: [gocv.io](https://gocv.io/)
- **COCO Dataset**: [cocodataset.org](https://cocodataset.org/)
