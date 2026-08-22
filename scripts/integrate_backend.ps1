# DrishtiAI Backend Integration Script
# This script processes Python output with Golang backend and prepares frontend data

Write-Host "=== DrishtiAI Backend Integration ===" -ForegroundColor Green
Write-Host ""

# Check if Python pipeline completed
$eventsFile = "pipeline_out\cctv_video\events\events.json"
if (-not (Test-Path $eventsFile)) {
    Write-Host "ERROR: Python pipeline not complete. Missing events.json" -ForegroundColor Red
    Write-Host "Run: python m1_7/run_pipeline.py '04.CCTV Candidate Talking.mkv' --out-dir pipeline_out/cctv_video" -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ Python pipeline output found" -ForegroundColor Green

# Refresh PATH to get Go
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Check if Go is available
Write-Host "Checking Go installation..." -ForegroundColor Yellow
try {
    $goVersion = go version 2>$null
    Write-Host "✓ Go found: $goVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Go not found in PATH" -ForegroundColor Red
    Write-Host "Attempting to locate Go..." -ForegroundColor Yellow
    
    # Common Go installation paths
    $goPaths = @(
        "C:\Go\bin",
        "C:\Program Files\Go\bin",
        "$env:USERPROFILE\go\bin",
        "C:\ProgramData\chocolatey\lib\golang\tools\go\bin"
    )
    
    $goFound = $false
    foreach ($goPath in $goPaths) {
        if (Test-Path "$goPath\go.exe") {
            Write-Host "✓ Found Go at: $goPath" -ForegroundColor Green
            $env:Path += ";$goPath"
            $goFound = $true
            break
        }
    }
    
    if (-not $goFound) {
        Write-Host "ERROR: Go not installed. Install from: https://go.dev/dl/" -ForegroundColor Red
        Write-Host "Using mock backend instead..." -ForegroundColor Yellow
        python mock_backend/generate_mock_data.py
        Copy-Item "enriched_events.json" -Destination "public\api\events.json" -Force
        Write-Host "✓ Mock data generated" -ForegroundColor Green
        exit 0
    }
}

# Build Golang backend
Write-Host ""
Write-Host "Building Golang backend..." -ForegroundColor Yellow
cd m8_9_golang

try {
    go build -o drishti-backend.exe
    Write-Host "✓ Golang backend built successfully" -ForegroundColor Green
} catch {
    Write-Host "✗ Build failed" -ForegroundColor Red
    cd ..
    exit 1
}

# Run Golang backend
Write-Host ""
Write-Host "Running Golang backend (Modules 8-9)..." -ForegroundColor Yellow
Write-Host "Processing person detection and object detection..." -ForegroundColor Cyan

.\drishti-backend.exe `
    --events-json ..\pipeline_out\cctv_video\events\events.json `
    --rois-json ..\pipeline_out\cctv_video\rois\rois_per_frame.json `
    --header-json ..\pipeline_out\cctv_video\header.json `
    --frames-dir ..\pipeline_out\cctv_video\frames `
    --out-dir ..\pipeline_out\cctv_video\backend_output

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Golang backend completed successfully" -ForegroundColor Green
} else {
    Write-Host "✗ Golang backend failed" -ForegroundColor Red
    cd ..
    exit 1
}

cd ..

# Copy output to frontend API
Write-Host ""
Write-Host "Integrating with frontend..." -ForegroundColor Yellow

$backendOutput = "pipeline_out\cctv_video\backend_output\enriched_events.json"
if (Test-Path $backendOutput) {
    # Create public API directory if it doesn't exist
    if (-not (Test-Path "public\api")) {
        New-Item -ItemType Directory -Path "public\api" -Force | Out-Null
    }
    
    Copy-Item $backendOutput -Destination "public\api\events.json" -Force
    Copy-Item $backendOutput -Destination "pipeline_out\cctv_video\api_response.json" -Force
    Write-Host "✓ Backend data integrated with frontend" -ForegroundColor Green
} else {
    Write-Host "✗ Backend output not found" -ForegroundColor Red
    exit 1
}

# Create video metadata for frontend
Write-Host ""
Write-Host "Creating video metadata..." -ForegroundColor Yellow

$videoMetadata = @{
    videoId = "04.CCTV Candidate Talking.mkv"
    videoPath = "04.CCTV Candidate Talking.mkv"
    originalPath = (Get-Item "04.CCTV Candidate Talking.mkv").FullName
    pipelineOutput = (Get-Item "pipeline_out\cctv_video").FullName
    processed = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
} | ConvertTo-Json

$videoMetadata | Out-File "pipeline_out\cctv_video\video_metadata.json" -Encoding UTF8

# Summary
Write-Host ""
Write-Host "=== INTEGRATION COMPLETE ===" -ForegroundColor Green
Write-Host ""
Write-Host "✓ Python pipeline: Modules 1-7" -ForegroundColor Green
Write-Host "✓ Golang backend: Modules 8-9" -ForegroundColor Green
Write-Host "✓ Frontend API: Updated" -ForegroundColor Green
Write-Host ""
Write-Host "Output files:" -ForegroundColor Cyan
Write-Host "  - Backend output: pipeline_out\cctv_video\backend_output\enriched_events.json"
Write-Host "  - Frontend API:   public\api\events.json"
Write-Host "  - Video metadata: pipeline_out\cctv_video\video_metadata.json"
Write-Host ""
Write-Host "Original video: 04.CCTV Candidate Talking.mkv" -ForegroundColor Cyan
Write-Host "Pipeline output: pipeline_out\cctv_video\" -ForegroundColor Cyan
Write-Host ""
Write-Host "Frontend is running at: http://localhost:3000" -ForegroundColor Yellow
Write-Host ""
Write-Host "=== READY TO USE ===" -ForegroundColor Green
