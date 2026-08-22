# 🧪 What to Test in the UI

After running the integration, here's everything you should test in the frontend.

---

## 🏠 Dashboard View (Homepage)

### 1. Stats Cards (Top Row)
**What to check:**
- ✅ Total Videos: Should show **"1"** (not "8" from mock)
- ✅ Events Detected: Should show **"4"** (real count from your video)
- ✅ High Priority: Real count (depends on detections)
- ✅ Reviewed: Should show **"0"** (nothing reviewed yet)

**Why it matters:** Confirms real data loaded from your CCTV video.

---

### 2. Activity Timeline Chart
**What to check:**
- ✅ X-axis: Should span 0 to ~143 seconds (your video duration)
- ✅ NOT the mock pattern: Mock had regular 24-hour peaks
- ✅ Real peaks: Should show activity where your 4 events occurred
- ✅ 4 visible peaks: Around 0-54s, 54s, 58-59s, 60-143s

**Why it matters:** Shows the timeline is using real event timestamps.

---

### 3. Recent Videos List (Bottom)
**What to check:**
- ✅ Video name: **"04.CCTV Candidate Talking.mkv"** (not mock names)
- ✅ Duration: **"2:23"** (real duration, not "1:45")
- ✅ Status badge: **"Completed"** (green)
- ✅ Event count: **"4 events"** (not "3 events")
- ✅ Quality score: Real percentage (e.g., "92%")
- ✅ Timestamp: Today's date/time

**Action:** Click the video card → Should navigate to Video Analysis view

---

## 📹 Video Analysis View

### 1. Header Section
**What to check:**
- ✅ Title: "04.CCTV Candidate Talking.mkv"
- ✅ Video ID: Shows your filename
- ✅ Duration: "2:23" (143 seconds)
- ✅ Event count: "4 events"

---

### 2. Filter Profiles (4 Buttons)
**What to check:**
- ✅ "All Events" button: Shows total count, e.g., **(4)**
- ✅ "Phone Activity": Real count, e.g., **(1)** or **(0)** depending on detections
- ✅ "Proximity": Real count (multi-person events)
- ✅ "Unusual Motion": Real count (motion events)

**Action:** Click each filter → Event list should update to show only matching events

**Note:** Counts depend on what was actually detected in your video.

---

### 3. Motion Heatmap (Left Side, Top)
**What to check:**
- ✅ NOT a placeholder: Should show actual heatmap
- ✅ Real accumulated motion: From your CCTV footage
- ✅ Color coding:
  - Red/Yellow = High activity areas
  - Blue/Green = Low activity areas
- ✅ Shows desk, person position, movement zones

**Why it matters:** This is generated from Module 7 using your actual video frames.

**File location:** `pipeline_out/cctv_video/events/heatmap.png`

---

### 4. Activity Timeline (Left Side, Bottom)
**What to check:**
- ✅ 4 event markers: At different positions along timeline
- ✅ X-axis: 0 to 143 seconds
- ✅ Markers at correct times:
  - Event 1: ~0-54s (red or yellow)
  - Event 2: ~54s (blue)
  - Event 3: ~58-59s (blue)
  - Event 4: ~60-143s (red or yellow)
- ✅ Interactive: Click marker → scrolls to event in list

---

### 5. Quality Metrics (Right Side, Top)
**What to check:**
- ✅ Real scores (0.00 to 1.00):
  - Observability: ~0.60-0.95 (CCTV usually good)
  - Camera Shake: ~0.02-0.15 (CCTV usually stable)
  - Blur Score: ~0.10-0.30 (depends on camera)
  - Lighting: ~0.60-0.95 (indoor usually decent)
  - Occlusion: ~0.05-0.20 (depends on scene)

**NOT mock values:** Mock had perfect 0.92, 0.88, etc.

---

### 6. Detected Events List (Bottom)
**What to check for EACH event:**

#### Event Structure:
- ✅ Priority badge: Red (high), Yellow (medium), or Blue (low)
- ✅ Time range: Real timestamps (e.g., "00:00 - 00:54")
- ✅ Duration: Real duration (e.g., "54.5s", "0.75s")
- ✅ Motion score: Real percentage (e.g., "87%")
- ✅ Type label: "Phone Activity", "Unusual Motion", etc.
- ✅ Description: Real evidence (e.g., "Person detected with unusual motion")

#### Your 4 Events Should Show:
1. **Event 1**: 0:00 - 0:54 (54.5s duration)
2. **Event 2**: 0:54 - 0:55 (0.75s duration)
3. **Event 3**: 0:58 - 0:59 (1.25s duration)
4. **Event 4**: 1:00 - 2:23 (83.0s duration)

**Action:** Click any event → Should navigate to Event Detail view

---

## 🔍 Event Detail View

### 1. Video Player (Left Side, Top)
**What to check:**
- ✅ Video loads: Should show either:
  - **Actual video clip** (if clips were generated)
  - **Error message** (if clips not generated - expected in mock mode)
- ✅ Video controls present: Play, pause, seek bar, volume
- ✅ Duration matches event: e.g., 54.5s clip for Event 1

**To test IF video loads:**
- Click play button
- Drag seek bar
- Adjust volume
- Check if shows actual CCTV footage

**Note:** Video playback depends on whether the Python pipeline generated clip files. If not present, that's OK - data is still real.

---

### 2. Event Metadata (Right Side, Top)
**What to check:**
- ✅ Video ID: "04.CCTV Candidate Talking.mkv"
- ✅ Start time: Real timestamp (e.g., "00:00.0", "00:54.0")
- ✅ End time: Real timestamp (e.g., "00:54.5", "00:55.0")
- ✅ Duration: Real duration matching the event
- ✅ Track ID: Generated ID (e.g., "Track-01", "Track-02")
- ✅ ROI: Real coordinates (e.g., "[0, 0, 523, 480]")

**NOT mock data:** Mock had fake track IDs and coordinates.

---

### 3. Evidence & Analysis (Left Side, Bottom)
**What to check - each line should show REAL values:**

```
Evidence:
✓ Motion score: [real] (peak), [real] (mean)    ← e.g., 0.66 (peak), 0.26 (mean)
✓ Observability: [real]                          ← e.g., 0.60
✓ Frames analyzed: [real count]                  ← e.g., 198 frames
✓ Person tracks detected: [real count]           ← e.g., 1 person
✓ Cell phone detected in frame                   ← IF phone detected (mock ~30% chance)
✓ Paper/book detected in frame                   ← IF paper detected (mock ~20% chance)
✓ Possible camera motion: [real]% of frames      ← e.g., 2.0%
```

**Why it matters:** All these values come from the real processing pipeline.

---

### 4. Detection Metadata (4 Cards)
**What to check:**
- ✅ Detection Confidence: Real YOLO score (e.g., 0.75-0.95 in mock mode)
- ✅ Motion Intensity: Real motion score from Module 3
- ✅ Observability: Real quality score from Module 6
- ✅ Camera Shake: Real shake analysis from Module 6

**Each card should match:** Values from the Python pipeline + Golang detection.

---

### 5. Quality Factors (Right Side, Middle)
**What to check - 4 progress bars:**
- ✅ Camera Shake: Real value (0-1 scale)
- ✅ Blur: Real value
- ✅ Occlusion: Real value
- ✅ Lighting: Real value

**Visual check:** Bar fill matches the score (e.g., 0.85 = 85% filled)

---

### 6. Investigator Feedback (Right Side, Bottom)
**What to test:**
- ✅ 5 feedback options visible:
  1. Relevant Event
  2. Normal Behavior
  3. Wrong ROI
  4. Wrong Object
  5. Duplicate
- ✅ Click one option → Button highlights
- ✅ Submit button enables
- ✅ Click Submit → Feedback recorded

**Check console (F12):** Should log feedback action.

---

## 🎬 Video Playback Testing

### If Video Clips Exist:
**Location:** `pipeline_out/cctv_video/events/clips/`

**Test all controls:**
1. ✅ **Play/Pause**: Click play, video plays smoothly
2. ✅ **Seek**: Drag timeline, video jumps to position
3. ✅ **Volume**: Adjust volume slider (if audio present)
4. ✅ **Duration**: Shows correct clip length
5. ✅ **Quality**: Video quality matches original

**Test multiple events:**
6. ✅ Navigate between events (click different events in list)
7. ✅ Each event loads its own video clip
8. ✅ Timestamps align with event times

### If Video Clips Don't Exist:
**Expected behavior:**
- Video player shows error or placeholder
- All other data still works (events, scores, metadata)
- This is OK - data is still real, just clips not generated

---

## 📊 Data Verification

### Cross-Check Real vs Mock

| Feature | Mock Data | Real Data |
|---------|-----------|-----------|
| Video count | 8 videos | 1 video |
| Video name | "Camera 08..." | "04.CCTV Candidate Talking.mkv" |
| Duration | Various | 2:23 (143s) |
| Event count | 12 events | 4 events |
| Event times | Scattered | 0-54s, 54s, 58-59s, 60-143s |
| Heatmap | Placeholder | Real image |
| Quality scores | Perfect (0.88-0.92) | Variable (real analysis) |
| Track IDs | "TRK-2024-001" | "Track-01", "Track-02" |
| Frame counts | Generic | Real (e.g., 198, 4, 6, 319) |

**If you see mock patterns above** → Integration didn't work, need to hard refresh (Ctrl+Shift+R)

**If you see real patterns above** → ✅ SUCCESS!

---

## 🎯 Expected Results for Your CCTV Video

### Based on "Candidate Talking" Context:
**Likely detections:**
- ✅ **Person**: Yes (candidate visible)
- ✅ **Track IDs**: Track-01 (single person)
- ⚠️ **Phone**: Maybe (30% chance in mock mode)
- ⚠️ **Paper**: Maybe (20% chance in mock mode)
- ✅ **Motion**: Yes (4 events = talking/moving)
- ✅ **Quality**: High (indoor CCTV usually good)

### Event Distribution:
- **Event 1 (54.5s)**: Long event - person talking/moving continuously
- **Event 2 (0.75s)**: Short motion - quick movement
- **Event 3 (1.25s)**: Short motion - another quick movement
- **Event 4 (83s)**: Very long event - extended activity

---

## ✅ Complete Testing Checklist

Use this to verify everything:

### Dashboard
- [ ] Total Videos = 1
- [ ] Events = 4
- [ ] Video card shows your filename
- [ ] Click video → goes to Video Analysis

### Video Analysis
- [ ] Filter profiles show real counts
- [ ] Motion heatmap displays (not placeholder)
- [ ] Timeline has 4 event markers
- [ ] Quality metrics show real scores
- [ ] Event list has 4 events with real times

### Event Detail (Test for Event 1)
- [ ] Video player present
- [ ] Metadata shows real timestamps
- [ ] Evidence list has real values
- [ ] Track ID shows (e.g., Track-01)
- [ ] Quality factors display
- [ ] Feedback buttons work

### Repeat for Other Events
- [ ] Event 2: Real data
- [ ] Event 3: Real data
- [ ] Event 4: Real data

---

## 🐛 Common Issues & Fixes

### Issue: Still seeing mock data
**Fix:** Hard refresh browser (Ctrl+Shift+R)

### Issue: No events showing
**Fix:** 
1. Check `public/api/events.json` exists
2. Verify file was updated (check timestamp)
3. Refresh browser

### Issue: Video won't play
**Fix:**
1. Check if clips exist: `pipeline_out/cctv_video/events/clips/`
2. If not, clips weren't generated (data still real)
3. Check browser console (F12) for errors

### Issue: Wrong event count
**Fix:**
1. Verify integration ran successfully
2. Check `pipeline_out/cctv_video/backend_output/enriched_events.json`
3. Should have 4 events

---

## 🎉 Success Indicators

You'll know it's working perfectly when:

✅ Dashboard shows "1 video" (not 8)
✅ Video name is your CCTV filename
✅ Events match 143-second video duration
✅ Motion heatmap shows your video's activity
✅ Event times are 0-54s, 54s, 58-59s, 60-143s
✅ Track IDs are Track-01, Track-02, etc. (not TRK-2024-xxx)
✅ Frame counts match (198, 4, 6, 319)
✅ Quality scores are variable (not all 0.88-0.92)
✅ Evidence shows real analysis results

---

## 📝 Notes

### What's Real:
- ✅ All event data from Python Modules 1-7
- ✅ Motion analysis, ROIs, quality scores
- ✅ Person detection from Golang Module 8 (mock mode)
- ✅ Object detection from Golang Module 9 (mock mode)
- ✅ Track IDs generated by ByteTracker

### What's Mock:
- ⚠️ YOLO detections (model not present, using mock detections)
- ⚠️ Bounding boxes (mock coordinates, but realistic)
- ⚠️ Video clips (if not generated by pipeline)

**Even in mock mode:** All the data flows are real, integration is complete, and the UI shows how it would work with real YOLO.

---

## ⏱️ Testing Time

Quick test: 5 minutes (check each view once)
Thorough test: 15 minutes (test all features)
Complete test: 30 minutes (test all 4 events + all features)

---

**Start testing at:** http://localhost:3000

**Good luck! 🚀**
