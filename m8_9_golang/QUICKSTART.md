# Quick Start: Golang Backend (Modules 8 & 9)

This guide helps you get the Golang backend running in under 5 minutes.

## Option 1: Mock Mode (No ML Dependencies)

Perfect for testing the pipeline or when YOLO is not available.

### Step 1: Build
```bash
cd m8_9_golang
go mod download
go build -o drishti-backend
```

### Step 2: Run (Mock Mode)
```bash
# The service will automatically fall back to mock mode if YOLO fails
./drishti-backend \
    --events-json ../m1_7/pipeline_out/video/events/events.json \
    --rois-json ../m1_7/pipeline_out/video/rois/rois_per_frame.json \
    --header-json ../m1_7/pipeline_out/video/header.json \
    --frames-dir ../m1_7/pipeline_out/video/frames \
    --out-dir ./output
```

**Mock mode generates:**
- Fake person tracks using ROI bboxes
- 30% chance of phone detection per event
- 20% chance of paper detection per event
- Fully functional API-compatible JSON output

### Step 3: Check Output
```bash
cat output/enriched_events.json
```

## Option 2: Full Mode (With YOLO)

For actual person and object detection.

### Prerequisites
1. Install OpenCV (see README.md for platform-specific instructions)
2. Download YOLO model

### Step 1: Download YOLO Model
```bash
cd m8_9_golang

# Download YOLOv8n (nano, fastest)
curl -L https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx -o yolov8n.onnx

# OR download YOLOv8s (small, more accurate)
# curl -L https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8s.onnx -o yolov8s.onnx
```

### Step 2: Install OpenCV

#### Windows (Chocolatey)
```powershell
choco install opencv
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install -y libopencv-dev
```

#### macOS (Homebrew)
```bash
brew install opencv
```

### Step 3: Build
```bash
go mod download
go build -o drishti-backend
```

### Step 4: Run
```bash
./drishti-backend \
    --events-json ../m1_7/pipeline_out/video/events/events.json \
    --rois-json ../m1_7/pipeline_out/video/rois/rois_per_frame.json \
    --header-json ../m1_7/pipeline_out/video/header.json \
    --frames-dir ../m1_7/pipeline_out/video/frames \
    --out-dir ./output \
    --yolo-model yolov8n.onnx \
    --confidence 0.5
```

## Testing Without Python Modules 1-7

If you don't have Python pipeline output yet, create minimal test files:

### Create Test Data
```bash
mkdir -p test_data/events test_data/rois test_data/frames

# Minimal header.json
cat > test_data/header.json << 'EOF'
{
  "video_id": "test_video.mp4",
  "video_path": "/path/to/test_video.mp4",
  "fps": 30.0,
  "frame_count": 900,
  "width": 1920,
  "height": 1080,
  "duration_sec": 30.0,
  "codec": "h264",
  "fourcc": "avc1",
  "source": "opencv+ffprobe"
}
EOF

# Minimal rois_per_frame.json
cat > test_data/rois/rois_per_frame.json << 'EOF'
{
  "frame_resolution": [1920, 1080],
  "thresholds": {},
  "frames": [
    {
      "frame_idx": 0,
      "timestamp_sec": 0.0,
      "motion_score": 0.5,
      "roi_count": 1,
      "rois": [
        {
          "frame_idx": 0,
          "timestamp_sec": 0.0,
          "roi_id": 0,
          "bbox_x1": 500,
          "bbox_y1": 300,
          "bbox_x2": 700,
          "bbox_y2": 800,
          "w": 200,
          "h": 500,
          "area": 100000,
          "cx": 600.0,
          "cy": 550.0,
          "aspect_ratio": 0.4,
          "fill_ratio": 0.5,
          "merged_from": 1
        }
      ]
    }
  ]
}
EOF

# Minimal events.json
cat > test_data/events/events.json << 'EOF'
{
  "video_id": "test_video.mp4",
  "video_path": "/path/to/test_video.mp4",
  "video_duration_sec": 30.0,
  "params": {},
  "frame_count": 150,
  "event_count": 1,
  "events": [
    {
      "event_id": 1,
      "start": 5.0,
      "end": 12.0,
      "duration": 7.0,
      "unpadded_start": 8.0,
      "unpadded_end": 10.0,
      "start_frame_idx": 25,
      "end_frame_idx": 60,
      "frame_count": 10,
      "peak_s_final": 0.85,
      "mean_s_final": 0.72,
      "min_s_final": 0.58,
      "peak_s_evidence": 0.90,
      "mean_q_observability": 0.95,
      "camera_motion_frame_count": 2,
      "camera_motion_pct": 0.20,
      "primary_label": "real_motion",
      "roi": [500, 300, 700, 800],
      "roi_summary": null,
      "status": "unreviewed",
      "event_type": "full_event",
      "post_pad_merges": 0,
      "clip_path": null
    }
  ]
}
EOF
```

### Run with Test Data
```bash
./drishti-backend \
    --events-json test_data/events/events.json \
    --rois-json test_data/rois/rois_per_frame.json \
    --header-json test_data/header.json \
    --frames-dir test_data/frames \
    --out-dir ./output
```

## Expected Output

The service will create `output/enriched_events.json`:

```json
{
  "video_id": "test_video.mp4",
  "metadata": {
    "resolution": "1920x1080",
    "fps": 30.0,
    "sampling": "5 fps",
    "frames": 900
  },
  "event_count": 1,
  "events": [
    {
      "id": "event-1",
      "start": 5.0,
      "end": 12.0,
      "priority": "medium",
      "type": "unusual_motion",
      "trackId": "Track-01",
      "detection": {
        "confidence": 0.72,
        "object": "person"
      },
      "evidence": [
        "Motion score: 0.85 (peak), 0.72 (mean)",
        "Observability: 0.95",
        "Frames analyzed: 10",
        "Person tracks detected: 1"
      ]
    }
  ]
}
```

## Common Issues

### "go: module not found"
```bash
go mod tidy
go mod download
```

### "undefined: gocv"
```bash
# Install GoCV
go get -u gocv.io/x/gocv

# Verify OpenCV is installed
pkg-config --modversion opencv4
```

### "cannot find package"
Make sure you're in the `m8_9_golang` directory:
```bash
cd m8_9_golang
pwd  # Should end with /m8_9_golang
```

## Next Steps

1. **Run Python Modules 1-7** to get real video data:
   ```bash
   cd ../m1_7
   python run_pipeline.py path/to/video.mp4 --out-dir pipeline_out/video
   ```

2. **Process the output with Golang backend**:
   ```bash
   cd ../m8_9_golang
   ./drishti-backend \
       --events-json ../m1_7/pipeline_out/video/events/events.json \
       --rois-json ../m1_7/pipeline_out/video/rois/rois_per_frame.json \
       --header-json ../m1_7/pipeline_out/video/header.json \
       --frames-dir ../m1_7/pipeline_out/video/frames \
       --out-dir ./output
   ```

3. **Serve to Frontend**:
   - Copy `output/enriched_events.json` to a location accessible by the Next.js frontend
   - Update frontend API calls to point to your backend
   - Or create a simple HTTP server to serve the JSON

## Performance Tips

- Use **YOLOv8n** for fastest processing (5-10ms per frame on GPU)
- Reduce `--confidence` to 0.4 for higher recall
- Increase `--confidence` to 0.6 for fewer false positives
- Mock mode is ~100x faster than YOLO mode (useful for testing)

## Help & Support

- Full documentation: See `README.md`
- Python modules: See `../m1_7/` directory
- Frontend integration: See `../PROJECT_STRUCTURE.md`
- Issues: Check console logs for detailed error messages
