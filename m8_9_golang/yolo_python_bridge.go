package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os/exec"
	"sync"
)

// YOLOPythonBridge manages communication with Python YOLO service
type YOLOPythonBridge struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader
	stderr io.ReadCloser
	mu     sync.Mutex
	ready  bool
}

// YOLODetectionResponse from Python service
type YOLODetectionResponse struct {
	Detections []YOLODetection `json:"detections,omitempty"`
	Error      string          `json:"error,omitempty"`
	Status     string          `json:"status,omitempty"`
	Model      string          `json:"model,omitempty"`
}

// YOLODetection from Python
type YOLODetection struct {
	BBox       []int   `json:"bbox"`        // [x1, y1, x2, y2]
	ClassID    int     `json:"class_id"`
	ClassName  string  `json:"class_name"`
	Confidence float64 `json:"confidence"`
}

// NewYOLOPythonBridge starts the Python YOLO service
func NewYOLOPythonBridge(pythonScript string) (*YOLOPythonBridge, error) {
	log.Println("[INFO] Starting Python YOLO inference service...")
	
	// Start Python process
	cmd := exec.Command("python", pythonScript)
	
	// Get stdin/stdout pipes
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stdin pipe: %v", err)
	}
	
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stdout pipe: %v", err)
	}
	
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stderr pipe: %v", err)
	}
	
	// Start process
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start Python process: %v", err)
	}
	
	bridge := &YOLOPythonBridge{
		cmd:    cmd,
		stdin:  stdin,
		stdout: bufio.NewReader(stdout),
		stderr: stderr,
		ready:  false,
	}
	
	// Read stderr in background
	go bridge.logStderr()
	
	// Wait for ready signal
	response, err := bridge.readResponse()
	if err != nil {
		bridge.Close()
		return nil, fmt.Errorf("failed to initialize: %v", err)
	}
	
	if response.Status == "ready" {
		bridge.ready = true
		log.Printf("[INFO] Python YOLO service ready with model: %s", response.Model)
		log.Println("[INFO] Running REAL YOLO inference mode (via Python)")
		return bridge, nil
	}
	
	if response.Error != "" {
		bridge.Close()
		return nil, fmt.Errorf("Python service error: %s", response.Error)
	}
	
	bridge.Close()
	return nil, fmt.Errorf("unexpected response: %+v", response)
}

// InferFrame sends a frame for inference
func (b *YOLOPythonBridge) InferFrame(framePath string, roi []int) ([]YOLODetection, error) {
	if !b.ready {
		return nil, fmt.Errorf("service not ready")
	}
	
	b.mu.Lock()
	defer b.mu.Unlock()
	
	// Build command
	cmd := map[string]interface{}{
		"action":     "infer",
		"frame_path": framePath,
	}
	if len(roi) == 4 {
		cmd["roi"] = roi
	}
	
	// Send command
	if err := b.sendCommand(cmd); err != nil {
		return nil, err
	}
	
	// Read response
	response, err := b.readResponse()
	if err != nil {
		return nil, err
	}
	
	if response.Error != "" {
		return nil, fmt.Errorf("inference error: %s", response.Error)
	}
	
	return response.Detections, nil
}

// AnnotateFrame requests frame annotation
func (b *YOLOPythonBridge) AnnotateFrame(framePath string, detections []YOLODetection, outputPath string) error {
	if !b.ready {
		return fmt.Errorf("service not ready")
	}
	
	b.mu.Lock()
	defer b.mu.Unlock()
	
	cmd := map[string]interface{}{
		"action":      "annotate",
		"frame_path":  framePath,
		"detections":  detections,
		"output_path": outputPath,
	}
	
	if err := b.sendCommand(cmd); err != nil {
		return err
	}
	
	response, err := b.readResponse()
	if err != nil {
		return err
	}
	
	if response.Error != "" {
		return fmt.Errorf("annotation error: %s", response.Error)
	}
	
	return nil
}

// sendCommand sends JSON command to Python
func (b *YOLOPythonBridge) sendCommand(cmd map[string]interface{}) error {
	data, err := json.Marshal(cmd)
	if err != nil {
		return err
	}
	
	_, err = b.stdin.Write(append(data, '\n'))
	return err
}

// readResponse reads JSON response from Python
func (b *YOLOPythonBridge) readResponse() (*YOLODetectionResponse, error) {
	line, err := b.stdout.ReadString('\n')
	if err != nil {
		return nil, err
	}
	
	var response YOLODetectionResponse
	if err := json.Unmarshal([]byte(line), &response); err != nil {
		return nil, err
	}
	
	return &response, nil
}

// logStderr logs Python stderr
func (b *YOLOPythonBridge) logStderr() {
	scanner := bufio.NewScanner(b.stderr)
	for scanner.Scan() {
		log.Printf("[Python STDERR] %s", scanner.Text())
	}
}

// Close shuts down the Python service
func (b *YOLOPythonBridge) Close() error {
	if b.stdin != nil {
		b.stdin.Close()
	}
	if b.cmd != nil && b.cmd.Process != nil {
		b.cmd.Process.Kill()
		b.cmd.Wait()
	}
	log.Println("[INFO] Python YOLO service stopped")
	return nil
}
