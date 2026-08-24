# OJAS — Objective Judgement for Academic Sincerity

**Offline exam-hall video analytics. Built for PS2 (DrishtiAI Hackathon).**

> **Positioning, stated first because it constrains every choice below:**
> this is an *investigation support tool*, not an automatic cheating detector.
> It ranks footage and evidences its claims; a human confirms or dismisses.
> Every abstention, every uncertainty band, every refusal to auto-apply a
> threshold in this codebase follows from that one sentence.

---

## 1. The problem, as an engineering constraint

An invigilator watches ~40 candidates live. A reviewer watching the recording
afterward watches one screen. At 800 centres × 4 cameras × 3 hours, that's
**9,600 camera-hours per exam session** — roughly 400 days of continuous
viewing for one person. Nobody watches all of it.

So the product isn't "detect cheating." It's **decide what the few available
reviewer-hours should be spent on, and evidence that decision well enough to
survive an appeal.** Everything downstream — hysteresis segmentation instead
of a single motion threshold, a reversible CLIP filter instead of silent
deletion, a calibration engine that refuses to propose a threshold when the
data doesn't support one — exists because a wrong, unappealable accusation
is a worse failure than a missed one.

---

## 2. Architecture

```
Raw video (MP4, offline, no cloud)
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│  Python — Modules 1-7 (classical CV, m1_7/)                │
│  metadata → frame sampling → motion ensemble → mask        │
│  cleanup → ROI extraction → quality analysis → hysteresis  │
│  event segmentation                                        │
│      → events.json, rois.json, quality.csv, clips/         │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│  Go — Modules 8-9 (m8_9_golang/)                            │
│  YOLOv8n person + object detection, ByteTrack-style         │
│  tracking with anonymized IDs, YOLOv8n-pose micro-motion    │
│  analysis (head turns, hand gestures, reach), CLIP          │
│  verification, region-baseline anomaly scoring              │
│      → enriched_events.json                                 │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│  Next.js — review surface + custody ledger                  │
│  Dashboard · timeline · event review · reviewer verdicts ·  │
│  threshold calibration · Ed25519-signed hash-chain ledger · │
│  signed PDF incident reports                                │
└───────────────────────────────────────────────────────────┘
```

**Why three stages instead of one monolith:** each stage has a different
cost/iteration profile. The Python CV modules are where thresholds get
tuned against real footage — fast to edit, no compile step, and OpenCV/NumPy
are the natural home for classical CV primitives (background subtraction,
optical flow, morphology, FFT). Detection needs a trained model (YOLO) that
has no mature Go binding, so Go bridges to a Python inference process over
stdin/stdout JSON rather than reimplementing inference — but the *rest* of
Module 8-9 (tracking, pose geometry, offence classification, region
anomaly scoring) is plain Go, compiled to a single static binary an exam
centre can run with no Python environment on that machine. The frontend is
Next.js because the review workflow — timelines, modals, verdict state,
report generation — is a UI problem, not a CV problem.

---

## 3. Pipeline, module by module — what it does and why

### Module 1 — Metadata (`m1_7/module1_metadata.py`)
Reads width/height via OpenCV (always reliable) and fps/duration/codec via
`ffprobe` (more reliable than OpenCV on variable-frame-rate video and modern
codecs like HEVC). Cross-checks the two; if they disagree by >2%, trusts
ffprobe and flags a warning so downstream timestamps are known to be
possibly off. **Why cross-check at all:** OpenCV alone silently gets frame
counts wrong on VFR footage, and a wrong frame count corrupts every
timestamp computed downstream — better to flag the disagreement than
propagate a quiet error into evidence.

### Module 2 — Frame sampling (`module2_frame_sampling.py`)
Reduces native 25-30fps to ~5fps. **Why:** nothing meaningful changes in an
exam hall in under 100ms; 5-10fps is enough to catch a hand reaching for a
phone, and cuts compute 3-6× versus native fps on hardware that has to run
this offline, in real time, on commodity CPUs.

### Module 3 — Motion detection ensemble (`module3_motion_detection.py`)
Three classical methods combined, not one:

| Method | Catches | Breaks on |
|---|---|---|
| Frame differencing (\|I_t − I_{t−k}\|) | Sudden motion, fast | Lighting flicker |
| Background subtraction (MOG2 + KNN) | Static-camera scenes | Camera shake |
| Dense optical flow (Farneback) | Slow, subtle motion | Nothing specific — the expensive fallback |

Weighted 0.35 / 0.35 / 0.30, each min-max normalized per video, combined
into `motion_score_combined`. **Why an ensemble instead of picking the best
one:** each method's failure mode is the other two's strength — a single
method would need a scene-specific tuning pass per exam hall, while the
combination degrades gracefully instead of failing hard on any one
condition (a hand-held phone, a shaking tripod, a slow lean).

**Jerk score — temporal spectral residual saliency.** Hou & Zhang's
Spectral Residual method (*"Saliency Detection: A Spectral Residual
Approach,"* CVPR 2007) is normally applied to a 2-D image spectrum; applied
here to the 1-D motion-score time series instead, it becomes a cheap FFT
pre-filter for sudden, non-periodic motion. One `O(n log n)` FFT pass over
the whole video's score array — no extra frame reads. Smooth or periodic
motion (walking, writing) is predictable in the spectrum and gets cancelled
out by the residual; abrupt one-off spikes (grabbing something, a sudden
head turn) are not, and stand out. **Why FFT and not a learned model for
this specific signal:** it needs zero training data, is fully deterministic,
and is purely additive — it tags events "sudden" vs "gradual" for a
reviewer's benefit without ever being able to change segmentation itself.
That last property made it safe to add without re-validating the whole
pipeline.

### Module 4 — Mask cleanup (`module4_mask_cleanup.py`)
Median blur → morphological open → morphological close on the raw motion
masks. **Why:** a background subtractor's raw output is salt-and-pepper
noise plus a person who reads as five disconnected blobs instead of one;
classical morphology is the textbook-correct, essentially free fix, and
doesn't need a model to learn what a blob-shaped-like-noise looks like.

### Module 5 — ROI extraction (`module5_roi_extraction.py`)
`connectedComponentsWithStats` → area/aspect-ratio filtering → transitive
union-find merge of overlapping or nearby boxes. **Why union-find merge:**
a person's motion often fragments into 2-3 adjacent components (arm, torso,
hand); merging transitively (A~B, B~C ⇒ A~B~C merge) turns that back into
one candidate region without hand-tuning per scene.

### Module 6 — Quality analysis (`module6_quality_analysis.py`)
Produces `Q_observability ∈ [0,1]` from:
- **Camera shake** — ORB keypoint matching + RANSAC affine estimation
  (measured at 89.6% of this module's runtime — the deliberate cost center,
  because shake is the single biggest source of false motion).
- **Blur** — Laplacian variance.
- **Brightness + brightness jump** — lighting-change detection.

Combined into one downstream formula:

```
S_final = S_evidence × Q_observability
```

**Why multiply instead of gating:** a shaky, blurry, badly-lit frame should
produce a *lower-confidence* event, not a suppressed one — multiplying
keeps the motion signal visible but discounted, rather than throwing away a
real event just because the camera jolted at the wrong moment. **Why ORB +
RANSAC specifically for shake:** it's the classical answer to "did the
whole scene move, or did something in the scene move" — feature matching
across frames plus a robust affine fit tells the two apart without a
learned model, and it's cheap enough to run per-frame on CPU.

### Module 7 — Event segmentation (`module7_event_segmentation.py`)
Hysteresis thresholding on `S_final`: **start** an event at ≥0.20, **keep it
alive** down to ≥0.10, **end** it below 0.10. Then: drop events shorter
than 1.5s (noise spikes), merge events with gaps ≤2.0s, pad ±3.0s for
context, re-merge anything padding pushed into overlap.

**Why two thresholds instead of one:** a single threshold flickers on/off
right at the boundary — a real event gets chopped into five fake ones every
time the score dips a hair below the line. A higher bar to *start* than to
*continue* is the standard fix, and it's the difference between "one 40s
event" and "eleven 2s events" on real footage.

### Module 10 — Hall-specific normality (`module10_region_baseline.py`)
A fixed global motion threshold doesn't generalize across halls: what's "a
lot of movement" in a cramped, bright room is noise in a wide, dim one.
This partitions the frame into a 4×3 grid, learns each cell's own mean and
standard deviation from the opening of the recording, and scores every
frame as a per-cell z-score deviation from *that cell's own* baseline.
**Why advisory-only, never gating:** it annotates offences with "how
unusual for this part of this room," it never creates or suppresses one —
a z-score says the pixels moved unusually, not that a person cheated, and
letting a purely statistical module silently gate real offences would be
exactly the kind of unappealable, unexplainable decision this whole system
is built to avoid.

---

## 4. Detection & tracking (Go, `m8_9_golang/`)

**YOLOv8n** (person/object detection) and **YOLOv8n-pose** (17 COCO
keypoints) run in a Python subprocess, bridged to Go over stdin/stdout JSON
(`yolo_python_bridge.go`). A ByteTrack-style IOU tracker (`detector.go`,
IOU threshold 0.3, max age 30 frames) assigns one anonymized track ID per
person for the whole video — not per event — so a person seen in two
separate events keeps one ID instead of being renumbered from scratch each
time, which previously made cross-event comparison meaningless.

**No facial recognition, no identity mapping.** Track IDs are anonymized
integers; the system was deliberately kept from ever knowing *who* a
candidate is, only *which tracked body* an offence belongs to.

### Object-level offences (`processor.go`)
`prohibited_object` (phone/paper/laptop), `object_exchange` (proximity
heuristic between two tracks and a detected object — explicitly documented
as *not* a verified hand-to-hand observation), `loitering`, `crowd
disturbance`.

### Pose-based micro-motion offences (`pose_analysis.go`)
Bounding boxes say *where* a person is, never *which way they're facing* or
*where their hands are* — head turns, signalling, reaching toward a
neighbour are invisible to box-only detection. These are derived from the
17 pose keypoints, with two properties of real CCTV footage shaping every
threshold:

- **Joint confidence varies enormously.** Seated candidates: upper body
  keypoints are dependable (shoulders/nose often >0.9 confidence), legs are
  noise (ankles ~0.03) because desks occlude them. Every measurement gates
  on the confidence of the specific joints it needs.
- **Scale varies with camera distance.** All thresholds are expressed as
  *ratios of the person's own shoulder width* — `headTurnMaxLocomotion =
  2.0` shoulder-widths, not pixels — so someone at the back of the hall is
  measured the same way as someone at the front.

`detectHeadTurns` requires the turn to persist ≥5 consecutive sampled
frames (~0.8-1.0s) **and** rejects the event if the subject also traveled
more than 2 shoulder-widths during it — a real head-turn-to-glance-at-a-
neighbour is stationary; someone getting up and moving is not a head turn,
whatever the yaw angle says.

*A documented example of the rigor this required in practice:* the
minimum-frame requirement was originally 2 frames, commented as "~0.4s at
5fps" — arithmetic that was simply wrong (two frames span one interval,
0.2s, not two). On real footage this fired on a seated subject 44px wide,
facing their own monitor, flagged for a "sustained" 0.2s turn that was pose
jitter. Fixed to 5 frames (~0.8-1.0s) with the locomotion gate added at the
same time. `detectHandGestures`, by contrast, still fires on a *single*
frame with no minimum duration and no locomotion gate — diagnosed as the
same class of bug, not yet fixed, and tracked honestly in
`evaluation/ground_truth.json` rather than silently left in place.

---

## 5. Verification layer — CLIP (`m1_7/clip_verify.py`)

The geometric detectors answer "did a measurement cross a threshold." They
cannot answer "does this actually look like the thing we're claiming."
Reviewing stills by eye surfaced exactly that gap: a raised wrist that was
a man resting his head on his hand; a head-yaw change that was someone
leaning over their own desk. Both are unmistakable to a human eye and
invisible to geometry alone.

CLIP (`openai/clip-vit-base-patch32`) scores the cropped subject against
candidate captions — **run entirely locally**, no API token, no rate limit,
no network dependency, and deterministic, which matters because the same
still has to produce the same verdict on demo day as it did in testing.

Two limits enforced rather than hoped for:
- The subject is cropped out before scoring — sent a whole exam hall, CLIP
  describes the room, not the person in question.
- Crops below a minimum size are marked **`unjudgeable`**, not scored. At
  ~60px tall, no model can resolve head direction reliably; returning a
  confident verdict there would launder a guess into evidence.

Only **`contradicted`** findings get suppressed from the reviewer's default
view — **`unjudgeable`** never is, because "the model can't tell" must not
read as "the model denies it." A suppressed finding is *marked, never
deleted* — it keeps its caption and score, so a wrong suppression is
visible and reversible. That asymmetry is deliberate: a filter that
silently erases evidence about a student is the one failure mode worth
engineering against, because nobody can review what they can't see.

---

## 6. Why classical CV first, and deep learning only where it earns its place

This system is **hybrid, not classical-only** — YOLO and CLIP are both
deep models, and both are load-bearing. The choice being defended here is
*which* stages use which tool, and it comes down to three constraints:

1. **Offline, air-gapped, CPU-only.** Exam centres have no GPU and no
   internet guarantee. Classical CV (background subtraction, optical flow,
   morphology, FFT) runs fast on commodity CPU with no model weights to
   ship or version. A model is only reached for when the question
   structurally requires one.
2. **Explainability that survives an appeal.** Every claim in this system
   traces to a frame index, a bounding box, and a specific measured
   number — a Laplacian variance, a shoulder-width ratio, a spectral
   residual peak. An accusation has to be defensible to a human who wasn't
   in the room; "the model felt it was suspicious" is not that, however
   good a black-box model's raw accuracy might be.
3. **The classical method is often just the correct tool.** Background
   subtraction on a static exam-hall camera is a solved problem from 2004;
   it doesn't need a neural net, and using one there would only add
   latency and an unexplainable failure mode for no accuracy gain.

Deep learning shows up exactly where geometry can't answer the question:
**YOLOv8n / YOLOv8n-pose** for "what is this object, what is this person's
pose" (no classical method identifies "cell phone" from pixels), and
**CLIP** for "does this image actually look like what we're claiming" (a
semantic check no threshold-based geometry can perform). Both are the
minimum model needed for a question classical CV cannot answer — not a
default reached for out of convenience.

### Why not an LLM/VLM for the judgment itself
Determinism and non-fabrication. An LLM call over a still or a transcript
is not reproducible in the way this system needs — the same evidence has
to produce the same verdict every time it's re-run, and "the model said it
looked suspicious" carries no audit trail back to a measurable quantity.
Concretely in this codebase: a VLM is never allowed to appear as detector
output. If a reviewer manually adds a finding based on a VLM read, it's
tagged `source: "manual_review"` with `confidence: 0.0` and a visible
"added on review" badge — clearly separated from anything the pipeline
itself measured, on purpose, so the two kinds of claim are never
indistinguishable in the record.

---

## 7. Being honest about detector quality

Measured on 3 clips / 431s / 8 detections / 6 known real events
(`evaluation/score.py`, `evaluation/ground_truth.json`):

```
precision  0.143   (1 of 7 adjudicated findings were real)
recall     0.167   (1 of 6 known real events were caught)
F1         0.154

accuracy             0.9974
do-nothing baseline  0.9986   ← flagging NOTHING scores this
balanced accuracy    0.583
```

**Accuracy is not quoted as a result anywhere in this product**, because it
can't be — under 0.14% base-rate class imbalance (real events are ~6 of
4,310 person-seconds observed), a detector that flags *nothing at all*
scores higher on accuracy than this one does. Precision and recall are the
only honest numbers here, and they say the detectors are early-stage: high
false-positive rate, low recall on real events.

This is exactly why the product doesn't auto-flag anything. Every finding
goes to a human reviewer first (`confirmed` / `dismissed`), and the
**calibration engine** (`lib/calibration.ts`) only *proposes* a confidence
threshold per detector type when there's measurable separability (AUC)
between confirmed and dismissed verdicts for that detector — and explicitly
refuses to propose one when there isn't, because moving a threshold when
the score doesn't actually separate the two classes trades real detections
for noise reduction, not the other way around. "No threshold helps here"
is treated as a valid, useful answer, not a failure to report one.

---

## 8. Chain of custody

Every artifact — upload, derived clip, reviewer verdict, generated report,
media pruning/deletion — is written to an append-only ledger
(`lib/ledger/`): a SHA-256 hash chain plus Ed25519 signatures, backed by
Postgres advisory locks and append-only triggers (not row-level security —
the service role bypasses RLS, so the guarantee has to be structural, not
policy-based).

**Signature and chain position are deliberately independent properties.**
The signature covers only the statement (who asserted what); the chain
covers only ordering (`seq` + `prev_hash` + statement hash — that nothing
was removed). If the signature also covered chain position, signing would
have to happen *after* the database assigned that position, and the
database must never hold the private key. Splitting them removes that
circularity and keeps both properties independently checkable — a verifier
years from now, possibly not this codebase at all, can check the chain and
the signatures separately without needing to trust anything about how they
were combined.

Hashing uses canonical JSON (sorted keys, no insignificant whitespace) so
two objects equal in every way that matters serialize identically — the
single most common way hash chains break in practice is exactly this kind
of key-order drift, not a real tampering event.

---

## 9. Evidence grouping

Four isolated clips are weaker evidence than one framed pattern: "this
person had 4 related incidents around the same desk." Events are linked
into a similarity graph (shared track IDs, ROI overlap) and grouped by
connected component (`lib/evidenceGraph.ts`), so related incidents present
together instead of as disconnected findings a reviewer has to mentally
reassemble. Purely a presentation layer — reads fields the Go backend
already emits, recomputes nothing, mutates no event.

---

## 10. Reporting

`POST /api/report` assembles the full incident document as JSON and
records its hash in the ledger. An n8n workflow (`n8n/`) renders it to HTML
and mails it via SMTP; `/api/report/pdf` renders a signed PDF directly via
Puppeteer driving a locally-installed Chrome — no headless Chromium
download, no network dependency at render time.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Classical CV | Python 3 + OpenCV + NumPy | Fastest iteration surface for tuning thresholds against real footage; native home for FFT/morphology/optical flow |
| Detection & tracking | Go 1.21 | Single static binary, no runtime dependency at the exam centre; real concurrency for the per-frame loop |
| Object/pose detection | YOLOv8n, YOLOv8n-pose (ultralytics) | Only where classical CV structurally can't answer "what is this" |
| Semantic verification | CLIP (ViT-B/32), local inference | Deterministic, offline, answers "does this look right" — a check no threshold can perform |
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind | Review UI is a state/UX problem, not a CV problem |
| Data | Supabase/Postgres | Advisory locks + append-only triggers for the ledger's structural guarantees |
| Reporting | n8n + Puppeteer-core | Local workflow automation and PDF rendering with no cloud rendering dependency |

---

## Quick start

### 1. Python pipeline (Modules 1-7, 10)
```bash
cd m1_7
pip install opencv-python numpy
python run_pipeline.py path/to/video.mp4 --out-dir pipeline_out/video
```
Output: `pipeline_out/video/events/events.json`, ROIs, quality/motion CSVs, clips, heatmap.

### 2. Go backend (Modules 8-9)
```bash
cd m8_9_golang
go mod download
go build -o drishti-backend
./drishti-backend \
    --events-json ../m1_7/pipeline_out/video/events/events.json \
    --rois-json ../m1_7/pipeline_out/video/rois/rois_per_frame.json \
    --header-json ../m1_7/pipeline_out/video/header.json \
    --frames-dir ../m1_7/pipeline_out/video/frames \
    --out-dir ./output
```
Output: `output/enriched_events.json`.

### 3. Frontend
```bash
npm install
cp .env.example .env.local   # fill in Supabase + ledger signing key
npm run dev
# http://localhost:3000
```
See `.env.example` for every environment variable and why each one exists
(most are optional — the app degrades explicitly rather than failing
silently when one is missing, e.g. no signing key means entries still
chain and stay tamper-evident, they just carry no provenance signature).

### 4. Evaluate detector quality
```bash
python evaluation/score.py
```
Reprints the precision/recall/accuracy table above against
`evaluation/ground_truth.json`.

---

## Project structure

```
m1_7/                    Python pipeline (Modules 1-7, 10)
  module1_metadata.py
  module2_frame_sampling.py
  module3_motion_detection.py
  module4_mask_cleanup.py
  module5_roi_extraction.py
  module6_quality_analysis.py
  module7_event_segmentation.py
  module10_region_baseline.py
  clip_verify.py         CLIP semantic verification
  run_pipeline.py          End-to-end orchestrator

m8_9_golang/              Go backend (Modules 8-9)
  detector.go              YOLO wrapper + ByteTrack-style tracker
  pose_analysis.go         Micro-motion offence detection from pose
  processor.go             Event enrichment, offence classification
  region_baseline.go       Consumes Module 10's per-region baselines
  yolo_python_bridge.go    stdin/stdout JSON bridge to Python YOLO
  annotator.go             Draws detection boxes on evidence stills

app/                       Next.js App Router
  api/                      Pipeline trigger, offences, ledger, report, etc.
components/                 Dashboard, VideoAnalysis, EventDetail, LedgerView, ...
lib/                        Ledger (hash/chain/merkle), calibration, evidence graph
evaluation/                 score.py + ground_truth.json — honest detector metrics
n8n/                        Report delivery workflow
supabase/migrations/        Schema + ledger append-only constraints
```

---

## Known limitations (stated, not hidden)

- **Detector precision/recall is early-stage** (§7) — this is a working
  pipeline with honest metrics, not a claim of production-grade accuracy.
- **`detectHandGestures` lacks the locomotion gate and minimum-duration
  filter** that `detectHeadTurns` has — diagnosed, not yet fixed
  (`evaluation/ground_truth.json` → `_root_cause_found`).
- **`object_exchange` is a proximity heuristic**, explicitly not a verified
  hand-to-hand observation — treated as lower-confidence evidence in the UI.
- **No facial recognition or identity mapping** — by design, not by gap.
