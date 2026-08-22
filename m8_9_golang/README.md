# DrishtiAI Modules 8 & 9: Person Detection + Object Detection (Golang)

This Golang service implements Modules 8 & 9 of the DrishtiAI video analytics pipeline:

- **Module 8**: Person Detection & Tracking (YOLO + ByteTrack-inspired tracking)
- **Module 9**: Object Detection (Phone, Paper/Book using YOLO)

## Architecture

The service reads output from Python Modules 1-7 and enriches events with:
- Person detection and tracking (anonymized Track-01, Track-02, etc.)
- Object detection (cell phone, paper/book)
- Coarse-to-fine detection (only runs YOLO inside ROIs from Module 5)
- API-compatible JSON output for frontend integration

## Prerequisites

### 1. Install Go 1.21+
```bash
# Check if Go is installed
go version

# If not installed, download from https://go.dev/dl/
```

### 2. Install OpenCV (GoCV)
GoCV requires OpenCV to be installed on your system.

#### Windows
```bash
# Option 1: Using Chocolatey
choco install opencv

# Option 2: Using vcpkg
vcpkg install opencv4

# Option 3: Manual installation
# Download OpenCV from https://opencv.org/releases/
# Extract and add to PATH
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install libopencv-dev
```

#### macOS
```bash
brew install opencv
```

### 3. Install YOLO Model
Download a pretrained YOLOv8 ONNX model:

```bash
# YOLOv8n (nano, fastest, recommended for real-time)
wget https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx

# YOLOv8s (small, better accuracy)
wget https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8s.onnx
```

Place the model in the `m8_9_golang/` directory.

## Installation

```bash
cd m8_9_golang
go mod download
go build -o drishti-backend
```

## Usage

### Basic Usage
```bash
./drishti-backend \
    --events-json ../pipeline_out/video/events/events.json \
    --rois-json ../pipeline_out/video/rois/rois_per_frame.json \
    --header-json ../pipeline_out/video/header.json \
    --frames-dir ../pipeline_out/video/frames \
    --out-dir ../pipeline_out/video/enriched \
    --yolo-model yolov8n.onnx \
    --confidence 0.5
```

### Arguments
- `--events-json`: Path to `events.json` from Module 7 (required)
- `--rois-json`: Path to `rois_per_frame.json` from Module 5 (required)
- `--header-json`: Path to `header.json` from Module 1 (required)
- `--frames-dir`: Directory of sampled frames from Module 2 (required)
- `--out-dir`: Output directory for enriched results (required)
- `--yolo-model`: Path to YOLO ONNX model (default: `yolov8n.onnx`)
- `--confidence`: Detection confidence threshold (default: 0.5)

### Mock Mode (No YOLO)
If YOLO model is not available or fails to load, the service automatically runs in **mock mode**:
- Generates fake person tracks using ROI bboxes
- Generates fake object detections (30% phone, 20% paper)
- Useful for testing the pipeline without ML dependencies

```bash
# Mock mode (YOLO will fail to load, falls back to mock)
./drishti-backend \
    --events-json ../pipeline_out/video/events/events.json \
    --rois-json ../pipeline_out/video/rois/rois_per_frame.json \
    --header-json ../pipeline_out/video/header.json \
    --frames-dir ../pipeline_out/video/frames \
    --out-dir ../pipeline_out/video/enriched \
    --yolo-model nonexistent.onnx
```

## Output Format

The service produces `enriched_events.json` in the output directory, matching the frontend API contract from `PROJECT_STRUCTURE.md`:

```json
{
  "video_id": "exam_video_001.mp4",
  "video_path": "/path/to/exam_video_001.mp4",
  "metadata": {
    "resolution": "1920x1080",
    "fps": 30.0,
    "sampling": "5 fps",
    "frames": 1200,
    "processingTime": "N/A"
  },
  "quality_metrics": {
    "observability": 0.92,
    "cameraShake": 0.15,
    "blur": 0.0,
    "lighting": 0.0,
    "occlusion": 0.0
  },
  "event_count": 12,
  "events": [
    {
      "id": "event-1",
      "videoId": "exam_video_001.mp4",
      "start": 23.5,
      "end": 31.2,
      "duration": 7.7,
      "motionScore": 0.87,
      "cameraShake": 0.12,
      "priority": "high",
      "type": "phone_activity",
      "description": "Person detected with cell phone (1 tracks, 87.0% motion)",
      "trackId": "Track-01",
      "roi": [450, 320, 680, 720],
      "clipUrl": "/path/to/clip.mp4",
      "annotatedClipUrl": "/path/to/clip.mp4",
      "detection": {
        "confidence": 0.87,
        "object": "person with phone"
      },
      "observability": 0.94,
      "qualityFactors": {
        "cameraShake": 0.12,
        "blur": 0.0,
        "occlusion": 0.0,
        "lighting": 0.06
      },
      "evidence": [
        "Motion score: 0.87 (peak), 0.78 (mean)",
        "Observability: 0.94",
        "Frames analyzed: 38",
        "Person tracks detected: 1",
        "Cell phone detected in frame"
      ],
      "status": "unreviewed"
    }
  ],
  "processing_info": {
    "total_elapsed_sec": 0.0,
    "modules_run": ["1-7 (Python)", "8-9 (Golang)"],
    "timestamp": "exam_video_001.mp4"
  }
}
```

## Module 8: Person Detection & Tracking

### Algorithm
1. **Coarse-to-fine**: Only runs YOLO inside ROIs from Module 5 (not full frames)
2. **YOLO detection**: Uses pretrained YOLOv8 on COCO dataset (class 0: person)
3. **Tracking**: Simple centroid-based tracker (inspired by ByteTrack)
   - Matches detections across frames using centroid distance
   - Generates anonymized track IDs: Track-01, Track-02, etc.
   - No facial recognition or biometric identification

### Output per Event
```json
{
  "person_tracks": [
    {
      "track_id": "Track-01",
      "first_seen": 23.5,
      "last_seen": 31.2,
      "frame_count": 38,
      "bboxes": [
        {
          "frame_idx": 117,
          "timestamp_sec": 23.5,
          "x1": 450,
          "y1": 320,
          "x2": 680,
          "y2": 720,
          "confidence": 0.89
        }
      ],
      "confidence": 0.87
    }
  ]
}
```

## Module 9: Object Detection

### Algorithm
1. **Coarse-to-fine**: Only runs YOLO inside ROIs from Module 5
2. **YOLO detection**: Uses pretrained COCO classes:
   - `cell phone` (class 67)
   - `book` (class 73, proxy for paper/chit)
3. **Association**: Attempts to link objects to person tracks via bbox overlap

### Output per Event
```json
{
  "object_detections": [
    {
      "object_type": "cell phone",
      "first_seen": 24.1,
      "last_seen": 30.8,
      "frame_count": 33,
      "bboxes": [
        {
          "frame_idx": 120,
          "timestamp_sec": 24.1,
          "x1": 520,
          "y1": 480,
          "x2": 560,
          "y2": 540,
          "confidence": 0.78
        }
      ],
      "confidence": 0.78,
      "track_id": "Track-01"
    }
  ]
}
```

## Detection Summary

Each event includes a summary:
```json
{
  "detection_summary": {
    "total_persons": 1,
    "total_objects": 1,
    "object_types": ["cell phone"],
    "has_phone": true,
    "has_paper": false
  }
}
```

## Performance Tuning

### Speed vs Accuracy
- **YOLOv8n**: ~5ms/frame on GPU, recommended for real-time
- **YOLOv8s**: ~10ms/frame on GPU, better accuracy
- **YOLOv8m/l/x**: Slower but more accurate, use for offline batch processing

### Confidence Threshold
- `0.3-0.4`: High recall, more false positives
- `0.5`: Balanced (default)
- `0.6-0.7`: High precision, may miss some detections

### Coarse-to-Fine Savings
Running YOLO only inside ROIs (vs. full frames) typically saves:
- **70-90%** inference time
- Proportional GPU/CPU usage reduction
- No accuracy loss (motion is already localized by Module 3-5)

## Integration with Frontend

The output `enriched_events.json` is ready for frontend consumption:

1. **Dashboard** (`components/Dashboard.tsx`):
   - Video cards with event counts
   - Stats: total events, high priority (phone detected)

2. **VideoAnalysis** (`components/VideoAnalysis.tsx`):
   - Filter profiles: All Events, Phone Activity, Proximity
   - Timeline with event markers
   - Event list with priority badges

3. **EventDetail** (`components/EventDetail.tsx`):
   - Video player with clip URLs
   - Detection metadata (confidence, object type)
   - Track ID display
   - Evidence list
   - Quality factors

## Privacy & Security

- **No facial recognition**: Person tracking uses centroid-based matching only
- **Anonymized IDs**: Track IDs are ephemeral (Track-01, Track-02) and reset per video
- **Offline processing**: All detection runs locally, no cloud APIs
- **Consent-aware**: Designed for exam proctoring with informed consent

## Troubleshooting

### "Failed to load YOLO model"
- Check that the ONNX model file exists at the specified path
- Verify OpenCV installation: `pkg-config --modversion opencv4`
- Try mock mode to test pipeline without ML

### "Failed to load frame"
- Check that `--frames-dir` points to the correct directory
- Verify frame naming convention matches Module 2 output
- Frames should be named: `<video_id>__f<frameIdx>__t<timestamp>.jpg`

### Slow processing
- Use YOLOv8n instead of larger models
- Reduce confidence threshold to process fewer frames
- Check GPU utilization: `nvidia-smi` (if using CUDA)

### GoCV build errors
- Reinstall OpenCV: see Prerequisites section
- Set OpenCV environment variables:
  ```bash
  export CGO_CPPFLAGS="-I/usr/local/include"
  export CGO_LDFLAGS="-L/usr/local/lib -lopencv_core -lopencv_videoio -lopencv_imgproc"
  ```

## Future Enhancements

- [ ] Implement full ByteTrack algorithm (high + low confidence tracks)
- [ ] Add BoT-SORT for crowded scene tracking
- [ ] Fine-tune YOLO on custom dataset (paper/chit/earbud classes)
- [ ] Generate annotated video clips with bbox overlays
- [ ] Support batch processing (multiple videos)
- [ ] Add real-time processing mode (stream from camera)
- [ ] GPU acceleration with CUDA backend
- [ ] REST API for frontend integration

## References

- YOLOv8: https://github.com/ultralytics/ultralytics
- ByteTrack: https://github.com/ifzhang/ByteTrack
- GoCV: https://gocv.io/
- OpenCV: https://opencv.org/

## License

Part of DrishtiAI PS2 Hackathon project.
