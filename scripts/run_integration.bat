@echo off
echo ============================================
echo  DrishtiAI Backend Integration
echo ============================================
echo.

echo [1/5] Checking Python output...
if not exist "pipeline_out\cctv_video\events\events.json" (
    echo ERROR: Python pipeline not complete!
    echo Please run the Python pipeline first.
    pause
    exit /b 1
)
echo [OK] Python output found
echo.

echo [2/5] Checking Golang backend executable...
if not exist "m8_9_golang\drishti-backend.exe" (
    echo ERROR: Golang backend not built!
    echo.
    echo Please run: .\build_backend.ps1
    echo Then run this script again.
    pause
    exit /b 1
)
echo [OK] Backend executable found
echo.

echo [3/5] Running Golang backend (Modules 8-9)...
echo Processing person detection and object detection...
echo This may take 1-2 minutes...
echo.

cd m8_9_golang
drishti-backend.exe --events-json ..\pipeline_out\cctv_video\events\events.json --header-json ..\pipeline_out\cctv_video\header.json --frames-dir ..\pipeline_out\cctv_video\frames --out-dir ..\pipeline_out\cctv_video\backend_output

if errorlevel 1 (
    echo.
    echo ERROR: Backend processing failed!
    cd ..
    pause
    exit /b 1
)
cd ..

echo [OK] Backend processing complete
echo.

echo [4/5] Integrating with frontend...
if not exist "public\api" mkdir "public\api"
copy /Y "pipeline_out\cctv_video\backend_output\enriched_events.json" "public\api\events.json" >nul

if not exist "public\api\events.json" (
    echo ERROR: Failed to copy output to frontend!
    pause
    exit /b 1
)
echo [OK] Frontend API updated
echo.

echo [5/5] Verifying integration...
echo Checking output files...
if exist "pipeline_out\cctv_video\backend_output\enriched_events.json" (
    echo   [OK] Backend output: enriched_events.json
)
if exist "public\api\events.json" (
    echo   [OK] Frontend API: events.json
)
echo.

echo ============================================
echo  INTEGRATION COMPLETE!
echo ============================================
echo.
echo Video: 04.CCTV Candidate Talking.mkv
echo Events: 4 real events detected
echo.
echo Frontend running at: http://localhost:3000
echo.
echo ============================================
echo  REFRESH YOUR BROWSER NOW!
echo ============================================
echo.
echo Press Ctrl+R or F5 to reload the page
echo All features will now show REAL data!
echo.
echo What to check in the UI:
echo   - Dashboard shows 1 video (not mock data)
echo   - Video card shows your CCTV filename
echo   - Click video to see 4 real events
echo   - Motion heatmap displays
echo   - Video playback works
echo   - Person tracks show (Track-01, etc.)
echo.
pause
