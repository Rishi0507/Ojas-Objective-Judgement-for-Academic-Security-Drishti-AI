# Download YOLOv8n ONNX model for real inference
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   Downloading YOLOv8n ONNX Model" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$modelDir = "m8_9_golang\models"
$modelPath = "$modelDir\yolov8n.onnx"
$modelUrl = "https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.onnx"

# Create models directory
if (-not (Test-Path $modelDir)) {
    Write-Host "[1/3] Creating models directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $modelDir | Out-Null
    Write-Host "[OK] Directory created: $modelDir" -ForegroundColor Green
} else {
    Write-Host "[1/3] Models directory exists" -ForegroundColor Green
}

# Check if model already exists
if (Test-Path $modelPath) {
    $size = (Get-Item $modelPath).Length / 1MB
    Write-Host "[2/3] Model already exists: $modelPath ($([math]::Round($size, 2)) MB)" -ForegroundColor Green
    Write-Host ""
    Write-Host "Model is ready to use!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Download ONNX Runtime DLL (see instructions below)" -ForegroundColor White
    Write-Host "2. Run: .\build_backend.ps1" -ForegroundColor White
    Write-Host "3. Run: .\run_integration.bat" -ForegroundColor White
    Write-Host ""
    Write-Host "ONNX Runtime Setup:" -ForegroundColor Yellow
    Write-Host "Download from: https://github.com/microsoft/onnxruntime/releases" -ForegroundColor White
    Write-Host "Get: onnxruntime-win-x64-*.zip" -ForegroundColor White
    Write-Host "Extract: onnxruntime.dll to m8_9_golang\ folder" -ForegroundColor White
    exit 0
}

# Download model
Write-Host "[2/3] Downloading YOLOv8n model (~6 MB)..." -ForegroundColor Yellow
Write-Host "URL: $modelUrl" -ForegroundColor Gray

try {
    Invoke-WebRequest -Uri $modelUrl -OutFile $modelPath -UseBasicParsing
    Write-Host "[OK] Model downloaded successfully" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Failed to download model: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Manual download:" -ForegroundColor Yellow
    Write-Host "1. Visit: $modelUrl" -ForegroundColor White
    Write-Host "2. Save as: $modelPath" -ForegroundColor White
    exit 1
}

# Verify download
if (Test-Path $modelPath) {
    $size = (Get-Item $modelPath).Length / 1MB
    Write-Host "[3/3] Verification:" -ForegroundColor Yellow
    Write-Host "  Path: $modelPath" -ForegroundColor White
    Write-Host "  Size: $([math]::Round($size, 2)) MB" -ForegroundColor White
    
    if ($size -lt 3) {
        Write-Host "[ERROR] File size too small, download may be corrupted" -ForegroundColor Red
        exit 1
    }
    
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "   YOLOv8n Model Ready!" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "IMPORTANT: Download ONNX Runtime DLL" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Step 1: Download ONNX Runtime" -ForegroundColor Cyan
    Write-Host "  URL: https://github.com/microsoft/onnxruntime/releases" -ForegroundColor White
    Write-Host "  Get: onnxruntime-win-x64-1.16.0.zip (or latest)" -ForegroundColor White
    Write-Host ""
    Write-Host "Step 2: Extract DLL" -ForegroundColor Cyan
    Write-Host "  From: lib\onnxruntime.dll" -ForegroundColor White
    Write-Host "  To:   m8_9_golang\onnxruntime.dll" -ForegroundColor White
    Write-Host ""
    Write-Host "Step 3: Build and Run" -ForegroundColor Cyan
    Write-Host "  .\build_backend.ps1" -ForegroundColor White
    Write-Host "  .\run_integration.bat" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "[ERROR] Download verification failed" -ForegroundColor Red
    exit 1
}
