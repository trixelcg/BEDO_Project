@echo off
title BEDO - local dev server
rem Runs the BEDO simulator locally. Double-click this file; keep the window open while you use the app.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed.
  echo  Install the LTS version from https://nodejs.org , then double-click this file again.
  echo.
  pause
  exit /b 1
)

echo Node version:
node -v
echo.

if not exist "node_modules" (
  echo Installing packages - first run only, this can take a few minutes...
  call npm ci
  if errorlevel 1 (
    echo.
    echo  npm ci failed - copy the red lines above and send them to Claude.
    pause
    exit /b 1
  )
)

echo.
echo Starting the dev server. When you see "Local: http://localhost:5173/" the app is ready.
echo Leave this window open. Close it to stop the server.
echo.
call npm run dev -- --port 5173
pause
