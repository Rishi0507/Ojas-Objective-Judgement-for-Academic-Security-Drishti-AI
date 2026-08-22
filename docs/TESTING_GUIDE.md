# DrishtiAI Testing Guide

This guide covers all testing scenarios for the complete DrishtiAI pipeline.

## Prerequisites

### Install Required Software

#### 1. Go (for Golang backend)
```bash
# Windows (using Chocolatey)
choco install golang

# Or download from: https://go.dev/dl/
# Verify: go version (should show 1.21+)
```

#### 2. Python (for modules 1-7)
```bash
# Windows
choco install python

# Verify: python --version (should show 3.8+)
```

#### 3. Node.js (for frontend)
```bash
# Windows
choco install nodejs

# Verify: node --version (should show 18+)
```

#### 4. OpenCV (optional, for real YOLO detection)
```bash
# Windows (Chocolatey)
choco install opencv

# Or download from: https://opencv.org/releases/
```

## Testing Strategy

```
Level 1: Unit Tests (individual components)
    ↓
Level 2: Integration Tests (module-to-module)
    ↓
Level 3: End-to-End Tests (full pipeline)
    ↓
Level 4: Frontend Tests (UI/UX validation)
```

---

## Level 1: Unit Tests

### Frontend Unit Tests

```bash
# Install dependencies
npm install

# Run Next.js build test
npm run build

# Check for TypeScript errors
npx tsc --noEmit

# Start dev server (manual check)
npm run dev
# Open http://localhost:3000 and verify:
# ✓ Hero section loads
# ✓ Dashboard shows (click "Skip to Dashboard")
# ✓ Video cards clickable
# ✓ Event detail view accessible
```

**What to verify:**
- ✓ No build errors
- ✓ All pages render
- ✓ Navigation works (Hero → Dashboard → VideoAnalysis → EventDetail)
- ✓ Mock data displays correctly
- ✓ Animations are smooth (no lag)
- ✓ Design is clean and professional (no neon glows!)

### Golang Unit Tests (Mock Mode)

```bash
cd m8_9_golang

# Generate test data
go run test_data_generator.go

# Build the backend
go build -o drishti-backend

# Run in mock mode (no YOLO needed)
./drishti-backend \
    --events-json test_data/events/events.json \
    --rois-json test_data/rois/rois_per_frame.json \
    --header-json test_data/header.json \
    --frames-dir test_data/frames \
    --out-dir output_test
```

**What to verify:**
- ✓ No build errors
- ✓ Runs without YOLO model
- ✓ Creates `output_test/enriched_events.json`
- ✓ JSON is valid (use `jq . output_test/enriched_events.json` or open in editor)
- ✓ Contains 2 events (from test data)
- ✓ Each event has `person_tracks` array (mock data)
- ✓ Console shows: "Running in mock mode" message

**Expected output structure:**
```json
{
  "video_id": "test_video.mp4",
  "event_count": 2,
  "events": [
    {
      "id": "event-1",
      "priority": "medium",
      "type": "unusual_motion",
      "trackId": "Track-01",
      "detection": {
        "confidence": 0.72,
        "object": "person"
      }
    }
  ]
}
```

### Python Module Tests

```bash
cd m1_7

# Test Module 1 (metadata extraction)
python module1_metadata.py path/to/any/video.mp4

# Expected: Prints JSON with fps, duration, width, height

# Test Module 5 (ROI extraction) - requires sample data
# (Skip for now, test in integration phase)
```

---

## Level 2: Integration Tests

### Test 1: Python Pipeline → Golang Backend

**Prerequisites**: Have a test video file (any MP4, 30-60 seconds)

```bash
# Step 1: Run Python pipeline
cd m1_7
python run_pipeline.py path/to/video.mp4 --out-dir pipeline_out/test_video

# Expected output:
# - pipeline_out/test_video/header.json
# - pipeline_out/test_video/frames/*.jpg
# - pipeline_out/test_video/motion.csv
# - pipeline_out/test_video/cleaned_masks/*.png
# - pipeline_out/test_video/rois/rois_per_frame.json
# - pipeline_out/test_video/events/events.json
# - pipeline_out/test_video/events/clips/*.mp4 (optional)

# Step 2: Run Golang backend (mock mode)
cd ../m8_9_golang
./drishti-backend \
    --events-json ../m1_7/pipeline_out/test_video/events/events.json \
    --rois-json ../m1_7/pipeline_out/test_video/rois/rois_per_frame.json \
    --header-json ../m1_7/pipeline_out/test_video/header.json \
    --frames-dir ../m1_7/pipeline_out/test_video/frames \
    --out-dir output_real

# Expected: enriched_events.json with real event data
```

**What to verify:**
- ✓ Python pipeline completes without errors
- ✓ Events detected (check event_count in console)
- ✓ Golang backend processes all events
- ✓ Output JSON contains same number of events
- ✓ Each event has person_tracks (mock) and detection_summary

**Troubleshooting:**
- If "No frames found": Check that `frames/` directory has JPG files
- If "No events found": Video might have no motion, try different video
- If "Failed to read JSON": Check Python output is valid JSON

### Test 2: Golang Backend (Full Mode with YOLO)

**Prerequisites**: OpenCV installed, YOLO model downloaded

```bash
cd m8_9_golang

# Download YOLO model (if not done yet)
curl -L https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx -o yolov8n.onnx

# Run with YOLO
./drishti-backend \
    --events-json ../m1_7/pipeline_out/test_video/events/events.json \
    --rois-json ../m1_7/pipeline_out/test_video/rois/rois_per_frame.json \
    --header-json ../m1_7/pipeline_out/test_video/header.json \
    --frames-dir ../m1_7/pipeline_out/test_video/frames \
    --out-dir output_yolo \
    --yolo-model yolov8n.onnx \
    --confidence 0.5
```

**What to verify:**
- ✓ YOLO model loads successfully
- ✓ Console shows: "Initializing YOLO detector..." (no mock mode warning)
- ✓ Processing is slower than mock mode (detection running)
- ✓ Person tracks have realistic confidence values (0.5-0.95)
- ✓ Some events may have phone/object detections

**Performance check:**
- Watch console for timing: "Processing event X/Y"
- Should process ~5-10 events per second (depends on CPU/GPU)
- If very slow (<1 event/sec), check GPU usage or use YOLOv8n

---

## Level 3: End-to-End Tests

### Full Pipeline Test

```bash
# 1. Clean slate
rm -rf m1_7/pipeline_out
rm -rf m8_9_golang/output

# 2. Run Python pipeline
cd m1_7
python run_pipeline.py ../test_videos/exam_video.mp4 --out-dir pipeline_out/exam

# 3. Run Golang backend
cd ../m8_9_golang
./drishti-backend \
    --events-json ../m1_7/pipeline_out/exam/events/events.json \
    --rois-json ../m1_7/pipeline_out/exam/rois/rois_per_frame.json \
    --header-json ../m1_7/pipeline_out/exam/header.json \
    --frames-dir ../m1_7/pipeline_out/exam/frames \
    --out-dir output \
    --yolo-model yolov8n.onnx

# 4. Copy output to frontend
cd ..
mkdir -p public/api
cp m8_9_golang/output/enriched_events.json public/api/

# 5. Update frontend to load from file (temporarily)
# Edit components/Dashboard.tsx:
# Replace mock data with: fetch('/api/enriched_events.json')

# 6. Start frontend
npm run dev
# Open http://localhost:3000
```

**What to verify:**
- ✓ Python pipeline detects events
- ✓ Golang backend enriches with person/object detection
- ✓ Frontend displays real data (not mock)
- ✓ Event counts match
- ✓ Priority badges show correctly (high/medium/low)
- ✓ Filter profiles work (Phone Activity, Proximity, etc.)
- ✓ Event detail view shows track IDs and evidence

**Visual checks:**
- Dashboard stats show real numbers
- Activity timeline has data points
- Recent videos list shows processed video
- VideoAnalysis shows events on timeline
- EventDetail shows detection metadata

---

## Level 4: Frontend Tests

### Manual UI/UX Testing

Open http://localhost:3000 and test:

#### Hero Section
- [ ] Hero loads with gradient background
- [ ] Brand name visible
- [ ] Three feature cards display
- [ ] "Launch Dashboard" button works
- [ ] "View Demo" button exists

#### Dashboard
- [ ] Four stat cards show numbers
- [ ] Activity timeline chart renders
- [ ] System health metrics display
- [ ] Recent videos list shows items
- [ ] Click video → navigates to VideoAnalysis

#### VideoAnalysis
- [ ] Header shows video name and metadata
- [ ] Filter profiles show counts
- [ ] Clicking filter updates event list
- [ ] Motion heatmap placeholder visible
- [ ] Activity timeline shows event markers
- [ ] Quality metrics display
- [ ] Event list shows all events
- [ ] Click event → navigates to EventDetail

#### EventDetail
- [ ] Back button returns to VideoAnalysis
- [ ] Event ID and Track ID display
- [ ] Video player placeholder visible
- [ ] Evidence section expandable
- [ ] Quality factors show progress bars
- [ ] Feedback buttons clickable
- [ ] Submit button enables after selection

### Performance Testing

```bash
# Build production version
npm run build
npm start

# Open Chrome DevTools
# Check Performance tab:
# - Initial load < 3s
# - Page transitions < 500ms
# - No layout shifts (CLS)
# - Smooth scrolling (60fps)
```

**Metrics to check:**
- First Contentful Paint (FCP): < 1.5s
- Largest Contentful Paint (LCP): < 2.5s
- Cumulative Layout Shift (CLS): < 0.1
- Time to Interactive (TTI): < 3.5s

---

## Automated Test Scripts

### Create test.sh (Linux/Mac)
```bash
#!/bin/bash
echo "=== DrishtiAI Full Test Suite ==="

echo "1. Testing Frontend..."
npm run build || exit 1

echo "2. Testing Golang Backend (mock mode)..."
cd m8_9_golang
go run test_data_generator.go
go build -o drishti-backend || exit 1
./drishti-backend \
    --events-json test_data/events/events.json \
    --rois-json test_data/rois/rois_per_frame.json \
    --header-json test_data/header.json \
    --frames-dir test_data/frames \
    --out-dir output_test || exit 1

echo "3. Verifying output..."
[ -f output_test/enriched_events.json ] || exit 1

echo "✓ All tests passed!"
```

### Create test.ps1 (Windows)
```powershell
Write-Host "=== DrishtiAI Full Test Suite ===" -ForegroundColor Green

Write-Host "1. Testing Frontend..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "2. Testing Golang Backend (mock mode)..." -ForegroundColor Yellow
cd m8_9_golang
go run test_data_generator.go
go build -o drishti-backend.exe
if ($LASTEXITCODE -ne 0) { exit 1 }

.\drishti-backend.exe `
    --events-json test_data/events/events.json `
    --rois-json test_data/rois/rois_per_frame.json `
    --header-json test_data/header.json `
    --frames-dir test_data/frames `
    --out-dir output_test

if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "3. Verifying output..." -ForegroundColor Yellow
if (!(Test-Path output_test/enriched_events.json)) { exit 1 }

Write-Host "✓ All tests passed!" -ForegroundColor Green
```

---

## Test Checklist Summary

### ✅ Must Test (Critical)
- [ ] Frontend builds without errors
- [ ] Golang backend builds without errors
- [ ] Mock mode works (no YOLO)
- [ ] Python pipeline processes a video
- [ ] Golang backend reads Python output
- [ ] Frontend displays data (real or mock)
- [ ] Navigation works (all views accessible)

### 🟡 Should Test (Important)
- [ ] YOLO detection works (full mode)
- [ ] Person tracking generates Track IDs
- [ ] Object detection finds phones
- [ ] Priority assignment correct
- [ ] Evidence list populated
- [ ] JSON output valid and complete

### 🔵 Nice to Test (Optional)
- [ ] Multiple videos in sequence
- [ ] Large video (>10 min)
- [ ] Video with no motion
- [ ] Video with many people
- [ ] Performance benchmarks
- [ ] Memory usage profiling

---

## Common Issues & Solutions

### Go not installed
```
Error: 'go' is not recognized
Solution: Install Go from https://go.dev/dl/
```

### Python opencv not found
```
Error: ModuleNotFoundError: No module named 'cv2'
Solution: pip install opencv-python
```

### YOLO model not found
```
Error: Failed to load YOLO model
Solution: Download yolov8n.onnx or run in mock mode
```

### No events detected
```
Warning: event_count: 0
Solution: Video might have no motion. Try different video or lower thresholds
```

### Frontend doesn't show data
```
Issue: Still showing mock data
Solution: Check console for fetch errors, verify JSON path
```

---

## Next Steps After Testing

1. **If all tests pass**: System is ready for production
2. **If some tests fail**: Check error messages and logs
3. **Performance issues**: Try YOLOv8n (fastest) or mock mode
4. **Accuracy issues**: Adjust confidence thresholds or fine-tune YOLO

## Contact & Support

- Check documentation: `README.md`, `PROJECT_STRUCTURE.md`
- Review architecture: `m8_9_golang/ARCHITECTURE.md`
- Quick start: `m8_9_golang/QUICKSTART.md`
- Implementation details: `IMPLEMENTATION_SUMMARY.md`
