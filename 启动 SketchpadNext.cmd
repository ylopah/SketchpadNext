@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [SketchpadNext] Node.js was not found.
    echo Install Node.js and run this launcher again.
    pause
    exit /b 1
)

echo.
echo [SketchpadNext] Starting local server...
echo [SketchpadNext] URL: http://127.0.0.1:4173
echo [SketchpadNext] Keep this window open while using the app.
echo.

set "SKETCHPAD_OPEN_BROWSER=1"
node server.mjs

echo.
echo [SketchpadNext] The server stopped or failed to start.
echo Check that Node.js is installed and port 4173 is available.
pause
endlocal
