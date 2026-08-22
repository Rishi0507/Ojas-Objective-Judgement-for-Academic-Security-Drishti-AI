# 🎯 NEXT TASK: Real YOLO + Visual Bounding Boxes

## 📋 Task Overview

**Goal:** Implement real YOLO inference and display bounding boxes visually in the UI

**Current State:**
- ✅ Enhanced mock mode active (image analysis)
- ✅ All infrastructure ready
- ✅ yolo_inference.go created
- ⏳ Real YOLO model not downloaded
- ⏳ Bounding boxes not visualized in UI

**Target State:**
- ✅ Real YOLO model running
- ✅ Actual person/object detections
- ✅ Bounding boxes drawn on video frames
- ✅ Visible in Event Detail view

---

## 🚀 Part 1: Enable Real YOLO Inference

### Step 1: Download YOLO Model

Run the setup script:
```powershell
.\setup_yolo.ps1
```

This will:
- Download `yolov8n.onnx` (~6MB)
- Save to `m8_9_golang/models/`
- Configure the system

**Expected output:**
```
[OK] Model downloaded: m8_9_golang/models/yolov8n.onnx
Model size: 6.2 MB
```

---

### Step 2: Install ONNX Runtime for Go

```bash
cd m8_9_golang
go get github.com/yalue/onnxruntime_go
cd ..
```

**Alternative (if above fails):**
```bash
# Try onnx runtime Go bindings
go get github.com/owulveryck/onnx-go
```

---

### Step 3: Implement Real Inference in yolo_inference.go

**File:** `m8_9_golang/yolo_inference.go`

**Function to update:** `InferFrame()` (line ~89)

**Current code:**
```go
func (yi *YOLOInference) InferFrame(framePath string, roi image.Rectangle) ([]YOLODetectionResult, error) {
    if !yi.initialized {
        return yi.generateEnhancedMockDetections(framePath, roi)
    }
    // TODO: Real YOLO inference
    return nil, fmt.Errorf("real YOLO inference not yet implemented")
}
```

**Replace with:**
```go
func (yi *YOLOInference) InferFrame(framePath string, roi image.Rectangle) ([]YOLODetectionResult, error) {
    if !yi.initialized {
        return yi.generateEnhancedMockDetections(framePath, roi)
    }

    // 1. Load and preprocess image
    img, err := yi.loadImage(framePath)
    if err != nil {
        return nil, err
    }

    // 2. Resize to YOLO input size (640x640)
    resized := yi.resizeImage(img, yi.inputSize, yi.inputSize)

    // 3. Convert to tensor [1, 3, 640, 640]
    tensor := yi.imageToTensor(resized)

    // 4. Run ONNX inference
    outputs, err := yi.onnxSession.Run([]onnxruntime_go.Tensor{tensor})
    if err != nil {
        return nil, err
    }

    // 5. Post-process: decode boxes, apply NMS
    detections := yi.postProcess(outputs[0], roi, img.Bounds())

    return detections, nil
}

// Helper: Load image
func (yi *YOLOInference) loadImage(path string) (image.Image, error) {
    file, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer file.Close()
    
    img, _, err := image.Decode(file)
    return img, err
}

// Helper: Resize image
func (yi *YOLOInference) resizeImage(img image.Image, width, height int) image.Image {
    // Use image/draw or imaging library
    // TODO: Implement resize logic
}

// Helper: Convert image to tensor
func (yi *YOLOInference) imageToTensor(img image.Image) onnxruntime_go.Tensor {
    // Convert to float32 array [1, 3, 640, 640]
    // Normalize: pixel / 255.0
    // TODO: Implement conversion
}

// Helper: Post-process YOLO output
func (yi *YOLOInference) postProcess(output onnxruntime_go.Tensor, roi image.Rectangle, bounds image.Rectangle) []YOLODetectionResult {
    // Decode boxes from YOLO output
    // Apply confidence threshold
    // Apply NMS
    // TODO: Implement post-processing
}
```

---

### Step 4: Initialize ONNX Session

**Add to NewYOLOInference():**
```go
func NewYOLOInference(modelPath string, confidenceThresh float64) (*YOLOInference, error) {
    // ... existing code ...

    // Initialize ONNX Runtime
    session, err := onnxruntime_go.NewSession(modelPath)
    if err != nil {
        return inf, fmt.Errorf("failed to load ONNX model: %v", err)
    }

    inf.onnxSession = session
    inf.initialized = true

    return inf, nil
}
```

**Add to YOLOInference struct:**
```go
type YOLOInference struct {
    modelPath        string
    confidenceThresh float64
    nmsThresh        float64
    inputSize        int
    classNames       []string
    personClassID    int
    phoneClassID     int
    bookClassID      int
    initialized      bool
    onnxSession      *onnxruntime_go.Session  // ADD THIS
}
```

---

### Step 5: Test Real YOLO

```bash
# Rebuild
.\build_backend.ps1

# Run integration
.\run_integration.bat

# Check logs for:
# [INFO] YOLO inference engine initialized
# [INFO] Model: models/yolov8n.onnx loaded
# [INFO] Running REAL inference mode
```

---

## 🎨 Part 2: Visualize Bounding Boxes in UI

### Goal: Draw boxes on video frames in Event Detail view

---

### Step 1: Generate Annotated Frames in Backend

**Create new file:** `m8_9_golang/annotator.go`

```go
package main

import (
    "image"
    "image/color"
    "image/draw"
    "image/jpeg"
    "os"
)

// AnnotateFrame draws bounding boxes on an image
func AnnotateFrame(framePath string, detections []Detection, outputPath string) error {
    // Load original frame
    file, err := os.Open(framePath)
    if err != nil {
        return err
    }
    defer file.Close()

    img, _, err := image.Decode(file)
    if err != nil {
        return err
    }

    // Create mutable image
    bounds := img.Bounds()
    rgba := image.NewRGBA(bounds)
    draw.Draw(rgba, bounds, img, bounds.Min, draw.Src)

    // Draw bounding boxes
    for _, det := range detections {
        color := getColorForClass(det.ClassName)
        drawBox(rgba, det.BBox, color, 3)
        drawLabel(rgba, det.BBox, det.ClassName, det.Confidence, color)
    }

    // Save annotated image
    outFile, err := os.Create(outputPath)
    if err != nil {
        return err
    }
    defer outFile.Close()

    return jpeg.Encode(outFile, rgba, &jpeg.Options{Quality: 90})
}

// Draw rectangle
func drawBox(img *image.RGBA, box image.Rectangle, col color.Color, thickness int) {
    // Draw top line
    for x := box.Min.X; x < box.Max.X; x++ {
        for t := 0; t < thickness; t++ {
            img.Set(x, box.Min.Y+t, col)
            img.Set(x, box.Max.Y-t, col)
        }
    }
    // Draw side lines
    for y := box.Min.Y; y < box.Max.Y; y++ {
        for t := 0; t < thickness; t++ {
            img.Set(box.Min.X+t, y, col)
            img.Set(box.Max.X-t, y, col)
        }
    }
}

// Draw label
func drawLabel(img *image.RGBA, box image.Rectangle, label string, confidence float64, col color.Color) {
    // TODO: Add text rendering library
    // For now, just draw a filled rectangle for label background
    labelBox := image.Rect(box.Min.X, box.Min.Y-20, box.Min.X+150, box.Min.Y)
    draw.Draw(img, labelBox, &image.Uniform{col}, image.Point{}, draw.Src)
}

// Color coding
func getColorForClass(className string) color.Color {
    switch className {
    case "person":
        return color.RGBA{0, 255, 0, 255}    // Green
    case "cell phone":
        return color.RGBA{255, 0, 0, 255}    // Red
    case "book":
        return color.RGBA{255, 165, 0, 255}  // Orange
    default:
        return color.RGBA{255, 255, 0, 255}  // Yellow
    }
}
```

---

### Step 2: Call Annotator in Processor

**Update:** `m8_9_golang/processor.go` → `detectAndTrackPersons()`

**Add after detection:**
```go
// After running detection on frame
detections, err := detector.DetectFrame(framePath, roiRect)
if err != nil {
    continue
}

// SAVE ANNOTATED FRAME
annotatedPath := filepath.Join(outDir, "annotated", fmt.Sprintf("annotated_frame_%05d.jpg", frame.FrameIdx))
os.MkdirAll(filepath.Dir(annotatedPath), 0755)
AnnotateFrame(framePath, detections, annotatedPath)

// Continue with tracking...
```

---

### Step 3: Create Annotated Video Clips API

**Create:** `app/api/annotated-stream/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const frameIdx = searchParams.get('frame');
    
    if (!frameIdx) {
      return NextResponse.json({ error: 'Frame index required' }, { status: 400 });
    }
    
    // Path to annotated frame
    const framePath = path.join(
      process.cwd(),
      'pipeline_out/cctv_video/backend_output/annotated',
      `annotated_frame_${frameIdx.padStart(5, '0')}.jpg`
    );
    
    if (!fs.existsSync(framePath)) {
      return NextResponse.json({ error: 'Frame not found' }, { status: 404 });
    }
    
    const imageBuffer = fs.readFileSync(framePath);
    
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Error serving annotated frame:', error);
    return NextResponse.json({ error: 'Failed to load frame' }, { status: 500 });
  }
}
```

---

### Step 4: Update EventDetail Component to Show Annotated Video

**File:** `components/EventDetail.tsx`

**Add toggle for annotated view:**

```typescript
const [showAnnotated, setShowAnnotated] = useState(false);
const [currentFrameIdx, setCurrentFrameIdx] = useState(0);

// Add toggle button
<div className="flex items-center gap-3 mt-3">
  <button 
    onClick={() => setShowAnnotated(!showAnnotated)}
    className={cn(
      "px-4 py-2 rounded-lg transition-colors",
      showAnnotated 
        ? "bg-primary text-primary-foreground" 
        : "card card-hover"
    )}
  >
    {showAnnotated ? '📦 Original' : '🎯 Annotated (Bounding Boxes)'}
  </button>
</div>

// Update video source or overlay
{showAnnotated && (
  <div className="absolute inset-0 pointer-events-none">
    <img 
      src={`/api/annotated-stream?frame=${currentFrameIdx}`}
      alt="Annotated frame"
      className="w-full h-full object-contain"
    />
  </div>
)}
```

**Update video timeupdate handler:**
```typescript
const handleTimeUpdate = () => {
  if (!videoRef.current || !eventData) return;
  
  setCurrentTime(video.currentTime);
  
  // Calculate frame index from timestamp
  const fps = 5; // from sampling
  const frameIdx = Math.floor((video.currentTime - eventData.start) * fps);
  setCurrentFrameIdx(frameIdx);
  
  // Auto-pause at event end
  if (video.currentTime >= eventData.end) {
    video.pause();
    setIsPlaying(false);
  }
}
```

---

## 📋 Summary Checklist

### Backend (Real YOLO):
- [ ] Run `.\setup_yolo.ps1` to download model
- [ ] Install `onnxruntime-go` package
- [ ] Implement `InferFrame()` with real inference
- [ ] Add image preprocessing (resize, normalize)
- [ ] Add YOLO output post-processing (decode boxes, NMS)
- [ ] Initialize ONNX session in `NewYOLOInference()`
- [ ] Test with `.\build_backend.ps1` and `.\run_integration.bat`

### Visualization (Bounding Boxes):
- [ ] Create `annotator.go` with box drawing functions
- [ ] Integrate annotator in `processor.go`
- [ ] Generate annotated frames during detection
- [ ] Create `/api/annotated-stream` endpoint
- [ ] Add toggle button in EventDetail component
- [ ] Display annotated frames synchronized with video
- [ ] Add legend (color coding for different classes)

### Testing:
- [ ] Verify real YOLO detections in logs
- [ ] Check annotated frames generated
- [ ] Test bounding box visibility in UI
- [ ] Verify color coding (green=person, red=phone, orange=book)
- [ ] Test video playback with annotation overlay
- [ ] Verify frame synchronization

---

## 📖 Expected Result

**After completion:**

1. **Backend logs show:**
```
[INFO] YOLO inference engine initialized
[INFO] Model: models/yolov8n.onnx loaded
[INFO] Running REAL inference mode
[INFO] Person detected: bbox=[320,180,440,380], conf=0.87
[INFO] Cell phone detected: bbox=[380,220,400,250], conf=0.68
[INFO] Annotated frame saved: annotated_frame_00145.jpg
```

2. **UI shows:**
- Toggle button: "🎯 Annotated (Bounding Boxes)"
- When clicked: Green boxes around persons
- Red boxes around phones
- Orange boxes around books/papers
- Labels with confidence scores
- Synchronized with video playback

3. **File structure:**
```
pipeline_out/cctv_video/backend_output/
├── enriched_events.json
└── annotated/
    ├── annotated_frame_00001.jpg
    ├── annotated_frame_00002.jpg
    └── ...
```

---

## 🔗 Helpful Resources

- **ONNX Runtime Go:** https://github.com/yalue/onnxruntime_go
- **YOLOv8 Output Format:** https://docs.ultralytics.com/modes/predict/
- **Go Image Processing:** https://pkg.go.dev/image
- **YOLO Post-processing:** https://github.com/ultralytics/ultralytics/blob/main/ultralytics/utils/ops.py

---

## ⚠️ Important Notes

1. **YOLO Output Format:**
   - YOLOv8 outputs: [1, 84, 8400] tensor
   - First 4 values: [x, y, w, h] (center format)
   - Next 80 values: class probabilities
   - Need to convert center format to corners: [x1, y1, x2, y2]

2. **Performance:**
   - Real YOLO: ~10-20ms per frame on CPU
   - Annotated frame generation: ~5ms per frame
   - Total: Still fast enough for 4 events

3. **Memory:**
   - YOLO model: 6MB
   - Annotated frames: ~50KB each
   - Total additional storage: ~30MB for 573 frames

---

## 🎯 Priority Order

**If time limited, implement in this order:**

1. **High Priority:** Real YOLO inference (core feature)
2. **Medium Priority:** Generate annotated frames (backend)
3. **Low Priority:** UI visualization (nice-to-have)

Even without UI visualization, having real YOLO detections in the backend is valuable!

---

**Good luck! The infrastructure is 100% ready, just need to plug in the pieces! 🚀**
