package main

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"math"
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
		col := getColorForClass(det.ClassName)
		drawBox(rgba, det.BBox, col, 3)
		drawLabel(rgba, det.BBox, det.ClassName, det.Confidence, col)
	}

	// Save annotated image
	outFile, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer outFile.Close()

	return jpeg.Encode(outFile, rgba, &jpeg.Options{Quality: 90})
}

// drawBox draws a rectangle border
func drawBox(img *image.RGBA, box image.Rectangle, col color.Color, thickness int) {
	// Ensure box is within image bounds
	bounds := img.Bounds()
	box = box.Intersect(bounds)
	
	if box.Empty() {
		return
	}

	// Draw top and bottom lines
	for x := box.Min.X; x < box.Max.X; x++ {
		for t := 0; t < thickness; t++ {
			if box.Min.Y+t < bounds.Max.Y {
				img.Set(x, box.Min.Y+t, col)
			}
			if box.Max.Y-t-1 >= bounds.Min.Y && box.Max.Y-t-1 < bounds.Max.Y {
				img.Set(x, box.Max.Y-t-1, col)
			}
		}
	}
	
	// Draw left and right lines
	for y := box.Min.Y; y < box.Max.Y; y++ {
		for t := 0; t < thickness; t++ {
			if box.Min.X+t < bounds.Max.X {
				img.Set(box.Min.X+t, y, col)
			}
			if box.Max.X-t-1 >= bounds.Min.X && box.Max.X-t-1 < bounds.Max.X {
				img.Set(box.Max.X-t-1, y, col)
			}
		}
	}
}

// drawLabel draws a label background and text (simplified - just background)
func drawLabel(img *image.RGBA, box image.Rectangle, label string, confidence float64, col color.Color) {
	bounds := img.Bounds()
	
	// Label dimensions
	labelHeight := 24
	labelWidth := 120
	
	// Position label above box (or below if at top)
	labelY1 := box.Min.Y - labelHeight
	labelY2 := box.Min.Y
	
	if labelY1 < bounds.Min.Y {
		// Box is at top, put label below
		labelY1 = box.Max.Y
		labelY2 = box.Max.Y + labelHeight
	}
	
	labelX1 := box.Min.X
	labelX2 := box.Min.X + labelWidth
	
	// Ensure label is within bounds
	if labelX2 > bounds.Max.X {
		labelX2 = bounds.Max.X
		labelX1 = labelX2 - labelWidth
		if labelX1 < bounds.Min.X {
			labelX1 = bounds.Min.X
		}
	}
	
	if labelY2 > bounds.Max.Y {
		labelY2 = bounds.Max.Y
	}
	
	// Draw semi-transparent background
	labelRect := image.Rect(labelX1, labelY1, labelX2, labelY2)
	labelRect = labelRect.Intersect(bounds)
	
	if !labelRect.Empty() {
		// Create semi-transparent version of the color
		r, g, b, _ := col.RGBA()
		bgColor := color.RGBA{
			R: uint8(r >> 8),
			G: uint8(g >> 8),
			B: uint8(b >> 8),
			A: 220, // Semi-transparent
		}
		
		for y := labelRect.Min.Y; y < labelRect.Max.Y; y++ {
			for x := labelRect.Min.X; x < labelRect.Max.X; x++ {
				// Alpha blend
				existing := img.At(x, y)
				er, eg, eb, _ := existing.RGBA()
				alpha := float64(bgColor.A) / 255.0
				
				newR := uint8((float64(bgColor.R)*alpha + float64(er>>8)*(1-alpha)))
				newG := uint8((float64(bgColor.G)*alpha + float64(eg>>8)*(1-alpha)))
				newB := uint8((float64(bgColor.B)*alpha + float64(eb>>8)*(1-alpha)))
				
				img.Set(x, y, color.RGBA{R: newR, G: newG, B: newB, A: 255})
			}
		}
		
		// Draw text (simplified - just show label as pixels)
		// For production, use a font rendering library like golang.org/x/image/font
		drawSimpleText(img, labelX1+4, labelY1+6, label, color.White)
		
		// Draw confidence below label
		confText := fmt.Sprintf("%.0f%%", confidence*100)
		drawSimpleText(img, labelX1+4, labelY1+16, confText, color.White)
	}
}

// drawSimpleText draws text using a simple pixel-based approach
func drawSimpleText(img *image.RGBA, x, y int, text string, col color.Color) {
	// Simple 5x7 bitmap font for basic characters
	// This is a minimal implementation - for production use a proper font library
	bounds := img.Bounds()
	
	for i, ch := range text {
		charX := x + i*6
		if charX+5 >= bounds.Max.X {
			break
		}
		drawChar(img, charX, y, ch, col)
	}
}

// drawChar draws a single character (very simplified)
func drawChar(img *image.RGBA, x, y int, ch rune, col color.Color) {
	// Simple pixel patterns for basic ASCII
	var pattern []int
	
	switch ch {
	case 'p':
		pattern = []int{1, 1, 1, 1, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0}
	case 'e':
		pattern = []int{0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0}
	case 'r':
		pattern = []int{0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0}
	case 's':
		pattern = []int{0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0}
	case 'o':
		pattern = []int{0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0}
	case 'n':
		pattern = []int{0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1}
	case 'c':
		pattern = []int{0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0}
	case 'l':
		pattern = []int{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0}
	case 'h':
		pattern = []int{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1}
	case 'b':
		pattern = []int{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0}
	case 'k':
		pattern = []int{1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1}
	case '0', '1', '2', '3', '4', '5', '6', '7', '8', '9':
		pattern = []int{1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1}
	case '%':
		pattern = []int{1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1}
	case ' ':
		pattern = []int{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}
	default:
		// Draw a small square for unknown chars
		pattern = []int{1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1}
	}
	
	// Draw 5x5 pattern
	bounds := img.Bounds()
	for i := 0; i < 25; i++ {
		if pattern[i] == 1 {
			px := x + (i % 5)
			py := y + (i / 5)
			if px >= bounds.Min.X && px < bounds.Max.X && py >= bounds.Min.Y && py < bounds.Max.Y {
				img.Set(px, py, col)
			}
		}
	}
}

// getColorForClass returns color based on object class
func getColorForClass(className string) color.Color {
	switch className {
	case "person":
		return color.RGBA{0, 255, 0, 255} // Green
	case "cell phone":
		return color.RGBA{255, 0, 0, 255} // Red
	case "book":
		return color.RGBA{255, 165, 0, 255} // Orange
	default:
		return color.RGBA{255, 255, 0, 255} // Yellow
	}
}

// AnnotateBatch annotates multiple frames in parallel
func AnnotateBatch(frames []FrameROIs, framesDir string, detector *YOLODetector, outputDir string) error {
	os.MkdirAll(outputDir, 0755)
	
	for _, frame := range frames {
		framePath := fmt.Sprintf("%s/frame_%05d.jpg", framesDir, frame.FrameIdx)
		
		// Check if frame exists
		if _, err := os.Stat(framePath); os.IsNotExist(err) {
			continue
		}
		
		// Run detection
		var allDetections []Detection
		for _, roi := range frame.ROIs {
			roiRect := image.Rect(roi.BBoxX1, roi.BBoxY1, roi.BBoxX2, roi.BBoxY2)
			detections, err := detector.DetectFrame(framePath, roiRect)
			if err != nil {
				continue
			}
			allDetections = append(allDetections, detections...)
		}
		
		// Annotate frame
		if len(allDetections) > 0 {
			outputPath := fmt.Sprintf("%s/annotated_frame_%05d.jpg", outputDir, frame.FrameIdx)
			if err := AnnotateFrame(framePath, allDetections, outputPath); err != nil {
				return fmt.Errorf("failed to annotate frame %d: %v", frame.FrameIdx, err)
			}
		}
	}
	
	return nil
}

// Helper function to calculate distance between two points
func distance(x1, y1, x2, y2 int) float64 {
	dx := float64(x2 - x1)
	dy := float64(y2 - y1)
	return math.Sqrt(dx*dx + dy*dy)
}
