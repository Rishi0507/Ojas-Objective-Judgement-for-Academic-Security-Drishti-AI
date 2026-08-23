# DrishtiAI — Product & Technical Reference

Offline video analytics for exam-hall integrity. Built for PS2 (DrishtiAI), targeted at
CBT operators running exams across many centres.

> **Positioning, stated first because it constrains everything below:**
> an *investigation support tool*, not an automatic cheating detector.
> The system ranks and evidences; a human decides. Every design choice
> that follows — the abstentions, the uncertainty bands, the refusal to
> auto-tune — follows from that sentence.

All figures marked **[M]** are measured on this build. Figures marked **[P]** are
projections and are labelled as such.

---

## 1. Idea & Implementation

### The problem, restated as an engineering constraint

An invigilator watches ~40 candidates. A reviewer watching recordings afterwards watches
one screen. At 800 centres × 4 cameras × 3 hours that is **9,600 camera-hours per exam
session** — roughly **400 days of continuous viewing** for one person. Nobody watches it.
So the product is not "detect cheating"; it is **decide what the few available reviewer-hours
should be spent on**, and evidence that decision well enough to survive an appeal.

### What it does

| Stage | Output |
|---|---|
| Ingest | Metadata, sampled frames (5 fps target, 640 px max width) |
| Motion | 3-method ensemble → per-frame score |
| Quality | Shake / blur / brightness → `Q_observability` |
| Segment | Hysteresis thresholding → discrete events with clips |
| Detect | Persons, prohibited objects, pose-based behaviours |
| Explain | Every claim bound to frame + box + track |
| Review | Confirm / dismiss, stored per reviewer |
| Operate | Per-camera drift, threshold proposals, reports |

### The scoring idea that differentiates it

```
S_final = S_evidence × Q_observability
```

Motion evidence is discounted by how trustworthy the footage was at that moment. A strong
signal from a shaking, blurry, badly-lit camera scores below a moderate signal from a clean
one. **[M]** On the reference clip, `Q_observability` ranges **0.60–0.86** across four events — a
1.42× spread. Its effect is visible in the ranking: event-1 leads on raw motion (0.66) but its
poor observability (0.60) pulls it to 0.40, while event-4 at 0.57 motion and 0.63 observability
lands at 0.36 — the gap narrows from 0.09 to 0.04 once trustworthiness is priced in.

`Q_observability = 1 − mean(shake_penalty, blur_penalty, brightness_jump_penalty)`,
each normalised per-video by 5th/95th percentile.

### Reference run — measured end to end **[M]**

| | |
|---|---|
| Source | 143.1 s CCTV, 640×480, 8 fps, exam hall, ~6 candidates |
| Frames sampled | 573 (≈4 fps effective) |
| Events segmented | 4 |
| Findings | 18 — 7 hand gesture, 6 head turn, 3 motion anomaly, 1 prohibited object, 1 hand proximity |
| Grounded explanations | 22 |
| Evidence stills | 214 |
| Clips generated | 6 (4 plain + 2 annotated) |
| Prohibited object | `book 0.49` — verified by eye on actual papers |

---

## 2. Technical Approach, System Design & Tech Stack

### Architecture

```
video ──► Python (Modules 1–7) ──► events.json ──► Go (Modules 8–9) ──► enriched_events.json
             motion · ROI · quality           persons · objects · pose        │
             segmentation · clips             offences · explanations         │
                                                                              ▼
                                              Next.js API ──► React UI ──► Reviewer
                                                    │
                                                    ├─► Supabase (Postgres + Storage)
                                                    └─► n8n (reports, alerts, email)
```

**Why three languages, deliberately:**

| Layer | Language | Reason |
|---|---|---|
| Modules 1–7 | Python | OpenCV/NumPy are the reference implementations for classical CV |
| Modules 8–9 | Go | Long-running detection over thousands of frames; static binary, predictable memory, trivial deployment to 800 sites |
| API + UI | TypeScript / Next.js | One language across API routes and React; server components remove a separate API server |
| Inference | Python subprocess | Ultralytics is Python-only; Go drives it over a JSON-line protocol on stdin/stdout |

### Tech stack

| Concern | Choice | Version / size |
|---|---|---|
| CV primitives | OpenCV, NumPy | — |
| Detection | YOLOv8n (COCO) | 6.5 MB **[M]** |
| Pose | YOLOv8n-pose (17 COCO keypoints) | 6.8 MB **[M]** |
| Semantic check | CLIP ViT-B/32 | ~600 MB, local, deterministic |
| Tracking | ByteTrack (BoTSORT available) | — |
| Backend | Go 1.21, CGO-free static binary | — |
| App | Next.js 14 (App Router), React 18, Tailwind | — |
| Data | Supabase — Postgres + private Storage buckets | — |
| Auth | Google OAuth via Supabase, RLS per user | — |
| Automation | n8n (self-hosted) | See §4 |

**Codebase [M]:** ~18,600 lines — TypeScript 8,942 · Python 5,527 · Go 4,161.

### Design decisions worth defending

**Filesystem is the source of truth; Postgres is a mirror.**
Every Supabase write is awaited but never thrown. A database outage degrades the system to
local-only rather than failing a 15-minute analysis that already succeeded. At 800 sites with
variable connectivity this is the difference between "results arrive late" and "results are lost".

**Detection never self-tunes.**
Thresholds are named constants in Go with their derivation in comments. The calibration agent
*proposes*; a human commits. A detector that silently retuned itself from review data would make
every subsequent verdict a judgement of a different system, with the drift invisible in the output.

**Abstention is a first-class result.**
Four separate components return "I cannot answer this" rather than guessing:
CLIP marks crops under a minimum size **unjudgeable**; the threshold agent refuses when
separability < 0.65; drift detection returns **not comparable** on a grid mismatch; uncertainty
reports **unavailable** for factors the pipeline does not compute. For evidence used in
disciplinary proceedings, a wrong confident answer costs more than no answer.

**Everything shown is traceable.**
Each finding carries `event_id`, `timestamp`, `track_id`, `roi`, `object_bbox`,
`supporting_frame_urls`, `uncertainty_reason`. Enforced by a Go test, not convention.

**Anonymised identity only.** `Track-01`, `Track-02`. No facial recognition, no
re-identification across videos. This is both an ethical commitment and the PS's own
Data Security risk factor.

---

## 3. Scalability

### The honest arithmetic **[M] measured, [P] projected**

| | |
|---|---|
| Measured throughput **[M]** | 143.1 s footage → 18 min wall clock = **7.5× slower than realtime** |
| Target load **[P]** | 800 centres × 4 cameras × 3 h = **9,600 camera-hours / session** |
| Naive compute **[P]** | 72,450 compute-hours = **~24,150 machines** for one exam day |

That number is why the architecture is what it is. Three multiplicative reductions:

| Optimisation | Effect | Status |
|---|---|---|
| Frame sampling 25→5 fps | 5× fewer frames | Shipped |
| Downscale to 640 px wide | 4× fewer pixels (720p→640) | Shipped |
| Camera-shake + motion subsampling | **−33% runtime** | Shipped |
| Coarse-to-fine (only analyse flagged windows) | **−37% on reference footage [M]** | Pass 1 shipped, pass 2 manual |

**[M]** Coarse scan: 143 s video scanned in **1.7 s** (≈84× realtime), producing 3 windows
covering 63% of the clip. Threshold auto-calibrated to **p75 = 0.052** of that video's own
activity distribution.

**[P] Projected fleet compute**, applying coarse-to-fine at the observed 37% saving and again
at an optimistic 10%-flagged case:

| Scenario | Compute-hours / session | Machines |
|---|---|---|
| No optimisation | 72,450 | 24,150 |
| Coarse-to-fine at 63% flagged **[M]** | 45,650 | 15,220 |
| Coarse-to-fine at 10% flagged **[P]** | 7,245 | 2,415 |

The remaining gap is closed by horizontal scale, not algorithmic work: processing is
embarrassingly parallel per camera, and the Go binary is static with no runtime dependencies.

### Per-centre calibration — why one threshold cannot serve 800 halls

**[M]** Within a *single* frame of the reference footage, per-region motion baselines span
**σ = 0.001 to σ = 1.52 — a 1,500× range**. A doorway and a back wall in the same room cannot
share a threshold, let alone 800 different rooms.

Each camera therefore learns its own normal across sessions, and new sessions are compared
against it. **[M]** 12 regions tracked, 200 anomalous region-frames out of 573.

**Drift verdicts:** `ready` · `room looks different` · `camera moved` · `needs re-setup` · `still learning`.
Distinguishing "camera moved" from "room changed" requires ≥50% of regions shifting **and**
≥3 regions corroborating — one cell moving on a coarse grid is not evidence the frame shifted.

**[M]** Fleet view tested at **3,201 cameras**: API responds in **186 ms**; storage is
**4.5 MB** for 3,200 profiles; UI capped at 30 centres / 100 rows
(**42,759 → 1,532 DOM nodes**, 200,007 px → 8,813 px page height).

> **Note for any demo:** of those 3,201 cameras, **2 are real** and 3,199 are seeded test data
> (`scripts/seed_fleet.mjs`, marked `synthetic: true`). The *logic* is real on both.

### Storage projection **[P]**

Per camera-hour: ~4 MB playback proxy + ~2 MB clips + ~1 MB stills ≈ **7 MB**.
9,600 camera-hours ≈ **67 GB / session**. Postgres rows are negligible (~3,200 profile rows
= 4.5 MB). Storage, not compute, is the recurring cost after the first optimisation pass.

---

## 4. n8n Automation — Reports & Email

n8n is the operations layer: everything that must happen *on a schedule* or *in reaction to*
a pipeline result, without a human in the loop.

### Workflow A — Nightly investigation report

**Trigger:** Schedule, 22:00 daily (after exam sessions close).

| # | Node | Configuration |
|---|---|---|
| 1 | Schedule Trigger | Cron `0 22 * * *` |
| 2 | HTTP Request | `GET {APP}/api/video` — active videos + event counts |
| 3 | HTTP Request | `GET {APP}/api/events?mode=all_unusual` — findings ranked |
| 4 | HTTP Request | `GET {APP}/api/calibration` — threshold proposals |
| 5 | Code (JS) | Aggregate: totals by type, confirmed/dismissed split, top-5 by score |
| 6 | IF | `findings > 0` → continue; else → send "clean session" summary |
| 7 | HTML | Render report — summary table, top findings with evidence links |
| 8 | Convert to File | HTML → PDF |
| 9 | Supabase | Insert row into `reports` (custody ledger entry) |
| 10 | Gmail / SMTP | Email to reviewer distribution list, PDF attached |

**Report contents:** session totals; findings by type; top 5 by profile score with thumbnail +
deep link; cameras needing attention; any threshold proposals; explicit
*"N findings unreviewed"* count.

### Workflow B — Camera health alert (pre-exam)

**Trigger:** Schedule, 07:00 on exam days.

| # | Node | Configuration |
|---|---|---|
| 1 | Schedule Trigger | Cron `0 7 * * *` |
| 2 | HTTP Request | `GET {APP}/api/centres` |
| 3 | Code | Filter `verdict != 'stable'`, group by centre |
| 4 | IF | Any problems? |
| 5 | Split In Batches | One email per centre, so each site gets only its own list |
| 6 | Gmail / SMTP | To centre coordinator: which camera, what changed, what to do |
| 7 | Slack / Teams | Aggregate summary to ops channel |

**[M]** On the seeded fleet this routes **394 cameras across ~300 centres** into per-centre
emails — the difference between one unreadable 394-row alert and 300 actionable two-line ones.

### Workflow C — Processing-complete notification

**Trigger:** Webhook, called by `pipelineJobs.ts` on job completion.

| # | Node | Configuration |
|---|---|---|
| 1 | Webhook | `POST /webhook/job-complete` — `{jobId, eventCount, findings}` |
| 2 | IF | High-priority findings present? |
| 3 | Gmail / SMTP | Immediate notice with direct link to the segment |
| 4 | Supabase | Append to custody ledger |

### Workflow D — Weekly calibration digest

**Trigger:** Schedule, Monday 09:00.
Pulls `/api/calibration`, emails any detector whose verdicts now justify a threshold change,
including the evidence (separability, sample count, expected effect). **Proposals only** —
the email asks a human to approve a commit; n8n never edits thresholds.

### Why n8n rather than cron scripts

Visual workflows are auditable by non-engineers — an exam operations manager can see exactly
what triggers an email and to whom, which matters when the emails concern disciplinary
evidence. Retries, error branches and credential storage come built in.

**Security note:** n8n workflows execute actions. The instance driving this holds an API key
scoped to read endpoints plus report insertion — not the Supabase service role.

---

## 5. Trade-offs (and why each is the right call)

**Classical CV before deep learning.**
Motion detection is frame-diff + MOG2/KNN + Farneback optical flow, not a learned detector.
Slower per frame than an end-to-end model, but requires **zero training data**, runs offline
on commodity hardware at 800 sites, and every score is explainable to a disciplinary panel.
A neural motion model would be faster and unauditable.

**Abstention over coverage.**
The system deliberately says "cannot judge" — CLIP on crops below the size threshold, threshold
proposals below separability 0.65, drift on grid mismatch. This lowers headline recall and
raises trust: an evidence tool that is confidently wrong once loses more than one that is
silent occasionally.

**Propose, never auto-apply.**
Thresholds could self-tune from reviewer feedback. Keeping a human in that loop costs
adaptation speed and buys a system whose behaviour on any date is reconstructable from git
history — a hard requirement when findings are contested months later.

**Filesystem-first, database-second.**
Adds a sync layer and a class of "local ahead of remote" states. In exchange, a centre with
flaky connectivity still produces complete, reviewable results, and no analysis is ever lost
to a network partition.

**Per-video normalisation over global thresholds.**
Every score is normalised against that video's own distribution, so results are not directly
comparable between videos without the profile. That is the price of working across 800 halls
with different cameras, lighting and geometry — and the fleet profiles restore comparability
where it matters.

**Private storage with signed URLs.**
Slower than public CDN delivery and requires URL refresh. This is identifiable footage of
minors in some jurisdictions; a leaked path must not be a leaked recording.

**Anonymised IDs only.**
Refusing cross-video re-identification loses the ability to link a person across sessions —
genuinely useful for detecting organised, repeated behaviour. It is refused anyway, because
building the capability creates the risk regardless of policy.

---

## 6. Graphs & Visuals to Include

Ordered by argumentative value. Each entry states the data source so nothing is invented.

| # | Graph | Type | Data source | What it proves |
|---|---|---|---|---|
| 1 | **Compute wall & the three optimisations** | Waterfall / stacked bar | §3 table | 24,150 → 2,415 machines. The scalability argument in one image |
| 2 | **Evidence × Observability** | Grouped bars + product line, 4 events | `motionScore`, `observability` per event | The headline differentiator. event-1 `0.66 × 0.60 = 0.40`; event-2 `0.33 × 0.86 = 0.28` |
| 3 | **Per-region σ spread** | Log-scale bar, 12 regions | `region_baselines.json` | 0.001 → 1.52. Why one global threshold cannot work |
| 4 | **Activity timeline + detected events** | Line + shaded event bands | `motion.csv`, `events.json` | Segmentation lands on real motion |
| 5 | **Motion heatmap** | Image overlay | `events/heatmap.png` | Instantly legible; shows where activity concentrated |
| 6 | **Fleet health** | Horizontal stacked bar | `/api/centres` | 2,806 ready / 233 room changed / 96 moved / 65 re-setup |
| 7 | **Findings by type** | Bar | `enriched_events.json` | 7 gesture, 6 head turn, 3 motion, 1 object, 1 proximity |
| 8 | **Coarse-scan coverage** | Timeline strip, flagged vs skipped | `quick_scan.py --json` | 63% flagged, 37% skipped, scan in 1.7 s |
| 9 | **False-proposal risk vs sample size** | Line, log-y | Computed table (n=4→16.7%, n=10→0.4%) | Why the calibration agent refuses below 10 samples |
| 10 | **Threshold separability** | Two overlapping histograms | `/api/calibration` | Confirmed vs dismissed confidence; shows when a threshold can help — and when it cannot |
| 11 | **System architecture** | Block diagram | §2 | Three-language pipeline, where data crosses boundaries |
| 12 | **n8n workflow** | Node graph screenshot | n8n canvas | Automation is real, not aspirational |

**Screenshots to include:** annotated frame with real boxes (`person 0.91`, `book 0.49`);
Grounded Explanations panel; Uncertainty tags showing `unavailable`; Camera Health drill-down
with "What to do"; the *not comparable* refusal.

**Deliberately excluded:** any accuracy/precision/recall chart — see §7.

---

## 7. What Is Proven vs What Is Not

Stating this before a judge asks is worth more than being caught by it.

| Claim | Status |
|---|---|
| Real YOLO detection, no mock | **Verified** — boxes inspected on real footage |
| Clip/frame time sync | **Verified** — within 1 frame (0.083 s @ 12 fps) |
| Region baselines differ per region | **Verified** — 1,521× σ range |
| Threshold agent maths | **Verified** — 16 unit tests incl. edge cases |
| Fleet drift maths | **Verified** — 14 unit tests |
| Grounded-explanation schema | **Verified** — enforced by Go test |
| Coarse scan saves work | **Verified** — 37% on reference footage |
| Fleet at 3,200 cameras | **View verified**; only 2 profiles are real |
| Supabase persistence | **Code complete, never exercised** — 0 rows written |
| **Detection accuracy** | **Not measured.** No ground truth, no Top-5 hit rate |
| **False-positive rate** | **Not measured.** Both test videos are positives; no normal footage |
| Generative AI / LLM | **Not present.** No Ollama, no summaries |

**Known defects, stated plainly:**
`personCount` over-reports (~20 track IDs for ~6 people — ByteTrack fragmentation on occlusion;
max-simultaneous-detections is the correct estimator). `QualityFactors` shows `blur: 0.0` and
`occlusion: 0.0` in the API breakdown — blur *is* computed and *is* inside `Q_observability`,
but the per-factor itemisation is not propagated through Module 7; occlusion is not computed
at all and is reported as `unavailable` rather than faked.

---

## 8. Roadmap — Ordered by Value per Hour

1. **Fix `personCount`** → max simultaneous detections. One aggregation change; removes a
   visibly wrong number.
2. **Grid-search ensemble weights.** `0.35/0.35/0.30` is still the starting guess. Scores are
   cached in `motion.csv`, so this runs offline in seconds.
3. **Record 10 min of normal footage** → first false-positive rate. The number that matters
   most for an anti-cheating tool.
4. **Propagate per-factor quality penalties** through Module 7 → honest UI breakdown.
5. **Automate coarse-to-fine pass 2** → the 10%-flagged scenario becomes real, not projected.
6. **Wire CLIP verification into the pipeline** → the system visibly disagrees with itself.
7. **Module 11 (local LLM)** → natural-language summaries over structured evidence only.
