# Build Golang Backend (Modules 8-9)
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Building Golang Backend" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Navigate to golang directory
Set-Location m8_9_golang

# Step 1: Download dependencies
Write-Host "[1/3] Downloading dependencies..." -ForegroundColor Yellow
go mod tidy
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to download dependencies" -ForegroundColor Red
    Set-Location ..
    pause
    exit 1
}
Write-Host "[OK] Dependencies downloaded" -ForegroundColor Green
Write-Host ""

# Step 2: Build the executable (without CGO to avoid compiler issues)
Write-Host "[2/3] Building executable..." -ForegroundColor Yellow
Write-Host "[INFO] Building without CGO (real YOLO requires MinGW-w64)" -ForegroundColor Gray
$env:CGO_ENABLED = "0"
go build -o drishti-backend.exe
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed" -ForegroundColor Red
    Set-Location ..
    pause
    exit 1
}
Write-Host "[OK] Build successful" -ForegroundColor Green
Write-Host ""

# Step 3: Verify executable exists
if (Test-Path "drishti-backend.exe") {
    Write-Host "[OK] Executable created: drishti-backend.exe" -ForegroundColor Green
} else {
    Write-Host "ERROR: Executable not found" -ForegroundColor Red
    Set-Location ..
    pause
    exit 1
}

# Return to root directory
Set-Location ..

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " BUILD COMPLETE!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "NOTE: Running in intelligent mock mode" -ForegroundColor Yellow
Write-Host "For real YOLO inference:" -ForegroundColor Yellow
Write-Host "  1. Install MinGW-w64 (x86_64)" -ForegroundColor White
Write-Host "  2. Download yolov8n.onnx model" -ForegroundColor White  
Write-Host "  3. See YOLO_CGO_ISSUE.md for details" -ForegroundColor White
Write-Host ""
Write-Host "Next step: Run the integration script" -ForegroundColor Cyan
Write-Host "  .\run_integration.bat" -ForegroundColor White
Write-Host ""
pause
