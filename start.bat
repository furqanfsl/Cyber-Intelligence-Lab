@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or later is required. Install Node.js, then try again.
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Check your Node.js installation.
  exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) < 24) { console.error('Node.js 24 or later is required.'); process.exit(1); }"
if errorlevel 1 exit /b 1
call npm ci
if errorlevel 1 (
  echo Dependency installation failed. The development server was not started.
  exit /b 1
)
call npm run dev
exit /b %errorlevel%
