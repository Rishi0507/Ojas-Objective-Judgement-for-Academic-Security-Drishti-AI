package main

// ============================================================
// Input data structures (from Python modules 1-7)
// ============================================================

type Header struct {
	VideoID      string  `json:"video_id"`
	VideoPath    string  `json:"video_path"`
	FPS          float64 `json:"fps"`
	FrameCount   int     `json:"frame_count"`
	Width        int     `json:"width"`
	Height       int     `json:"height"`
	DurationSec  float64 `json:"duration_sec"`
	Codec        string  `json:"codec"`
	FourCC       string  `json:"fourcc"`
	Source       string  `json:"source"`
}

type ROI struct {
	FrameIdx     int     `json:"frame_idx"`
	TimestampSec float64 `json:"timestamp_sec"`
	ROIID        int     `json:"roi_id"`
	BBoxX1       int     `json:"bbox_x1"`
	BBoxY1       int     `json:"bbox_y1"`
	BBoxX2       int     `json:"bbox_x2"`
	BBoxY2       int     `json:"bbox_y2"`
	W            int     `json:"w"`
	H            int     `json:"h"`
	Area         int     `json:"area"`
	CX           float64 `json:"cx"`
	CY           float64 `json:"cy"`
	AspectRatio  float64 `json:"aspect_ratio"`
	FillRatio    float64 `json:"fill_ratio"`
	MergedFrom   int     `json:"merged_from"`
}

type FrameROIs struct {
	FrameIdx     int     `json:"frame_idx"`
	TimestampSec float64 `json:"timestamp_sec"`
	MotionScore  float64 `json:"motion_score"`
	ROICount     int     `json:"roi_count"`
	ROIs         []ROI   `json:"rois"`
}

type ROIsData struct {
	FrameResolution []int       `json:"frame_resolution"`
	Thresholds      interface{} `json:"thresholds"`
	Frames          []FrameROIs `json:"frames"`
}

type Event struct {
	EventID                int         `json:"event_id"`
	Start                  float64     `json:"start"`
	End                    float64     `json:"end"`
	Duration               float64     `json:"duration"`
	UnpaddedStart          float64     `json:"unpadded_start"`
	UnpaddedEnd            float64     `json:"unpadded_end"`
	StartFrameIdx          int         `json:"start_frame_idx"`
	EndFrameIdx            int         `json:"end_frame_idx"`
	FrameCount             int         `json:"frame_count"`
	PeakSFinal             float64     `json:"peak_s_final"`
	MeanSFinal             float64     `json:"mean_s_final"`
	MinSFinal              float64     `json:"min_s_final"`
	PeakSEvidence          float64     `json:"peak_s_evidence"`
	MeanQObservability     float64     `json:"mean_q_observability"`
	CameraMotionFrameCount int         `json:"camera_motion_frame_count"`
	CameraMotionPct        float64     `json:"camera_motion_pct"`
	PrimaryLabel           string      `json:"primary_label"`
	// PeakJerkScore/MeanJerkScore/MotionCharacter come from Module 3's
	// temporal spectral-residual saliency pass (see module3_motion_detection.py)
	// via Module 7's per-event enrichment. Absent on events.json files
	// produced before that feature existed — Go zero-values them (0.0 /
	// "" ), so JSON omits nothing but the API layer treats "" the same
	// as an unlabeled/gradual event.
	PeakJerkScore          float64     `json:"peak_jerk_score"`
	MeanJerkScore          float64     `json:"mean_jerk_score"`
	MotionCharacter        string      `json:"motion_character"`
	ROI                    []int       `json:"roi"` // [x1, y1, x2, y2]
	ROISummary             interface{} `json:"roi_summary"`
	Status                 string      `json:"status"`
	EventType              string      `json:"event_type"`
	PostPadMerges          int         `json:"post_pad_merges"`
	ClipPath               *string     `json:"clip_path"`
}

type EventsData struct {
	VideoID        string      `json:"video_id"`
	VideoPath      string      `json:"video_path"`
	VideoDuration  float64     `json:"video_duration_sec"`
	Params         interface{} `json:"params"`
	FrameCount     int         `json:"frame_count"`
	EventCount     int         `json:"event_count"`
	Events         []Event     `json:"events"`
}

// ============================================================
// Module 8 & 9 output structures (person + object detection)
// ============================================================

type PersonTrack struct {
	TrackID      string    `json:"track_id"`      // e.g. "Track-01", "Track-02"
	FirstSeen    float64   `json:"first_seen"`    // Timestamp in seconds
	LastSeen     float64   `json:"last_seen"`     // Timestamp in seconds
	FrameCount   int       `json:"frame_count"`   // Number of frames tracked
	BBoxes       []BBox    `json:"bboxes"`        // Per-frame bounding boxes
	Confidence   float64   `json:"confidence"`    // Average detection confidence
}

type ObjectDetection struct {
	ObjectType   string    `json:"object_type"`   // "cell phone", "paper", etc.
	FirstSeen    float64   `json:"first_seen"`    // Timestamp in seconds
	LastSeen     float64   `json:"last_seen"`     // Timestamp in seconds
	FrameCount   int       `json:"frame_count"`   // Number of frames detected
	BBoxes       []BBox    `json:"bboxes"`        // Per-frame bounding boxes
	Confidence   float64   `json:"confidence"`    // Average detection confidence
	TrackID      *string   `json:"track_id"`      // Associated person track (if any)
}

type BBox struct {
	FrameIdx     int     `json:"frame_idx"`
	TimestampSec float64 `json:"timestamp_sec"`
	X1           int     `json:"x1"`
	Y1           int     `json:"y1"`
	X2           int     `json:"x2"`
	Y2           int     `json:"y2"`
	Confidence   float64 `json:"confidence"`
}

// Offence is one concrete, evidenced finding inside an event — the thing an
// investigator actually reviews. An event says "something happened here";
// an offence says what, when, to whom, and points at the still that proves it.
type Offence struct {
	Type        string  `json:"type"`  // prohibited_object | loitering | crowd_disturbance | object_exchange | motion_anomaly
	Label       string  `json:"label"` // human-readable summary
	TrackID     string  `json:"trackId,omitempty"`
	StartSec    float64 `json:"startSec"`
	EndSec      float64 `json:"endSec"`
	FrameIdx    int     `json:"frameIdx"`
	Confidence  float64 `json:"confidence"`
	BBox        []int   `json:"bbox,omitempty"`        // [x1,y1,x2,y2] in processing resolution
	DurationSec float64 `json:"durationSec,omitempty"` // loitering
	Count       int     `json:"count,omitempty"`       // crowd size / people involved
	Snapshot    string  `json:"snapshot,omitempty"`    // auto-captured still, app-relative
}

type EnrichedEvent struct {
	Event                                       // Embed original event
	PersonTracks     []PersonTrack     `json:"person_tracks"`
	ObjectDetections []ObjectDetection `json:"object_detections"`
	DetectionSummary DetectionSummary  `json:"detection_summary"`
	Offences         []Offence         `json:"offences"`
}

type DetectionSummary struct {
	TotalPersons int      `json:"total_persons"`
	TotalObjects int      `json:"total_objects"`
	ObjectTypes  []string `json:"object_types"`
	HasPhone     bool     `json:"has_phone"`
	HasPaper     bool     `json:"has_paper"`
}

// ============================================================
// Frontend API response format (matching PROJECT_STRUCTURE.md)
// ============================================================

type VideoMetadata struct {
	Resolution     string  `json:"resolution"`
	FPS            float64 `json:"fps"`
	Sampling       string  `json:"sampling"`
	Frames         int     `json:"frames"`
	ProcessingTime string  `json:"processingTime"`
}

type QualityMetrics struct {
	Observability float64 `json:"observability"`
	CameraShake   float64 `json:"cameraShake"`
	Blur          float64 `json:"blur"`
	Lighting      float64 `json:"lighting"`
	Occlusion     float64 `json:"occlusion"`
}

type APIEvent struct {
	ID              string           `json:"id"`
	VideoID         string           `json:"videoId"`
	Start           float64          `json:"start"`
	End             float64          `json:"end"`
	Duration        float64          `json:"duration"`
	MotionScore     float64          `json:"motionScore"`
	CameraShake     float64          `json:"cameraShake"`
	Priority        string           `json:"priority"`
	Type            string           `json:"type"`
	Description     string           `json:"description"`
	TrackID         string           `json:"trackId"`
	ROI             []int            `json:"roi"`
	ClipURL         string           `json:"clipUrl"`
	AnnotatedURL    string           `json:"annotatedClipUrl"`
	Detection       DetectionInfo    `json:"detection"`
	Observability   float64          `json:"observability"`
	QualityFactors  QualityMetrics   `json:"qualityFactors"`
	Evidence        []string         `json:"evidence"`
	Status          string           `json:"status"`
	MotionCharacter string           `json:"motionCharacter"` // "sudden" | "gradual" | "" (unavailable)
	PeakJerkScore   float64          `json:"jerkScore"`
	Offences        []Offence        `json:"offences"`
	Snapshots       []string         `json:"snapshots"` // auto-captured evidence stills

	// Signals for profile-based re-scoring and event grouping. Full
	// PersonTrack/ObjectDetection arrays are deliberately not inlined here —
	// they run to hundreds of per-frame boxes per event and would dwarf the
	// rest of the payload. These are the reduced forms consumers actually
	// need; the raw arrays remain in EnrichedEvent for anything server-side.
	TrackIDs        []string `json:"trackIds"`        // every person seen; stable across events in a video
	PersonCount     int      `json:"personCount"`     // distinct people tracked in this event
	ObjectClasses   []string `json:"objectClasses"`   // prohibited item types present
	ObjectScore     float64  `json:"objectScore"`     // 0-1, strongest prohibited-item detection
	PersonProximity float64  `json:"personProximity"` // 0-1, how closely people cluster

	// Feature 10.3 — camera-aware uncertainty, surfaced as readable labels
	// rather than raw floats. Purely a presentation of QualityFactors above;
	// no new measurement is performed.
	UncertaintyReasons UncertaintyReasons `json:"uncertaintyReasons"`

	// Feature 10.6 — one grounded, traceable explanation per claim made about
	// this event. Every entry points at the frames and boxes it rests on.
	Explanations []Explanation `json:"explanations"`
}

// UncertaintyReasons renders Module 6's continuous quality signals as
// "high"/"medium"/"low" bands (feature 10.3).
//
// Fields Module 6 does not currently produce read "unavailable" rather than
// "low": QualityFactors hard-codes blur and occlusion to 0.0, and reporting
// that as "low blur" would assert a measurement that was never taken.
type UncertaintyReasons struct {
	CameraShake    string `json:"camera_shake"`
	Blur           string `json:"blur"`
	LightingChange string `json:"lighting_change"`
	Occlusion      string `json:"occlusion"`
}

// Explanation is one claim shown to an investigator, bound to the evidence it
// was derived from (feature 10.6). Nothing is emitted that cannot name the
// frame, box or track it came from.
type Explanation struct {
	EventID             string   `json:"event_id"`
	Claim               string   `json:"claim"`
	Timestamp           float64  `json:"timestamp"`
	TrackID             string   `json:"track_id,omitempty"`
	ROI                 []int    `json:"roi"`
	ObjectBBox          []int    `json:"object_bbox,omitempty"`
	SupportingFrameURLs []string `json:"supporting_frame_urls"`
	UncertaintyReason   string   `json:"uncertainty_reason"`
}

type DetectionInfo struct {
	Confidence float64 `json:"confidence"`
	Object     string  `json:"object"`
}

type APIResponse struct {
	VideoID        string         `json:"video_id"`
	VideoPath      string         `json:"video_path"`
	Metadata       VideoMetadata  `json:"metadata"`
	QualityMetrics QualityMetrics `json:"quality_metrics"`
	EventCount     int            `json:"event_count"`
	Events         []APIEvent     `json:"events"`
	ProcessingInfo ProcessingInfo `json:"processing_info"`
}

type ProcessingInfo struct {
	TotalElapsedSec float64 `json:"total_elapsed_sec"`
	ModulesRun      []string `json:"modules_run"`
	Timestamp       string   `json:"timestamp"`
}
