@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo [SketchpadNext] Node.js was not found.
    pause
    exit /b 1
)
set "SKETCHPAD_OPEN_BROWSER=1"
node server.mjs
pause
endlocal
