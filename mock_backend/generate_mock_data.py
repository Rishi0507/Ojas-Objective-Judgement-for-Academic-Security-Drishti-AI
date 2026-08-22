"""
Mock Backend - Simulates Golang Modules 8 & 9 output
This generates enriched_events.json without needing Go/YOLO installed
"""

import json
import random
from datetime import datetime

def generate_mock_enriched_events():
    """Generate mock enriched events matching the frontend API contract"""
    
    # Video metadata
    video_id = "demo_exam_video_001.mp4"
    
    # Generate mock events with person tracking and object detection
    events = []
    
    event_templates = [
        {
            "type": "phone_activity",
            "description": "Person detected with cell phone",
            "has_phone": True,
            "has_paper": False,
            "priority": "high"
        },
        {
            "type": "proximity",
            "description": "Multiple persons detected in proximity",
            "has_phone": False,
            "has_paper": False,
            "priority": "medium"
        },
        {
            "type": "unusual_motion",
            "description": "Person detected with unusual motion",
            "has_phone": False,
            "has_paper": True,
            "priority": "medium"
        },
        {
            "type": "paper_activity",
            "description": "Paper/chit detected near person",
            "has_phone": False,
            "has_paper": True,
            "priority": "high"
        },
    ]
    
    for i in range(12):
        template = random.choice(event_templates)
        
        start = 5.0 + (i * 15)
        end = start + random.uniform(5, 12)
        duration = end - start
        
        motion_score = random.uniform(0.6, 0.95)
        observability = random.uniform(0.85, 0.98)
        camera_shake = random.uniform(0.05, 0.25)
        
        # Build evidence list
        evidence = [
            f"Motion score: {motion_score:.2f} (peak), {motion_score * 0.85:.2f} (mean)",
            f"Observability: {observability:.2f}",
            f"Frames analyzed: {int(duration * 5)}"
        ]
        
        # Add detection evidence
        num_persons = random.randint(1, 2) if template["type"] == "proximity" else 1
        evidence.append(f"Person tracks detected: {num_persons}")
        
        if template["has_phone"]:
            evidence.append("Cell phone detected in frame")
        if template["has_paper"]:
            evidence.append("Paper/book detected in frame")
        if camera_shake > 0.15:
            evidence.append(f"Possible camera motion: {camera_shake * 100:.1f}% of frames")
        
        # Determine detection object
        detection_object = "person"
        if template["has_phone"]:
            detection_object = "person with phone"
        elif template["has_paper"]:
            detection_object = "person with paper"
        
        event = {
            "id": f"event-{i+1}",
            "videoId": video_id,
            "start": round(start, 1),
            "end": round(end, 1),
            "duration": round(duration, 1),
            "motionScore": round(motion_score, 2),
            "cameraShake": round(camera_shake, 2),
            "priority": template["priority"],
            "type": template["type"],
            "description": f"{template['description']} ({num_persons} tracks, {motion_score*100:.0f}% motion)",
            "trackId": f"Track-{str(random.randint(1, 3)).zfill(2)}",
            "roi": [
                500 + i * 10,
                300,
                700 + i * 10,
                800
            ],
            "clipUrl": f"/clips/{video_id}_event{i+1:02d}.mp4",
            "annotatedClipUrl": f"/clips/{video_id}_event{i+1:02d}_annotated.mp4",
            "detection": {
                "confidence": round(motion_score, 2),
                "object": detection_object
            },
            "observability": round(observability, 2),
            "qualityFactors": {
                "cameraShake": round(camera_shake, 2),
                "blur": round(random.uniform(0.0, 0.15), 2),
                "occlusion": round(random.uniform(0.0, 0.10), 2),
                "lighting": round(1.0 - observability, 2)
            },
            "evidence": evidence,
            "status": "unreviewed"
        }
        
        events.append(event)
    
    # Build complete API response
    response = {
        "video_id": video_id,
        "video_path": f"/videos/{video_id}",
        "metadata": {
            "resolution": "1920x1080",
            "fps": 30.0,
            "sampling": "5 fps",
            "frames": 900,
            "processingTime": "2m 34s"
        },
        "quality_metrics": {
            "observability": 0.92,
            "cameraShake": 0.15,
            "blur": 0.08,
            "lighting": 0.12,
            "occlusion": 0.05
        },
        "event_count": len(events),
        "events": events,
        "processing_info": {
            "total_elapsed_sec": 154.3,
            "modules_run": ["1-7 (Python)", "8-9 (Golang - Mock Mode)"],
            "timestamp": datetime.now().isoformat()
        }
    }
    
    return response

if __name__ == "__main__":
    # Generate mock data
    data = generate_mock_enriched_events()
    
    # Write to file
    with open("enriched_events.json", "w") as f:
        json.dump(data, f, indent=2)
    
    print("✓ Generated mock enriched_events.json")
    print(f"  - Video: {data['video_id']}")
    print(f"  - Events: {data['event_count']}")
    print(f"  - Phone activity events: {sum(1 for e in data['events'] if e['type'] == 'phone_activity')}")
    print(f"  - Proximity events: {sum(1 for e in data['events'] if e['type'] == 'proximity')}")
    print(f"  - Output: enriched_events.json")
