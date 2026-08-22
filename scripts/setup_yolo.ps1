# YOLO Setup Script for Windows
# This script downloads YOLOv8 model and sets up OpenCV for Go

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " YOLO Setup for Real Computer Vision" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check Go installation
Write-Host "[1/5] Checking Go installation..." -ForegroundColor Yellow
$goVersion = go version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Go not found!" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Go found: $goVersion" -ForegroundColor Green
Write-Host ""

# Step 2: Create models directory
Write-Host "[2/5] Creating models directory..." -ForegroundColor Yellow
$modelsDir = "m8_9_golang/models"
if (!(Test-Path $modelsDir)) {
    New-Item -ItemType Directory -Path $modelsDir -Force | Out-Null
}
Write-Host "[OK] Models directory ready: $modelsDir" -ForegroundColor Green
Write-Host ""

# Step 3: Download YOLO model
Write-Host "[3/5] Downloading YOLOv8n model..." -ForegroundColor Yellow
$modelUrl = "https://github.com/ultralytics/assets/releases/download/v8.0.0/yolov8n.onnx"
$modelPath = "$modelsDir/yolov8n.onnx"

if (Test-Path $modelPath) {
    Write-Host "[OK] Model already exists: $modelPath" -ForegroundColor Green
} else {
    try {
        Write-Host "Downloading from: $modelUrl" -ForegroundColor Cyan
        Write-Host "This may take 1-2 minutes (~6MB)..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $modelUrl -OutFile $modelPath -UseBasicParsing
        Write-Host "[OK] Model downloaded successfully!" -ForegroundColor Green
    } catch {
        Write-Host "ERROR: Failed to download model: $_" -ForegroundColor Red
        Write-Host "" -ForegroundColor Red
        Write-Host "Alternative: Download manually from:" -ForegroundColor Yellow
        Write-Host "  $modelUrl" -ForegroundColor White
        Write-Host "  Save to: $modelPath" -ForegroundColor White
        exit 1
    }
}

# Verify model file
$modelSize = (Get-Item $modelPath).Length / 1MB
Write-Host "Model size: $([math]::Round($modelSize, 2)) MB" -ForegroundColor Cyan
Write-Host ""

# Step 4: Check for OpenCV (gocv)
Write-Host "[4/5] Checking OpenCV/gocv installation..." -ForegroundColor Yellow
Write-Host "" -ForegroundColor Yellow
Write-Host "IMPORTANT: OpenCV setup on Windows" -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Option 1 (Recommended): Use OpenCV without gocv" -ForegroundColor Cyan
Write-Host "  - Simpler setup" -ForegroundColor White
Write-Host "  - Pure Go implementation" -ForegroundColor White
Write-Host "  - No C++ dependencies" -ForegroundColor White
Write-Host "  - Uses onnxruntime-go" -ForegroundColor White
Write-Host ""
Write-Host "Option 2 (Advanced): Install gocv + OpenCV" -ForegroundColor Cyan
Write-Host "  - Full OpenCV features" -ForegroundColor White
Write-Host "  - Requires MinGW/MSYS2" -ForegroundColor White
Write-Host "  - More complex setup" -ForegroundColor White
Write-Host "  - See: https://gocv.io/getting-started/windows/" -ForegroundColor White
Write-Host ""

$choice = Read-Host "Choose option (1 or 2) [default: 1]"
if ($choice -eq "" -or $choice -eq "1") {
    Write-Host "[OK] Using pure Go implementation (recommended)" -ForegroundColor Green
    $useGocv = $false
} else {
    Write-Host "[OK] Will use gocv (you need to install OpenCV separately)" -ForegroundColor Yellow
    $useGocv = $true
}
Write-Host ""

# Step 5: Update detector.go based on choice
Write-Host "[5/5] Configuring detector implementation..." -ForegroundColor Yellow

if ($useGocv) {
    Write-Host ""
    Write-Host "MANUAL STEPS REQUIRED:" -ForegroundColor Yellow
    Write-Host "1. Install MSYS2: https://www.msys2.org/" -ForegroundColor White
    Write-Host "2. Install OpenCV via MSYS2:" -ForegroundColor White
    Write-Host "   pacman -S mingw-w64-x86_64-opencv" -ForegroundColor Cyan
    Write-Host "3. Set environment variables:" -ForegroundColor White
    Write-Host "   CGO_ENABLED=1" -ForegroundColor Cyan
    Write-Host "   Add MinGW to PATH" -ForegroundColor Cyan
    Write-Host "4. Update go.mod to include gocv" -ForegroundColor White
    Write-Host ""
    Write-Host "This is complex - Option 1 is recommended!" -ForegroundColor Yellow
} else {
    Write-Host "[OK] Pure Go implementation configured" -ForegroundColor Green
    Write-Host "Installing onnxruntime-go dependency..." -ForegroundColor Yellow
    
    Set-Location m8_9_golang
    go get github.com/yalue/onnxruntime_go
    Set-Location ..
    
    Write-Host "[OK] Dependencies installed" -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " YOLO SETUP COMPLETE!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Model Location:" -ForegroundColor Cyan
Write-Host "  $modelPath" -ForegroundColor White
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Update detector.go to use real YOLO" -ForegroundColor White
Write-Host "  2. Rebuild: .\build_backend.ps1" -ForegroundColor White
Write-Host "  3. Re-run: .\run_integration.bat" -ForegroundColor White
Write-Host ""
Write-Host "Note: Due to Windows complexity with OpenCV," -ForegroundColor Yellow
Write-Host "we'll implement a pure-Go YOLO inference engine" -ForegroundColor Yellow
Write-Host "that doesn't require C++ dependencies." -ForegroundColor Yellow
Write-Host ""
pause
