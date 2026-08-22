# DrishtiAI Video Analytics System

**Full-Stack Offline Video Analytics for PS2 DrishtiAI Hackathon**

A complete video surveillance and exam monitoring system with motion detection, person tracking, object detection, and quality analysis.

## Overview

DrishtiAI is a comprehensive video analytics pipeline consisting of:

1. **Python Modules 1-7** (`m1_7/`): Motion detection, ROI extraction, quality analysis, event segmentation
2. **Golang Modules 8-9** (`m8_9_golang/`): Person detection & tracking, object detection (phone, paper)
3. **Next.js Frontend**: Clean, professional dashboard for video analysis and event review

## Architecture

```
Raw Video (MP4)
    ↓
┌─────────────────────────────────────────────┐
│  Python Pipeline (Modules 1-7)              │
│  ├─ Module 1: Metadata extraction           │
│  ├─ Module 2: Frame sampling (5 fps)        │
│  ├─ Module 3: Motion detection              │
│  ├─ Module 4: Mask cleanup                  │
│  ├─ Module 5: ROI extraction                │
│  ├─ Module 6: Quality analysis              │
│  └─ Module 7: Event segmentation            │
│      → events.json, rois.json, clips/       │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│  Golang Backend (Modules 8-9)               │
│  ├─ Module 8: Person detection & tracking   │
│  │    (YOLO + ByteTrack, anonymized IDs)    │
│  └─ Module 9: Object detection              │
│       (Phone, paper using YOLO)             │
│      → enriched_events.json                 │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│  Next.js Frontend                           │
│  ├─ Dashboard: Video overview               │
│  ├─ VideoAnalysis: Timeline & heatmap       │
│  └─ EventDetail: Clip playback & feedback   │
└─────────────────────────────────────────────┘
```

## Quick Start

### 1. Run Python Pipeline (Modules 1-7)

```bash
cd m1_7

# Install Python dependencies
pip install opencv-python numpy

# Run pipeline on a video
python run_pipeline.py path/to/video.mp4 --out-dir pipeline_out/video
```

**Output**: `pipeline_out/video/events/events.json`, ROIs, clips, heatmap

### 2. Run Golang Backend (Modules 8-9)

```bash
cd m8_9_golang

# Build (requires Go 1.21+, OpenCV)
go mod download
go build -o drishti-backend

# Run (mock mode - no YOLO needed for testing)
./drishti-backend \
    --events-json ../m1_7/pipeline_out/video/events/events.json \
    --rois-json ../m1_7/pipeline_out/video/rois/rois_per_frame.json \
    --header-json ../m1_7/pipeline_out/video/header.json \
    --frames-dir ../m1_7/pipeline_out/video/frames \
    --out-dir ./output
```

**Output**: `output/enriched_events.json` (API-ready JSON for frontend)

### 3. Run Frontend

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:3000
```

## Project Structure

```
drishti-video-analytics/
├── m1_7/                          # Python pipeline (Modules 1-7)
│   ├── module1_metadata.py        # Video metadata extraction
│   ├── module2_frame_sampling.py  # Frame sampling at 5 fps
│   ├── module3_motion_detection.py # Motion detection ensemble
│   ├── module4_mask_cleanup.py    # Morphological cleanup
│   ├── module5_roi_extraction.py  # ROI extraction & merging
│   ├── module6_quality_analysis.py # Camera shake, blur, lighting
│   ├── module7_event_segmentation.py # Temporal event segmentation
│   └── run_pipeline.py            # End-to-end orchestrator
│
├── m8_9_golang/                   # Golang backend (Modules 8-9)
│   ├── main.go                    # Entry point
│   ├── types.go                   # Data structures
│   ├── detector.go                # YOLO detector & tracker
│   ├── processor.go               # Event processing & enrichment
│   ├── README.md                  # Full documentation
│   └── QUICKSTART.md              # 5-minute setup guide
│
├── app/                           # Next.js App Router
│   ├── layout.tsx                 # Root layout
│   ├── page.tsx                   # Main routing logic
│   └── globals.css                # Global styles
│
├── components/                    # React components
│   ├── Hero.tsx                   # Landing page
│   ├── Sidebar.tsx                # Navigation
│   ├── Header.tsx                 # Top bar
│   ├── Dashboard.tsx              # Video dashboard
│   ├── VideoAnalysis.tsx          # Analysis view
│   └── EventDetail.tsx            # Event detail view
│
└── PROJECT_STRUCTURE.md           # Complete documentation
```

## Frontend Features

- **Clean Professional Design**: Neutral theme (light gray background, white cards)
- **Video Dashboard**: Overview of all processed videos with status indicators
- **Motion Detection**: Timeline visualization of detected events
- **Event Analysis**: Detailed breakdown with person tracking and object detection
- **Motion Heatmap**: Visual representation of activity concentration
- **Quality Metrics**: Observability, camera shake, blur, lighting analysis
- **Filter Profiles**: Quick filtering by event type (phone activity, proximity, unusual motion)
- **Event Detail View**: Frame-by-frame playback with ROI overlay
- **Feedback System**: Investigator can mark events as relevant/false-positive

## Backend Features

### Module 8: Person Detection & Tracking
- **YOLO-based detection**: YOLOv8n/s for real-time person detection
- **ByteTrack-inspired tracking**: Simple centroid-based tracking across frames
- **Anonymized IDs**: Track-01, Track-02, etc. (no facial recognition)
- **Coarse-to-fine**: Only runs inside ROIs from Module 5 (70-90% speedup)

### Module 9: Object Detection
- **Phone detection**: COCO pretrained "cell phone" class
- **Paper detection**: COCO "book" class as proxy
- **Object-person linking**: Associates objects with person tracks
- **Confidence filtering**: Configurable threshold (default 0.5)

## Documentation

- **[docs/PROJECT_STRUCTURE.md](./docs/PROJECT_STRUCTURE.md)**: Frontend architecture, API contract, design system
- **[docs/RESEARCH.md](./docs/RESEARCH.md)**: Research on Pretrained Models and Classical Algorithms for Video Analytics
- **[m8_9_golang/README.md](./m8_9_golang/README.md)**: Golang backend full documentation
- **[m8_9_golang/QUICKSTART.md](./m8_9_golang/QUICKSTART.md)**: 5-minute setup guide
- **Python modules**: See inline docstrings in `m1_7/*.py`

## Tech Stack

### Python Pipeline
- OpenCV: Video processing, motion detection
- NumPy: Numerical operations
- FFmpeg: Video metadata, clip export

### Golang Backend
- Go 1.21+: High-performance processing
- GoCV: OpenCV bindings for Go
- YOLO (ONNX): Person and object detection

### Frontend
- Next.js 14: React framework
- TypeScript: Type safety
- Tailwind CSS: Styling
- Recharts: Data visualization
- Framer Motion: Animations

## Deployment

### Frontend
```bash
npm run build
npm start
# Or deploy to Vercel: vercel deploy
```

### Backend
```bash
cd m8_9_golang
go build -o drishti-backend
# Run as service or Docker container
```

### Python Pipeline
```bash
# Batch processing
python m1_7/run_pipeline.py video1.mp4 --out-dir output/video1
python m1_7/run_pipeline.py video2.mp4 --out-dir output/video2
```

## Privacy & Security

- **No facial recognition**: Person tracking uses centroid-based matching only
- **Anonymized IDs**: Track IDs are ephemeral and reset per video
- **Offline processing**: All detection runs locally, no cloud APIs
- **Consent-aware**: Designed for exam proctoring with informed consent
- **Data retention**: Videos and results stored locally, under your control  

---

**Built for DrishtiAI Hackathon**
