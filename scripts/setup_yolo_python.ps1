# Setup Real YOLO with Python
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   Setting Up Real YOLO (Python)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check Python
Write-Host "[1/3] Checking Python..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "  Found: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Python not found!" -ForegroundColor Red
    Write-Host "Please install Python 3.8+ from: https://www.python.org/downloads/" -ForegroundColor Yellow
    exit 1
}

# Install ultralytics
Write-Host ""
Write-Host "[2/3] Installing ultralytics (YOLO)..." -ForegroundColor Yellow
Write-Host "  This will download YOLOv8 and dependencies (~50 MB)" -ForegroundColor Gray
python -m pip install --upgrade pip -q
python -m pip install ultralytics opencv-python numpy -q

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to install ultralytics" -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] ultralytics installed" -ForegroundColor Green

# Test import
Write-Host ""
Write-Host "[3/3] Testing YOLO..." -ForegroundColor Yellow
$testScript = @"
from ultralytics import YOLO
import sys
try:
    model = YOLO('yolov8n.pt')
    print('OK')
except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
    sys.exit(1)
"@

$testResult = echo $testScript | python 2>&1
if ($testResult -match "OK") {
    Write-Host "  [OK] YOLO model ready" -ForegroundColor Green
} else {
    Write-Host "[ERROR] YOLO test failed: $testResult" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "   YOLO Setup Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Model: YOLOv8n (automatically downloaded)" -ForegroundColor White
Write-Host "Backend: Python ultralytics" -ForegroundColor White
Write-Host "Mode: Real neural network inference" -ForegroundColor White
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Build backend: .\build_backend.ps1" -ForegroundColor White
Write-Host "  2. Run integration: .\run_integration.bat" -ForegroundColor White
Write-Host ""
