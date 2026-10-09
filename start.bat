@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or later is required. Install Node.js, then try again.
  pause
  exit /b 1
)
node scripts\dev.mjs --open
if errorlevel 1 (
  echo.
  echo The preview did not start. Read the message above for the next step.
  pause
  exit /b 1
)
