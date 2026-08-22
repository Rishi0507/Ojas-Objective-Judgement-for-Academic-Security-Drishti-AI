"""
Generate video clips for existing events using Module 7
This re-runs Module 7 with --export-clips enabled
"""
import subprocess
import sys
import os

# Paths
video_path = "clips/04.CCTV Candidate Talking.mkv"
out_dir = "pipeline_out/cctv_video"
motion_csv = f"{out_dir}/motion.csv"
quality_csv = f"{out_dir}/quality.csv"
rois_json = f"{out_dir}/rois/rois_per_frame.json"
header_json = f"{out_dir}/header.json"
events_out = f"{out_dir}/events"
masks_dir = f"{out_dir}/cleaned_masks"
frames_dir = f"{out_dir}/frames"

# Check if required files exist
required_files = [
    motion_csv,
    quality_csv,
    rois_json,
    header_json,
]

missing = [f for f in required_files if not os.path.exists(f)]
if missing:
    print(f"ERROR: Missing required files: {missing}")
    sys.exit(1)

if not os.path.exists(video_path):
    print(f"ERROR: Video not found at {video_path}")
    sys.exit(1)

print("=" * 70)
print("  Generating Video Clips for Events")
print("=" * 70)
print()
print(f"Video: {video_path}")
print(f"Output: {events_out}/clips/")
print()
print("This will:")
print("  1. Re-run Module 7 (Event Segmentation)")
print("  2. Generate video clips for each event using FFmpeg")
print("  3. Update events.json with clip paths")
print()
print("=" * 70)
print()

# Run Module 7 with --export-clips
cmd = [
    sys.executable,
    "m1_7/module7_event_segmentation.py",
    "--motion-csv", motion_csv,
    "--quality-csv", quality_csv,
    "--rois-json", rois_json,
    "--header", header_json,
    "--out-dir", events_out,
    "--export-clips",  # Enable clip export
    "--masks-dir", masks_dir,
    "--frames-dir", frames_dir,
]

print("Running: " + " ".join(cmd))
print()

result = subprocess.run(cmd, capture_output=False, text=True)

if result.returncode != 0:
    print()
    print("=" * 70)
    print("  ERROR: Clip generation failed!")
    print("=" * 70)
    print()
    print("Possible issues:")
    print("  - FFmpeg not installed (required for video cutting)")
    print("  - Video file not accessible")
    print("  - Insufficient disk space")
    print()
    sys.exit(1)

print()
print("=" * 70)
print("  CLIP GENERATION COMPLETE!")
print("=" * 70)
print()
print(f"Clips saved to: {events_out}/clips/")
print()
print("Next steps:")
print("  1. Run integration: .\\run_integration.bat")
print("  2. Refresh browser: http://localhost:3000")
print()
