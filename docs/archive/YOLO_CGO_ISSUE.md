# YOLO CGO Compilation Issue

## Problem

The `onnxruntime_go` package requires CGO (C bindings), which needs a 64-bit C compiler. The current system's GCC doesn't support 64-bit mode.

## Error

```
cc1.exe: sorry, unimplemented: 64-bit mode not compiled in
```

## Solutions

### Option 1: Install MinGW-w64 (Recommended)

1. Download MinGW-w64:
   - URL: https://winlibs.com/
   - Get: winlibs-x86_64-posix-seh-gcc-*.7z
   - Or: https://github.com/niXman/mingw-builds-binaries/releases

2. Extract to: `C:\mingw64\`

3. Add to PATH:
   ```powershell
   $env:PATH = "C:\mingw64\bin;$env:PATH"
   ```

4. Verify:
   ```powershell
   gcc --version
   # Should show x86_64
   ```

5. Rebuild:
   ```powershell
   cd m8_9_golang
   go build -o drishti-backend.exe
   ```

### Option 2: Use TDM-GCC

1. Download: https://jmeubank.github.io/tdm-gcc/
2. Install TDM-GCC (select 64-bit)
3. Add to PATH
4. Rebuild

### Option 3: Pure Go Implementation (Fallback)

If CGO setup is too complex, we can:

1. Use a pure Go ONNX runtime (slower but works):
   ```go
   github.com/owulveryck/onnx-go
   ```

2. Or temporarily use enhanced mock mode until CGO is resolved

### Option 4: Pre-built Binary

Use pre-compiled onnxruntime DLL with FFI:
- Download onnxruntime.dll
- Use `syscall` package for direct DLL calls (more complex)

## Current Workaround

For immediate progress, I can create a version that:
1. Compiles without CGO
2. Uses intelligent mock mode
3. Has all hooks ready for real YOLO when CGO is fixed

## Recommended Path Forward

**Short-term** (5 minutes):
1. Install MinGW-w64 from winlibs.com
2. Add to PATH
3. Rebuild

**Long-term** (if CGO issues persist):
1. Consider using Python for YOLO inference
2. Call Python script from Go
3. Go handles tracking/processing, Python handles detection

## Testing CGO

```powershell
# Test if CGO works
cd m8_9_golang
$env:CGO_ENABLED="1"
go env CGO_ENABLED
# Should show: 1

# Test GCC
gcc -v
# Should show x86_64 target
```

## Files Needed

Once CGO works, you'll also need:
- `onnxruntime.dll` (Windows ONNX Runtime)
- `yolov8n.onnx` (YOLO model)

Both can be downloaded per REAL_YOLO_SETUP.md instructions.
