#!/usr/bin/env python3
"""
Real YOLO inference service for Golang backend
Receives frame paths via stdin, outputs detections as JSON
"""

import sys
import json
import os

# Suppress ultralytics output
os.environ['YOLO_VERBOSE'] = 'False'

import cv2
import numpy as np
from pathlib import Path

# Check if ultralytics is available
try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    YOLO_AVAILABLE = False
    print(json.dumps({"error": "ultralytics not installed. Run: pip install ultralytics"}), file=sys.stderr)

class YOLOInferenceService:
    def __init__(self, model_path="yolov8n.pt", confidence=0.25):
        """Initialize YOLO model"""
        if not YOLO_AVAILABLE:
            raise ImportError("ultralytics package not available")
        
        # Load model with verbose=False
        self.model = YOLO(model_path, verbose=False)
        self.confidence = confidence
        self.class_names = self.model.names  # COCO class names
        
        # Find class IDs
        self.person_class_id = None
        self.phone_class_id = None
        self.book_class_id = None
        
        for class_id, name in self.class_names.items():
            if name == "person":
                self.person_class_id = class_id
            elif name == "cell phone":
                self.phone_class_id = class_id
            elif name == "book":
                self.book_class_id = class_id
    
    def infer_frame(self, frame_path, roi=None):
        """
        Run YOLO inference on a frame
        
        Args:
            frame_path: Path to frame image
            roi: Optional ROI [x1, y1, x2, y2] to crop before inference
            
        Returns:
            List of detections with bbox, class_id, class_name, confidence
        """
        # Load image
        img = cv2.imread(frame_path)
        if img is None:
            return {"error": f"Failed to load image: {frame_path}"}
        
        # Crop to ROI if specified
        if roi and len(roi) == 4:
            x1, y1, x2, y2 = roi
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(img.shape[1], x2), min(img.shape[0], y2)
            img_crop = img[y1:y2, x1:x2]
            roi_offset = (x1, y1)
        else:
            img_crop = img
            roi_offset = (0, 0)
        
        # Run YOLO inference
        results = self.model(img_crop, conf=self.confidence, verbose=False)
        
        # Parse detections
        detections = []
        for result in results:
            boxes = result.boxes
            for box in boxes:
                # Get box coordinates
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                
                # Adjust for ROI offset
                x1 += roi_offset[0]
                y1 += roi_offset[1]
                x2 += roi_offset[0]
                y2 += roi_offset[1]
                
                # Get class and confidence
                class_id = int(box.cls[0])
                confidence = float(box.conf[0])
                class_name = self.class_names[class_id]
                
                detections.append({
                    "bbox": [int(x1), int(y1), int(x2), int(y2)],
                    "class_id": class_id,
                    "class_name": class_name,
                    "confidence": confidence
                })
        
        return {"detections": detections}
    
    def annotate_frame(self, frame_path, detections, output_path):
        """
        Draw bounding boxes on frame and save
        
        Args:
            frame_path: Input frame path
            detections: List of detection dicts
            output_path: Where to save annotated frame
        """
        img = cv2.imread(frame_path)
        if img is None:
            return {"error": f"Failed to load image: {frame_path}"}
        
        # Color map for different classes
        colors = {
            "person": (0, 255, 0),      # Green
            "cell phone": (0, 0, 255),  # Red
            "book": (0, 165, 255),      # Orange
        }
        
        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            class_name = det["class_name"]
            confidence = det["confidence"]
            
            # Get color (BGR order — cv2.rectangle expects (B, G, R), not (R, G, B))
            color = colors.get(class_name, (0, 255, 255))  # Yellow default
            
            # Draw box
            cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
            
            # Draw label
            label = f"{class_name} {confidence:.2f}"
            label_size, _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            label_y = max(y1 - 10, label_size[1])
            
            cv2.rectangle(img, 
                         (x1, label_y - label_size[1] - 5), 
                         (x1 + label_size[0], label_y + 5), 
                         color, -1)
            cv2.putText(img, label, (x1, label_y), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        
        # Save annotated frame
        cv2.imwrite(output_path, img)
        return {"success": True, "output_path": output_path}


def main():
    """Main service loop - reads commands from stdin, outputs JSON to stdout"""
    # Redirect stderr to devnull to suppress all library messages
    sys.stderr = open(os.devnull, 'w')
    
    if not YOLO_AVAILABLE:
        print(json.dumps({"error": "ultralytics not installed"}))
        sys.exit(1)
    
    # Initialize model
    try:
        service = YOLOInferenceService(model_path="yolov8n.pt", confidence=0.25)
        print(json.dumps({"status": "ready", "model": "yolov8n.pt"}), flush=True)
    except Exception as e:
        print(json.dumps({"error": f"Failed to initialize: {str(e)}"}), flush=True)
        sys.exit(1)
    
    # Process commands from stdin
    for line in sys.stdin:
        try:
            command = json.loads(line.strip())
            
            if command.get("action") == "infer":
                result = service.infer_frame(
                    command["frame_path"],
                    command.get("roi")
                )
                print(json.dumps(result), flush=True)
            
            elif command.get("action") == "annotate":
                result = service.annotate_frame(
                    command["frame_path"],
                    command["detections"],
                    command["output_path"]
                )
                print(json.dumps(result), flush=True)
            
            elif command.get("action") == "ping":
                print(json.dumps({"status": "alive"}), flush=True)
            
            else:
                print(json.dumps({"error": f"Unknown action: {command.get('action')}"}), flush=True)
                
        except json.JSONDecodeError:
            print(json.dumps({"error": "Invalid JSON"}), flush=True)
        except Exception as e:
            print(json.dumps({"error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
