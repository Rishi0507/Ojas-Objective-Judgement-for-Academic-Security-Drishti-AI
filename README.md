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
# Research: Pretrained Models + Classical Algorithms for Examination Hall Video Analytics

> **CONSTRAINT**: NO training from scratch. NO fine-tuning requiring labeled datasets. Only pretrained models used as-is (zero-shot, frozen features) and classical CV algorithms. All weights come from public sources (HuggingFace, OpenMMLab, GitHub releases, Meta FAIR, Princeton VL, Google, etc.).

---

## 1. Executive Summary

This research catalogues the open-source tooling landscape for building a complete **offline examination-hall video analytics pipeline** under a strict "no-training" constraint. The philosophy is simple: foundation models trained on massive generic datasets (COCO, Kinetics, ImageNet, Laion, SA-1B, OpenImages) already encode the visual concepts needed for examination surveillance (people, phones, paper, hands, faces, posture) and the temporal patterns needed to flag anomalous motion. Instead of collecting labeled cheating data, we **assemble a glue-logic pipeline** that calls each pretrained component as a frozen inference module and fuses their outputs with classical signal-processing (FFT, Bayesian change-point, DBSCAN, Kalman) into actionable events.

The architecture has three layers. The **classical layer** (OpenCV optical flow, MOG2/KNN background subtraction, Eulerian Video Magnification, ORB+RANSAC stabilization, ruptures change-point detection, HDBSCAN clustering) provides cheap, deterministic motion energy, ROI proposals, and event boundaries that require no neural network at all. The **pretrained perception layer** (YOLOv8/v11, RT-DETR, Grounding DINO, OWLv2, SAM2, RAFT, SEA-RAFT, YOLOv8-Pose, MediaPipe Holistic, VideoMAE V2, SlowFast, X3D, ViTPose) supplies high-quality detections, masks, flows, keypoints, and action logits. The **pretrained reasoning layer** (VadCLIP with frozen CLIP, Holmes-VAD/VAU with frozen VLM, Qwen2-VL/Video-LLaVA for summarization) provides zero-shot anomaly scoring and natural-language event descriptions.

**Why this is feasible.** The latest open-vocabulary detectors (Grounding DINO, OWLv2) achieve >50 AP zero-shot on COCO and can be prompted with free text such as "mobile phone, paper chit, smartwatch, earbud" without any class-specific training. SAM2 segments any object in video given a click or box, which means we never need to train a segmenter for the prohibited-item mask. Kinetics-pretrained action models already cover actions like "texting", "holding object", "turning around", "whispering", "drinking", "writing" — directly useful for student behavior. CLIP-based VAD methods (VadCLIP, CLIP-TSA, Holmes-VAD) provide frame-level anomaly scores with no task-specific training. The "STGCN + FFT" angle exploits the fact that pretrained STGCN weights on Kinetics-400 are public; we run inference on per-student skeletons produced by YOLOv8-Pose/MediaPipe and apply FFT analysis to STGCN's intermediate spectral activations to detect rhythmic, suspicious hand/head motion (e.g., repeatedly reaching into a pocket) without any fine-tuning.

**Deployment advantages.** (1) No labeled data collection — by far the largest cost in surveillance ML. (2) Pipeline components can be hot-swapped when better checkpoints are released (e.g., YOLOv9 → YOLOv11 → YOLOv12). (3) Models run on a single RTX 4070/4090 with carefully chosen precision (FP16 / INT8). (4) Deterministic offline processing means we can replay any flagged event through multiple models for cross-validation. (5) Privacy: faces can be detected with SCRFD and redacted before any VLM summarization. (6) All components have Apache 2.0 or MIT-style licenses (with a few CC-BY-NC exceptions clearly flagged below), enabling institutional deployment. Total cataloged below: **55+ distinct pretrained models and 25+ classical algorithms/methods**, each with checkpoint URLs, license, install command, and inference pipeline.

---

## 2. Classical Computer Vision Algorithms (No ML)

### 2.1 Optical Flow (OpenCV + extensions)

Optical flow is the single most important classical primitive for our pipeline: it gives a per-pixel motion vector field between two frames and is the foundation for ROI proposals, motion heatmaps, vibration compensation, and event segmentation. All variants below ship with OpenCV (`pip install opencv-contrib-python`).

#### Farneback Dense Optical Flow
- **Description**: Polynomial expansion based dense flow. Returns a full (H,W,2) vector field. Suitable for whole-frame motion analysis and cumulative heatmaps.
- **License**: Apache 2.0 (OpenCV)
- **How to use without training**: `cv2.calcOpticalFlowFarneback(prev_gray, next_gray, None, pyr_scale=0.5, levels=3, winsize=15, iterations=3, poly_n=5, poly_sigma=1.1, flags=0)`. Compute magnitude+angle, threshold magnitude (e.g., >1.0 px/frame) to produce a motion mask, then accumulate the mask over a sliding window into a heatmap.
- **Exam-hall application**: Global motion field. Aggregate magnitude over 1-minute windows to find seats with highest activity. Detect camera vibration as uniformly high flow (vs localized flow for student motion).
- **Latency**: ~8 ms/frame at 720p on a modern CPU (NVIDIA blog, 2019); ~2 ms with the CUDA-accelerated `cv2.cuda_FarnebackOpticalFlow` build.
- **Install**: `pip install opencv-contrib-python`

#### Lucas-Kanade Sparse Optical Flow
- **Description**: Sparse flow on Shi-Tomasi / goodFeaturesToTrack corner points. Very fast, ideal for tracking a small set of features across long videos.
- **License**: Apache 2.0
- **How to use without training**: `cv2.calcOpticalFlowPyrLK(prev_gray, next_gray, p0, None)`. Use `cv2.goodFeaturesToTrack` to seed points at student desk locations; track across frames; a sudden displacement vector > threshold on a tracked point flags that student.
- **Exam-hall application**: Track pen tips, hands, ear positions, and any small object passed between desks (cheating evidence). Combine with a Kalman filter (`cv2.KalmanFilter`) for robustness to occlusions.
- **Latency**: >20 ms/frame naive; ~5 ms when tracking ≤200 points.
- **Install**: `pip install opencv-contrib-python`

#### Horn-Schunck
- **Description**: Global energy-minimization dense flow. Smoother fields than Farneback but slower; useful for low-texture regions.
- **License**: Apache 2.0 (in `opencv-contrib` as `cv2.optflow.createOptFlow_HornSchunck()`)
- **How to use without training**: Instantiate and call `.calc(prev_gray, next_gray, None)`.
- **Exam-hall application**: Smooth motion field for desks with little texture (blank tabletops where subtle motion needs to be detected).
- **Latency**: ~80 ms at 480p (CPU).

#### DualTV-L1
- **Description**: TV-L1 variational flow, robust to outliers; widely used in surveillance because it tolerates sudden lighting changes.
- **License**: Apache 2.0
- **How to use without training**: `cv2.createOptFlow_DualTVL1_create(); flow = calc(prev_gray, next_gray, None)`.
- **Exam-hall application**: Robust flow when lights flicker or curtains cast moving shadows — typical of large halls with windows.
- **Latency**: ~50 ms at 480p.

#### RLOF (Robust Local Optical Flow)
- **Description**: Local optical flow with adaptive support; OpenCV variant in `opencv-contrib` (`cv2.optflow.createOptFlow_DenseRLOF()`).
- **License**: Apache 2.0
- **How to use without training**: `cv2.optflow.calcOptFlow_DenseRLOF(prev, next, None)`. More accurate than Farneback on real-world CCTV.
- **Exam-hall application**: Better ROI proposals on noisy H.264-encoded CCTV with compression artifacts.

### 2.2 Background Subtraction

These algorithms maintain a running background model and output a foreground mask per frame. All are in `opencv-contrib`. Perfect for finding moving students, dropped chits, or passing objects.

| Algorithm | OpenCV class | When to use | License |
|-----------|--------------|-------------|---------|
| MOG2 | `cv2.createBackgroundSubtractorMOG2()` | Default. Gaussian mixture; handles multi-modal backgrounds (curtains, fans). | BSD |
| KNN | `cv2.createBackgroundSubtractorKNN()` | When small background parts change often (KNN better than MOG2 for that). | BSD |
| GMG | `cv2.bgsegm.createBackgroundSubtractorGMG()` | Statistical + per-pixel Bayesian; good for first 100 frames of a new camera. | BSD |
| LSBP | `cv2.bgsegm.createBackgroundSubtractorLSBP()` | Local SVD binary pattern; robust to dynamic backgrounds (tree/wave/fan). | BSD |
| CNT | `cv2.bgsegm.createBackgroundSubtractorCNT()` | Pixel-count algorithm; very fast, low memory. Good for long videos. | BSD |
| GSOC | `cv2.bgsegm.createBackgroundSubtractorGSOC()` | Improved LSBP; SOTA among classical, good on camera noise. | BSD |

**Exam-hall application**: Run MOG2 (with `varThreshold=40`, `detectShadows=True`) as the primary foreground extractor; use the mask to (a) propose ROIs for the object detector, (b) accumulate into a motion heatmap, (c) drive Kalman trackers. Combine with shadow removal (set shadow pixel = 0) so curtain/fan shadows do not generate false motion.

**Install**: `pip install opencv-contrib-python`

**Latency**: ~3 ms/frame at 720p for MOG2; ~5 ms for GSOC.

### 2.3 FFT-based Motion Saliency

#### Spectral Residual (SR) Saliency
- **Description**: Computes the log-spectrum of the image, removes the average trend, and inverse-transforms to get a saliency map. Detects visually salient regions without any learning.
- **License**: BSD (OpenCV: `cv2.saliency.StaticSaliencySpectralResidual_create()`)
- **How to use without training**: `saliency = cv2.saliency.StaticSaliencySpectralResidual_create(); success, map = saliency.computeSaliency(frame)`.
- **Exam-hall application**: Find regions that visually pop out (a sudden phone screen glowing, a paper chit) before applying the heavier object detector — accelerates inference by ~3x.

#### Temporal FFT motion detection
- **Description**: Stack N frames per pixel, take the temporal FFT, threshold the magnitude of low-frequency bins (e.g., 0.5–5 Hz) to find pixels with periodic motion.
- **License**: BSD (numpy + scipy)
- **How to use without training**: `stack = np.stack(frames); spectrum = np.fft.rfft(stack, axis=0); motion = np.abs(spectrum[1:8]).sum(0)`.
- **Exam-hall application**: Detect rhythmic hand motion (texting under a desk — usually 2-4 Hz), pen-tapping, or furtive head turns. Use as a temporal filter on the dense flow magnitude.

#### Phase-based motion magnification (also see 2.4)
- **Description**: Decompose frames into a complex Steerable Pyramid, amplify the phase differences, reconstruct. Reveals sub-pixel motion.
- **License**: MIT (multiple open implementations)
- **Exam-hall application**: Reveal subtle breathing, head-bobbing, and micro-hand-motion before sending frames to the action recognizer.

### 2.4 Eulerian Video Magnification (EVM)

EVM amplifies temporal color/intensity variations in a video to make imperceptible motion visible — perfect for detecting subtle student movements (slight hand shift, jaw movement when whispering, gaze direction shifts).

#### MIT CSAIL Original (Wu et al., SIGGRAPH 2012)
- **Description**: Spatial Laplacian pyramid + temporal bandpass filter + amplification. The reference implementation. Detects 0.4–3 Hz color/motion changes.
- **Repo**: https://github.com/healthylivin/EulerianVideoMagnification (and the official MIT page: https://people.csail.mit.edu/mrub/evm/)
- **License**: MIT
- **How to use without training**: Build a Laplacian pyramid per frame; for each level apply a temporal bandpass Butterworth filter (scipy.signal.butter, low=0.4 Hz, high=3 Hz) over a sliding window of 30 frames; multiply by α=10; collapse the pyramid.
- **Exam-hall application**: Magnify the desk area to reveal whether a hand is moving toward a pocket, paper, or another student's desk. Use as preprocessing before dense flow for ~5 dB SNR improvement on weak motion.

#### Phase-Based EVM (Wadhwa et al., ICCP 2013)
- **Description**: Uses Steerable Pyramid phases instead of intensities; better at amplifying large motions without artifacts.
- **Repo**: https://github.com/tschnz/Live-Video-Magnification (Qt6 GUI, MIT); https://github.com/rgov/vidmag (Octave port); https://github.com/NikolaosGian/PhaseBasedEVMCpp (C++).
- **License**: MIT
- **How to use without training**: Same recipe but replace Laplacian pyramid with Steerable Pyramid (use `pyrtools` package, `pip install pyrtools`).
- **Exam-hall application**: Magnify small movements of hands, eyes, and head turns; downstream detectors (YOLOv8-Pose, MediaPipe Holistic) will get cleaner keypoints.

#### Learning-based EVM variants (2022+)
- **Description**: Deep learning variants such as "Deep Video Magnification" (Oh et al., CVPR 2018) and "3D Motion Magnification" (CVPR 2024) use pretrained networks.
- **Repo**: https://3d-motion-magnification.github.io/
- **License**: Research code (typically MIT for code; weights research-only)
- **How to use without training**: Download their provided checkpoints; run inference via the released PyTorch scripts.
- **Exam-hall application**: Handles camera shake (handheld CCTV) better than classical EVM.

### 2.5 Camera Motion Compensation

Critical because exam halls often have ceiling fans that cause camera wobble (especially pole-mounted cameras), which generates false motion in MOG2/flow.

#### ORB + RANSAC Homography
- **Description**: Detect ORB features (`cv2.ORB_create()`), match with BFMatcher, compute homography with `cv2.findHomography(..., cv2.RANSAC, 5.0)`, warp the previous frame to align with current (`cv2.warpPerspective`).
- **License**: Apache 2.0
- **How to use without training**: Standard OpenCV pipeline; ~10 ms per frame at 720p.
- **Exam-hall application**: Stabilize the video before MOG2 / dense flow so only genuine student motion remains.
- **Install**: `pip install opencv-contrib-python`

#### SIFT + RANSAC
- **Description**: More accurate than ORB at higher compute cost. `cv2.SIFT_create()`.
- **License**: Apache 2.0 (since OpenCV 4.4; previously patented).
- **How to use without training**: Same as ORB.

#### Video Stabilization (LearnOpenCV tutorial)
- **Description**: Smooths the camera trajectory across many frames by smoothing the accumulated affine transform with a moving average.
- **Repo**: https://learnopencv.com/video-stabilization-using-point-feature-matching-in-opencv/
- **License**: MIT (tutorial code)
- **Exam-hall application**: Post-process the homography stream with a Gaussian smoother (window=30 frames) to remove high-frequency wobble.

#### Deep Homography (pretrained)
- **Description**: "Content-Aware Unsupervised Deep Homography Estimation" (LERP/LHRT) and similar; networks that predict homography from image pairs.
- **Repos**: https://github.com/megvii-research/HomographyEstimation, https://github.com/JirongZhang/HomographyEstimation
- **License**: Apache 2.0
- **How to use without training**: Download provided checkpoints and run forward pass.
- **Exam-hall application**: More robust than ORB when the scene is mostly textureless (blank walls) and lighting is poor.

### 2.6 Classical Anomaly Scoring & Event Segmentation

#### Z-score on motion energy
- **Description**: Compute per-second motion energy (sum of MOG2 foreground pixels). Compute sliding-window mean/std; flag frames where z-score > 3.
- **How to use without training**: Pure numpy; ~5 lines of code.
- **Exam-hall application**: Per-student-seat motion energy z-score; flag high-motion seats for review.

#### Bayesian Online Change-Point Detection (BOCPD)
- **Description**: Adams & MacKay 2007 algorithm. Maintains a run-length distribution and flags change-points where the underlying distribution changes.
- **Repo**: https://github.com/hildensia/bayesian_changepoint_detection (MIT)
- **How to use without training**: `pip install bayesian-changepoint-detection`. Feed motion energy signal; returns probability of change-point per frame.
- **Exam-hall application**: Segment long videos into "activity states" — entering room, exam in progress, break, leaving — for clip extraction.

#### ruptures library
- **Description**: Comprehensive Python library for offline change-point detection (PELT, Binseg, Window, BottomUp, Dynp algorithms + kernel cost functions).
- **Repo / docs**: https://centre-borelli.github.io/ruptures-docs
- **License**: BSD-2-Clause
- **How to use without training**: `pip install ruptures`. `algo = rpt.Pelt(model="rbf").fit(signal); result = algo.predict(pen=10)`.
- **Exam-hall application**: Cut a 3-hour exam into ~50–200 event clips; each clip gets sent to the action recognizer / VLM.

#### DBSCAN / HDBSCAN event clustering
- **Description**: Density-based clustering that groups flagged frames into events (handling variable event length, noise points as non-events).
- **Repo**: `pip install hdbscan` (BSD-3); `pip install scikit-learn` (BSD-3) for DBSCAN.
- **How to use without training**: Cluster 5-D features (timestamp, x, y, motion magnitude, detector confidence). Each cluster = one event.
- **Exam-hall application**: Group many individual frame-level anomalies into a single "cheating event" with start/end timestamps.

#### HMM-based temporal segmentation
- **Description**: Hidden Markov Models with Gaussian emissions; classic for activity state segmentation.
- **Repo**: `pip install hmmlearn` (BSD-3)
- **How to use without training**: Fit an HMM unsupervised (Baum-Welch) on the motion-energy feature vector; Viterbi decoding yields state sequence.
- **Exam-hall application**: Discover latent states (e.g., "writing", "thinking", "looking-around", "passing-object") without labels.

### 2.7 Classical ROI & Heatmap Generation

#### Cumulative Motion Heatmap
- **Description**: Sum binary motion masks (from MOG2 / thresholded flow) over a long window (e.g., 5 minutes). Gaussian blur (`cv2.GaussianBlur`) for visualization.
- **Exam-hall application**: Deliver as a deliverable: a per-hall heatmap showing where activity concentrated.

#### Watershed Segmentation of Motion Regions
- **Description**: `cv2.watershed` on the distance transform of the motion mask to separate touching student regions.
- **Exam-hall application**: When two students sit close, separate their motion blobs.

#### Hough-based object proposals
- **Description**: `cv2.HoughLinesP` and `cv2.HoughCircles` detect line/circle structures (e.g., rectangular phones, round watch faces).
- **Exam-hall application**: Pre-filter for the object detector: only run YOLO on regions where Hough found a candidate rectangle.

#### Connected components + contour area filtering
- **Description**: `cv2.connectedComponentsWithStats`, then filter by area (e.g., 500 px² < area < 50000 px²) to remove noise and global motion.
- **Exam-hall application**: Robust ROI proposal with single command.

### 2.8 Other Classical Utilities

| Algorithm | Use |
|-----------|-----|
| CLAHE (`cv2.createCLAHE`) | Contrast enhancement for low-light halls. |
| Retinex (classical variants, e.g., LIME) | Low-light enhancement; check `https://github.com/pengzhou110/LIME`. |
| Wavelet denoise (`pywt`) | Suppress CCTV compression noise. `pip install pywt` (MIT). |
| Kalman filter (`cv2.KalmanFilter`) | Track point/object state between detections. |
| Hungarian algorithm (`scipy.optimize.linear_sum_assignment`) | Associate detections to tracks (used by SORT-family trackers). |
| IoU tracking (manual) | Simple baseline tracker when no ReID is available. |

---

## 3. Pretrained Object Detection & Segmentation

### 3.1 YOLO Family (ultralytics) — COCO pretrained

The Ultralytics package auto-downloads COCO-pretrained checkpoints on first use. YOLOv8/v11/v12 are recommended; YOLOv9, YOLOv10 also available. They detect the 80 COCO classes including `person`, `cell phone`, `book`, `clock`, `laptop`, `scissors`, `tie`, `handbag`, `backpack` — most of what we need.

| Model | Weights URL (auto-downloaded) | Params (M) | mAP50-95 (COCO) | RTX 4070 FPS (FP16, 640px) | License |
|-------|-------------------------------|------------|------------------|----------------------------|---------|
| YOLOv8n | https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.pt | 3.2 | 37.3 | ~750 | AGPL-3.0 |
| YOLOv8s | yolov8s.pt | 11.2 | 44.9 | ~450 | AGPL-3.0 |
| YOLOv8m | yolov8m.pt | 25.9 | 50.2 | ~250 | AGPL-3.0 |
| YOLOv8l | yolov8l.pt | 43.7 | 52.9 | ~140 | AGPL-3.0 |
| YOLOv8x | yolov8x.pt | 68.2 | 53.9 | ~95 | AGPL-3.0 |
| YOLOv11n | yolov11n.pt | 2.6 | 39.5 | ~800 | AGPL-3.0 |
| YOLOv11s | yolov11s.pt | 9.4 | 47.0 | ~480 | AGPL-3.0 |
| YOLOv11m | yolov11m.pt | 20.1 | 49.9 | ~250 | AGPL-3.0 |
| YOLOv11l | yolov11l.pt | 25.3 | 53.4 | ~150 | AGPL-3.0 |
| YOLOv11x | yolov11x.pt | 56.9 | 54.7 | ~85 | AGPL-3.0 |
| YOLOv12n | yolov12n.pt | ~3 | 40.6 | ~700 | AGPL-3.0 |
| YOLOv9c | yolov9c.pt | 25.3 | 53.0 | ~150 | GPL-3.0 |
| YOLOv10n | yolov10n.pt | 2.3 | 38.5 | ~750 | AGPL-3.0 |
| YOLOv8-Pose (n/s/m/l/x) | yolov8s-pose.pt | 11.2 | mAP 60.9 (pose) | ~400 | AGPL-3.0 |

**License note**: Ultralytics YOLO is AGPL-3.0 — fine for internal/educational use, but if you ship a commercial product, buy an enterprise license or use RT-DETR (Apache 2.0).

**How to use without training**:
```python
from ultralytics import YOLO
model = YOLO("yolov8x.pt")          # auto-downloads
results = model.predict(frame, conf=0.25, classes=[0, 67, 73, 84])  # person, cell phone, book, book
# 0=person, 67=cell phone, 73=book, 84=book, 75=vase
```

**Exam-hall application**: (a) Detect every person + every cell phone + every book. (b) Pair phones with their holder (nearest person bbox). (c) Trigger Grounding DINO only on frames where YOLO sees a "person holding object" to find paper chits/smartwatches/earbuds which COCO does not include. (d) Feed person crops to YOLOv8-Pose for skeleton extraction.

**Install**: `pip install ultralytics` (auto-pulls torch).

### 3.2 RT-DETR (COCO pretrained)

- **Description**: Real-Time DEtection Transformer (CVPR 2024, Baidu). Transformer-based detector that beats YOLOv8 on COCO while maintaining real-time speed; native NMS-free.
- **Repo**: https://github.com/lyuwenyu/RT-DETR
- **HuggingFace**: https://huggingface.co/PekingU/rtdetr_r50vd_coco_o365 (RT-DETR R50 pretrained on Objects365 + COCO), https://huggingface.co/PekingU/rtdetr_r18vd_coco_o365
- **License**: Apache 2.0 — preferred for commercial deployment
- **How to use without training**:
  ```python
  from transformers import RTDetrForObjectDetection, RTDetrImageProcessor
  proc = RTDetrImageProcessor.from_pretrained("PekingU/rtdetr_r50vd_coco_o365")
  model = RTDetrForObjectDetection.from_pretrained("PekingU/rtdetr_r50vd_coco_o365")
  inputs = proc(images=frame, return_tensors="pt")
  outputs = model(**inputs)
  results = proc.post_process_object_detection(outputs, target_sizes=[frame.shape[:2]], threshold=0.3)
  ```
- **Exam-hall application**: Drop-in replacement for YOLO when AGPL is unacceptable. Objects365 pretraining gives broader vocabulary (365 classes vs YOLO's 80) — sometimes catches "headphone", "laptop", "keyboard", "mouse" directly.
- **Latency**: ~5 ms/frame at 640px on RTX 4090 with TensorRT FP16 (R50).

### 3.3 Grounding DINO (open-vocab)

- **Description**: Marries DINO detector with text encoder (BERT) for open-set detection: prompt with arbitrary text queries ("mobile phone", "paper chit", "smartwatch", "earbud", "cheat sheet"). Achieves 52.5 AP zero-shot on COCO.
- **Repo**: https://github.com/IDEA-Research/GroundingDINO
- **HuggingFace weights**:
  - Tiny: https://huggingface.co/IDEA-Research/grounding-dino-tiny
  - Base: https://huggingface.co/IDEA-Research/grounding-dino-base
- **License**: Apache 2.0
- **How to use without training**:
  ```python
  from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
  proc = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-tiny")
  model = AutoModelForZeroShotObjectDetection.from_pretrained("IDEA-Research/grounding-dino-tiny")
  text = "cell phone . paper chit . smartwatch . earbud . cheat sheet ."
  inputs = proc(images=frame, text=text, return_tensors="pt")
  outputs = model(**inputs)
  results = proc.post_process_grounded_object_detection(outputs, threshold=0.3, text_threshold=0.25, target_sizes=[frame.shape[:2]])
  ```
- **Exam-hall application**: This is the single most important model for prohibited-item detection. Free-text prompts let us specify every prohibited item type without training. Combine with SAM2 for instant mask + detection.
- **Latency**: ~30 ms at 800x1333 on RTX 4090 (FP32); ~12 ms with TensorRT FP16.

### 3.4 OWLv2 (open-vocab)

- **Description**: Google's open-vocabulary detector. Scales up OWL-ViT with self-training on web image-text pairs. Takes one or more text queries per image.
- **HuggingFace weights**:
  - Base: https://huggingface.co/google/owlv2-base-patch16
  - Large: https://huggingface.co/google/owlv2-large-patch14
- **License**: Apache 2.0
- **How to use without training**:
  ```python
  from transformers import Owlv2Processor, Owlv2ForObjectDetection
  proc = Owlv2Processor.from_pretrained("google/owlv2-large-patch14")
  model = Owlv2ForObjectDetection.from_pretrained("google/owlv2-large-patch14")
  texts = [["a mobile phone", "a paper chit", "a smartwatch", "an earbud"]]
  inputs = proc(text=texts, images=frame, return_tensors="pt")
  outputs = model(**inputs)
  results = proc.post_process_object_detection(outputs=outputs, target_sizes=[frame.shape[:2]], threshold=0.1)
  ```
- **Exam-hall application**: Alternative to Grounding DINO. Useful for ensemble — if both agree, confidence is high; if they disagree, route to human reviewer.
- **Latency**: ~80 ms at 1008x1008 (large) on RTX 4090; ~30 ms (base).

### 3.5 SAM / SAM2 (Segment Anything)

- **Description**: Meta's promptable segmentation model. Given a point, box, or text prompt, produces a high-quality mask. SAM2 (July 2024) extends to video with memory, enabling object tracking through occlusion via mask propagation.
- **Repo**: https://github.com/facebookresearch/sam2
- **Checkpoints** (download links):
  - SAM2 Hiera-Tiny: https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_tiny.pt
  - SAM2 Hiera-Small: https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_small.pt
  - SAM2 Hiera-Base+: https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_base_plus.pt
  - SAM2 Hiera-Large: https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_large.pt
  - HuggingFace mirror: https://huggingface.co/facebook/sam2-hiera-large, https://huggingface.co/facebook/sam2-hiera-large-hf
- **License**: Apache 2.0
- **How to use without training** (HF transformers):
  ```python
  from transformers import Sam2Processor, Sam2Model
  from PIL import Image
  proc = Sam2Processor.from_pretrained("facebook/sam2-hiera-large-hf")
  model = Sam2Model.from_pretrained("facebook/sam2-hiera-large-hf")
  inputs = proc(images=Image.fromarray(frame), input_boxes=[[[x1,y1,x2,y2]]], return_tensors="pt")
  masks = model(**inputs).pred_masks
  ```
  For video, use the official `sam2_video_predictor` to propagate a single click across the whole video.
- **Exam-hall application**: (a) Take Grounding DINO's phone/chit box, prompt SAM2 to get a pixel-accurate mask (better for evidence cutouts). (b) Click once on a student's hand in frame N, SAM2 propagates the hand mask through 1000 frames — gives precise hand trajectory for STGCN input. (c) Mask-based redaction of bystander faces for privacy.
- **Latency**: Hiera-Tiny ~25 ms/image (320px); Hiera-Large ~150 ms/image; video mode ~40 ms/frame on RTX 4090.
- **Install**: `pip install git+https://github.com/facebookresearch/sam2.git` or `pip install ultralytics` (Ultralytics wraps SAM2).

### 3.6 FastSAM, MobileSAM (efficient)

- **Description**: Lightweight SAM variants. FastSAM is a CNN trained on 2% of SA-1B; MobileSAM is 7× smaller and 4× faster than FastSAM.
- **Repos**:
  - FastSAM: https://github.com/CASIA-IVA-Lab/FastSAM
  - MobileSAM: https://github.com/ChaoningZhang/MobileSAM
- **License**: AGPL-3.0 (FastSAM via ultralytics); Apache 2.0 (MobileSAM)
- **How to use without training**:
  ```python
  from ultralytics import FastSAM, FastSAMPrompt
  model = FastSAM('FastSAM-s.pt')                 # auto-download
  everything = model(frame, device='cuda', retina_masks=True, imgsz=640, conf=0.4, iou=0.9)
  prompt = FastSAMPrompt(frame, everything, results=everything).text_prompt(text='a cell phone on the desk')
  ```
- **Exam-hall application**: When GPU budget is tight (e.g., one RTX 4070 for an 8-camera setup), use FastSAM/MobileSAM for segmentation, keep SAM2-Large for evidence-quality cutouts only.
- **Latency**: FastSAM ~30 ms at 640px; MobileSAM ~10 ms on RTX 4070.

---

## 4. Pretrained Pose & Action Recognition

### 4.1 Pose Estimation

#### YOLOv8-Pose / YOLOv11-Pose (COCO 17-keypoint)
- **Repo**: https://github.com/ultralytics/ultralytics
- **Weights**: `yolov8n-pose.pt`, `yolov8s-pose.pt`, `yolov8m-pose.pt`, `yolov8l-pose.pt`, `yolov8x-pose.pt` (auto-download).
- **License**: AGPL-3.0
- **How to use without training**:
  ```python
  from ultralytics import YOLO
  pose = YOLO("yolov8s-pose.pt")
  results = pose.predict(frame)
  for kpts in results[0].keypoints.xy:    # 17 keypoints in COCO format
      ...
  ```
- **Exam-hall application**: Extract per-student 17-keypoint skeletons (nose, eyes, ears, shoulders, elbows, wrists, hips, knees, ankles) for STGCN input. Track wrists and eyes to detect "looking down at lap" or "hand under desk".
- **Latency**: YOLOv8s-pose ~12 ms at 640px on RTX 4070.

#### MediaPipe Holistic (Google)
- **Description**: 543-landmark model combining body (33), hands (21×2), and face (468) — runs on CPU/GPU.
- **Repo**: https://github.com/google/mediapipe
- **Docs**: https://developers.google.com/edge/mediapipe/solutions/vision/holistic_landmarker
- **License**: Apache 2.0
- **How to use without training**:
  ```python
  import mediapipe as mp
  holistic = mp.solutions.holistic.Holistic(static_image_mode=False, model_complexity=2)
  results = holistic.process(rgb_frame)
  results.pose_landmarks          # 33 landmarks
  results.left_hand_landmarks     # 21 landmarks
  results.right_hand_landmarks    # 21 landmarks
  results.face_landmarks          # 468 landmarks
  ```
- **Exam-hall application**: Hand keypoints (21 each) are critical — they reveal whether a student is passing a chit, holding a phone, or hiding something under the desk. Body-only models miss this. Runs on CPU at ~25 FPS for one person.
- **Install**: `pip install mediapipe`
- **Latency**: ~30 ms/frame (full holistic, 1 person, RTX 4070).

#### ViTPose / ViTPose++
- **Description**: Pure ViT pose estimator; SOTA on COCO (81.0 AP for ViTPose-H) and supports multi-dataset training (PoseTrack, AIC, MPII, AP-10K, APT-36K).
- **Repo**: https://github.com/ViTAE-Transformer/ViTPose
- **License**: MIT
- **How to use without training**: Download checkpoints from the ViTPose repo's Model Zoo; ViTPose provides Simple, Base, Large, Huge variants. Use via the MMPose config `configs/body_2d_keypoint/topdown_heatmap/coco/vitpose_coco.md`.
- **Exam-hall application**: Higher-precision keypoints than YOLOv8-Pose for the most ambiguous frames (occluded, low-light). Use as a "second opinion" pose estimator.
- **Latency**: ViTPose-B ~25 ms at 256x192 on RTX 4090; ViTPose-H ~120 ms.

#### MMPose model zoo
- **Repo**: https://github.com/open-mmlab/mmpose
- **Docs**: https://mmpose.readthedocs.io/en/latest/modelzoo.html
- **License**: Apache 2.0
- **How to use without training**: `pip install -U openmim && mim install mmpose mmengine mmcv mmdet`. Then `from mmpose.apis import init_model, inference_topdown; model = init_model(config, checkpoint, device)`.
- **Useful checkpoints**: HRNet-W32 (COCO, AP 74.4), RTMPose-S/m/l (COCO), ViTPose-* (COCO), RTMPose-Body8 (general). Direct download links at https://mmpose.readthedocs.io/en/latest/model_zoo/body2d.html
- **Exam-hall application**: Best pose toolbox — pick the model that fits your FPS budget; supports top-down (detector first, then pose per box) and bottom-up (single pass) inference.

### 4.2 STGCN + FFT (Pretrained Kinetics)

The user specifically asked about the STGCN+FFT angle. Here is how it works under the no-training constraint.

**Background.** The original STGCN (Yan, Xiong & Lin, AAAI 2018) models a skeleton sequence as a spatio-temporal graph and uses spectral graph convolutions. The convolution in the temporal axis is implemented as a 1-D convolution; equivalently, in the spectral (Fourier) domain, STGCN modulates the magnitude of different temporal frequencies. By inspecting the magnitude of activations in the FFT of STGCN's temporal conv layers, we can identify the dominant rhythmic frequency of an action — this is the "FFT analysis of activations" the user mentioned. The intuition: cheating behaviors like "texting under the desk" produce a characteristic ~2–4 Hz hand motion that stands out as a peak in the FFT of the temporal conv activations.

**Pretrained checkpoints (public, no training)**:
1. **Original STGCN** (Yan et al., AAAI 2018)
   - PyTorch repo: https://github.com/yysijie/st-gcn (MIT license)
   - Pretrained on Kinetics-400 (skeleton) and NTU-RGB+D. Checkpoints downloadable from the repo README.
   - Format: takes (T, V, C) skeleton tensor where T=frames, V=joints, C=coordinates.
2. **MMAction2 STGCN checkpoints**
   - Model zoo: https://mmaction2.readthedocs.io/en/latest/model_zoo/skeleton.html
   - Configs: `configs/skeleton/stgcn/` in the mmaction2 repo.
   - Pretrained on Kinetics-400-skeleton. Top-1 accuracy 31.5%, Top-5 54.7%.
3. **PyActit / Pyskl**
   - https://github.com/kennymckormick/pyskl — has STGCN, PoseC3D, MS-G3D pretrained on NTU-60, NTU-120, Kinetics-400-skeleton. License Apache 2.0.
4. **STGCN-PyTorch (s-shamil)**: https://github.com/s-shamil/ST-GCN-PyTorch — clean unofficial reimplementation with Kinetics weights.

**How to use without training**:
```python
# Step 1: Extract skeletons with YOLOv8-Pose for every person in the frame
from ultralytics import YOLO
pose = YOLO("yolov8s-pose.pt")

# Step 2: Build a (T=300, V=17, C=2) skeleton tensor per tracked student (5 seconds at 60 FPS, or 10 s at 30 FPS)
# Use ByteTrack IDs to associate skeletons across frames.

# Step 3: Load pretrained STGCN from MMAction2
from mmaction.apis import init_recognizer
config = 'configs/skeleton/stgcn/stgcn_8xb16-joint-u100-80e_kinetics400-skeleton.py'
checkpoint = 'https://download.openmmlab.com/mmaction/skeleton/stgcn/stgcn_8xb16-joint-u100-80e_kinetics400-skeleton/stgcn_8xb16-joint-u100-80e_kinetics400-skeleton_20220815-e2cd6ef2.pth'
model = init_recognizer(config, checkpoint, device='cuda:0')

# Step 4: Run inference — get class logits AND intermediate activations
result = inference_recognizer(model, skeleton_np)
# The 400 classes include many fine-grained actions like "texting message",
# "holding object", "looking at phone", "writing", "drinking", etc.

# Step 5: FFT analysis of the activations from the last temporal conv layer
import torch.fft
acts = model.backbone.layer7(x)            # (N, C, T, V) — shape may vary by reimpl
freq_mag = torch.fft.rfft(acts, dim=2).abs()    # magnitude spectrum along time
peak_freq = freq_mag.mean(dim=(0,3)).argmax(dim=1).item()  # dominant freq bin
# If peak_freq corresponds to 2-4 Hz and the action logit is "texting"/"holding phone",
# mark as suspicious cheating candidate.
```

**Why this works without training**: STGCN's pretrained weights on Kinetics-400 already encode action discriminability. The 400 classes include actions that overlap with cheating behaviors (`texting message`, `looking at phone`, `holding object`, `tapping pen`, `high-five`, `shaking hands`, `writing`). We use (a) the predicted class probabilities directly as features and (b) the FFT of the penultimate temporal conv activations as a "rhythmic signature" feature. These features feed into a classical anomaly detector (z-score / HDBSCAN / Bayesian change-point) — no labeled cheating data needed.

**License**: Apache 2.0 (MMAction2, Pyskl); MIT (original st-gcn repo).

### 4.3 Action Recognition (Kinetics pretrained)

Action recognition models classify a short clip (~2 s) into one of 400 (K400) / 600 (K600) / 700 (K700) Kinetics action classes. Run on crops around each tracked student.

#### SlowFast (FAIR)
- **Repo**: https://github.com/facebookresearch/SlowFast
- **PyTorch Hub**: https://pytorch.org/hub/facebookresearch_pytorchvideo_slowfast
- **Checkpoint**: SlowFast_R50_8x8 (Kinetics-400, Top-1 76.6%); SlowFast_R101_8x8 (K400, 77.8%); SlowFast_16x8_R101_50_50 (K600, 79.5%).
- **License**: Apache 2.0
- **How to use without training**: `import torch; model = torch.hub.load('facebookresearch/pytorchvideo', 'slowfast_r50', pretrained=True)`. Preprocess clip (32 frames @ 30 FPS, 224x224); run inference.
- **Exam-hall application**: classify a 2-s crop around each student per second. Classes of interest: "texting", "looking at phone", "drinking", "writing", "reading", "high five", "shaking hands", "whispering" (some appear in K600/K700). Logits feed into the anomaly aggregator.
- **Latency**: ~35 ms/clip on RTX 4090 (FP16); ~80 ms on RTX 4070.

#### X3D (efficient)
- **Repo**: https://github.com/facebookresearch/SlowFast (X3D family in PyTorchVideo)
- **Checkpoints**: X3D-XS, X3D-S, X3D-M, X3D-L — `https://pytorchvideo.readthedocs.io/en/latest/model_zoo.html`
- **License**: Apache 2.0
- **How to use without training**: `model = torch.hub.load('facebookresearch/pytorchvideo', 'x3d_m', pretrained=True)`.
- **Exam-hall application**: Lightweight action recognition on CPU/edge; ~2-3× faster than SlowFast at slight accuracy cost. Use for first-pass tagging; escalate ambiguous cases to SlowFast.
- **Latency**: X3D-S ~6 ms/clip on RTX 4070; X3D-M ~14 ms; X3D-L ~28 ms.

#### MoViNet (mobile)
- **Repo**: https://github.com/Atze00/MoViNet-pytorch (community port); official TF: https://github.com/tensorflow/models/tree/master/official/projects/movinet
- **Checkpoints**: MoViNet-A0/A1/A2/A3/A4 (Kinetics-600), auto-download via TF Hub.
- **License**: Apache 2.0
- **How to use without training**: Streaming action recognition — feeds frames one-by-one through a CNN+GRU, very memory-efficient.
- **Exam-hall application**: Stream-process multi-hour video without re-loading frames; ideal for long offline analyses.
- **Latency**: A0 ~2 ms/frame, A2 ~10 ms on RTX 4070.

#### VideoMAE V2 (SOTA, NeurIPS 2023)
- **Repo**: https://github.com/MCG-NJU/VideoMAE
- **HuggingFace**: https://huggingface.co/OpenGVLab/VideoMAEv2-Base, https://huggingface.co/OpenGVLab/VideoMAEv2-Large, https://huggingface.co/OpenGVLab/VideoMAEv2-Huge
- **Checkpoints**: ViT-Base, Large, Huge pretrained on Hybrid-1M (self-supervised) and fine-tuned on Kinetics 400/600/700 with SOTA accuracy (88.5% Top-1 on K400 with Huge).
- **License**: Apache 2.0 (code); CC-BY-NC 4.0 (some checkpoints — verify before commercial use)
- **How to use without training**:
  ```python
  from transformers import VideoMAEImageProcessor, VideoMAEForVideoClassification
  proc = VideoMAEImageProcessor.from_pretrained("MCG-NJU/videomae-base-finetuned-kinetics")
  model = VideoMAEForVideoClassification.from_pretrained("MCG-NJU/videomae-base-finetuned-kinetics")
  ```
  For VideoMAE V2 weights from OpenGVLab, use their repo's `videomaev2_vit_g_hybrid_k400` etc.
- **Exam-hall application**: Highest-accuracy action recognition; reserve for evidence-quality confirmation on flagged clips.
- **Latency**: VideoMAE-Base ~30 ms/clip on RTX 4090 (FP16); Huge ~120 ms.

#### TSN / TSM / MViT
- **TSN**: Temporal Segment Networks — MMAction2 has `configs/recognition/tsn/`, Kinetics-400 Top-1 70.6 (ResNet-50). Lightweight baseline.
- **TSM**: Temporal Shift Module — `pip install mmaction2`, ResNet-50 backbone, Kinetics-400 Top-1 74.7. Better than TSN at same FLOPs.
- **MViT**: Multiscale ViT — VideoMAE's main competitor. Available in PySlowFast (https://github.com/facebookresearch/SlowFast) and MMAction2; MViT-B 768-hidden K400 Top-1 82.1.
- **License**: Apache 2.0
- **Exam-hall application**: TSM is the sweet spot for many cameras (40 ms/clip, good accuracy).

---

## 5. Pretrained Optical Flow (Deep)

For motion quality that beats classical flow on real CCTV (compression artifacts, motion blur), use deep pretrained flow.

### RAFT (ECCV 2020)
- **Repo**: https://github.com/princeton-vl/RAFT
- **Torchvision weights**: `torchvision.models.optical_flow.raft_large(weights="Raft_Large_Weights.C_T_SKHT_V2")` (pretrained on FlyingChairs + FlyingThings3D + fine-tuned on Sintel + KITTI) and `raft_small` pretrained on FlyingThings3D.
- **HuggingFace mirror**: https://huggingface.co/opencv/optical_flow_estimation_raft
- **License**: BSD-3-Clause (Torchvision), MIT (original Princeton repo)
- **How to use without training**:
  ```python
  from torchvision.models.optical_flow import raft_large, Raft_Large_Weights
  model = raft_large(weights=Raft_Large_Weights.DEFAULT, progress=False).cuda().eval()
  weights = Raft_Large_Weights.DEFAULT
  transforms = weights.transforms()
  img1 = transforms(frame1).unsqueeze(0).cuda()
  img2 = transforms(frame2).unsqueeze(0).cuda()
  with torch.no_grad():
      flow = model(img1, img2)[-1]    # (1, 2, H, W)
  ```
- **Exam-hall application**: High-quality dense flow for motion heatmap and STGCN-FFT pre-filtering. Sub-pixel accuracy reveals micro-motion (e.g., a wrist rotating to look at a watch).
- **Latency**: ~35 ms at 480x640 on RTX 4070 (FP16); ~15 ms on RTX 4090.

### SEA-RAFT (ECCV 2024 Oral, Best Paper Candidate)
- **Repo**: https://github.com/princeton-vl/SEA-RAFT
- **HuggingFace**: https://huggingface.co/papers/2405.14793
- **Checkpoints**: `SEA-RAFT-s/` `SEA-RAFT-m/` `SEA-RAFT-l/` `SEA-RAFT-xl/` (download from the GitHub README, Google Drive links). Pretrained on FlyingThings3D + fine-tuned on Sintel/KITTI.
- **License**: MIT
- **How to use without training**: Clone repo, `python demo.py --model sea-raft-l --ckpt_path <downloaded.ckpt>`.
- **Exam-hall application**: SOTA flow accuracy at ~2× the speed of RAFT. Use when motion is subtle and classical Farneback misses it.
- **Latency**: SEA-RAFT-l ~12 ms at 480x640 on RTX 4090 (FP16).

### FlowFormer
- **Repo**: https://github.com/MegviiRobot/FlowFormer
- **License**: Apache 2.0
- **How to use without training**: Download provided checkpoints; FlowFormer-Large is SOTA on Sintel.
- **Exam-hall application**: Highest accuracy on hard cases (transparent objects, motion blur), but heavier than RAFT.

### GMFlow (CVPR 2022 Oral)
- **Repo**: https://github.com/haofeixu/gmflow
- **Checkpoints**: `pretrained/gmflow_sintel-0c1d2176.pth`, `gmflow_things.pth` etc. in repo.
- **License**: Apache 2.0
- **How to use without training**: `python main.py --inference_dir <frames> --output_dir <flow> --pretrained gmflow-things.pth`.
- **Exam-hall application**: Better at large displacements (e.g., a thrown object) than RAFT.

### UniMatch (TPAMI 2023)
- **Repo**: https://github.com/autonomousvision/unimatch
- **Checkpoints**: in `pretrained/` directory; one model handles flow + stereo + depth.
- **License**: Apache 2.0
- **Exam-hall application**: Single model for flow and depth (if depth is needed for cross-camera 3-D triangulation).

### PTLFlow (one-stop library)
- **Repo**: https://ptlflow.readthedocs.io
- **License**: MIT
- **How to use without training**: `pip install ptlflow`. Supports 40+ flow models with pretrained weights — RAFT, SEA-RAFT, FlowFormer, GMFlow, UniMatch, IRR, PWC-Net, etc. Use `ptlflow.get_model('raft_small', ckpt_path='things')`.

---

## 6. Pretrained Tracking & ReID

### ByteTrack (ECCV 2022)
- **Repo**: https://github.com/ifzhang/ByteTrack
- **License**: MIT
- **How to use without training**: Sort-style data-association tracker that uses low-confidence detections (the "second match"). No ReID model needed. Works out-of-the-box with any detector. Inside Ultralytics: `model.track(frame, tracker='bytetrack.yaml')`.
- **Exam-hall application**: Track every student across the entire video — assign each a stable ID. Use IDs to slice per-student action clips.
- **Latency**: <2 ms/frame on CPU.

### BoT-SORT (arXiv 2022, SOTA MOT)
- **Repo**: https://github.com/NirAharon/BoT-SORT
- **License**: MIT
- **How to use without training**: Combines ByteTrack + FastReID appearance features + camera-motion compensation. Inside Ultralytics: `model.track(frame, tracker='botsort.yaml')`.
- **Exam-hall application**: Best when students occlude each other (handoff of chits) — ReID keeps the ID stable through brief occlusion.
- **Latency**: ~6 ms/frame including ReID feature extraction (RTX 4070).

### OC-SORT (CVPR 2023)
- **Repo**: https://github.com/noahcao/OC_SORT
- **License**: MIT
- **How to use without training**: Pure motion-model tracker that fixes SORT's failure under occlusion; better than ByteTrack when IDs swap frequently.
- **Exam-hall application**: Better ID stability when camera is shaky (common in CCTV). Available in Ultralytics as `tracker='ocsort.yaml'` (or via the `supervision` package).

### StrongSORT
- **Repo**: https://github.com/dyhBUPT/StrongSORT
- **License**: MIT
- **How to use without training**: Adds appearance model (OSNet) and ECC camera motion compensation to DeepSORT. Useful when appearance is the dominant cue.

### OSNet (ReID)
- **Repo (torchreid)**: https://github.com/KaiyangZhou/deep-person-reid
- **Checkpoints**: OSNet-AIN x1.0 (Market-1501 mAP 87.1), OSNet-AIN x2.0 (MSMT17). All in the torchreid Model Zoo: https://kaiyangzhou.github.io/deep-person-reid/MODEL_ZOO
- **License**: MIT
- **How to use without training**: `pip install torchreid`; load pretrained model; extract 512-D features per crop; cosine-similarity match.
- **Exam-hall application**: Cross-camera ReID (student A in camera 1 = same student in camera 2). Also used to recover ID after long occlusion.

### FastReID (JD AI)
- **Repo**: https://github.com/JDAI-CV/fast-reid
- **License**: Apache 2.0
- **How to use without training**: Provides SOTA ReID backbones (bagoftricks, AGW, OSCNet). Pretrained on Market-1501, MSMT17, DukeMTMC. Used inside BoT-SORT.

---

## 7. Pretrained Anomaly Detection (Zero-Shot / Weakly Supervised)

This is the killer feature: detect cheating events without any labeled cheating videos. These models were trained on generic surveillance anomaly datasets (UCF-Crime, XD-Violence) but generalize because they use frozen CLIP/VLM features.

### VadCLIP (AAAI 2024)
- **Repo**: https://github.com/nwpu-zxr/VadCLIP
- **Paper**: https://arxiv.org/abs/2308.11681
- **License**: Apache 2.0
- **Description**: Dual-branch architecture: (a) a lightweight one-class classifier trained on video-level labels, (b) a frozen CLIP feature branch that retains semantic features. Together they produce frame-level anomaly scores in a weakly-supervised setting.
- **How to use without training (zero-shot variant)**: The repo provides pretrained weights. Run their `test.py` with `--model VadCLIP` to get frame-level anomaly scores for any input video. Their dual-branch architecture means even the untrained branch (CLIP features + visual prompts) is usable directly as an anomaly scorer. The CLIP branch is frozen — you can replace it with a different CLIP backbone if desired.
- **Exam-hall application**: Run VadCLIP on each per-student clip; the frame-level score pinpoints the exact second of suspicious behavior. The CLIP features carry semantics like "phone", "hand", "face" — directly relevant to cheating.
- **Pretrained weights**: Provided in the repo at `exps/` and via Google Drive links in the README.

### CLIP-TSA (CVPR 2023)
- **Repo**: https://github.com/Sultanic/CLIP-TSA
- **Paper**: https://arxiv.org/abs/2304.06026
- **License**: MIT
- **Description**: CLIP features + Temporal Self-Attention for VAD. Frozen CLIP backbone with a lightweight transformer head.
- **How to use without training**: Use their released checkpoint; CLIP is frozen. Inference outputs frame-level anomaly probabilities.
- **Exam-hall application**: Alternative to VadCLIP; useful for ensembling.

### Holmes-VAD (CVPR 2024)
- **Repo**: https://github.com/pipixin321/HolmesVAD
- **Project page**: https://holmesvad.github.io
- **License**: Apache 2.0
- **Description**: Permits an *interpretable* video anomaly detector — uses a Video-LLM to generate a natural-language explanation of the anomaly, not just a score. Built on the VAD-Instruct50k dataset.
- **How to use without training**: Download checkpoint from the repo; run `inference.py` to get (a) a frame-level anomaly score and (b) a free-text explanation of the anomaly.
- **Exam-hall application**: Directly produces a written rationale for each flagged event — saves human reviewer time and is more defensible (reviewer can read the AI's reasoning). E.g., "Student in row 3, column 5 lowers hand below desk and brings it back up holding a small rectangular object at 14:32"
