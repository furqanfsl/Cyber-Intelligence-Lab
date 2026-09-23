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
rem Reopen this project's existing Vite preview instead of launching a duplicate.
node -e "fetch('http://127.0.0.1:5173/', { signal: AbortSignal.timeout(2000) }).then(async r => { const html = await r.text(); process.exit(r.ok && html.includes('/@vite/client') && html.includes('<title>Cyber Intelligence Lab</title>') ? 0 : 1); }).catch(() => process.exit(1));"
if not errorlevel 1 (
  echo Cyber Intelligence Lab is already running. Opening the preview.
  start "" "http://127.0.0.1:5173/"
  exit /b 0
)
if not exist "node_modules\.bin\vite.cmd" (
  call npm ci
  if errorlevel 1 (
    echo Dependency installation failed. The development server was not started.
    pause
    exit /b 1
  )
)
echo Starting Cyber Intelligence Lab at http://127.0.0.1:5173/
echo Keep this window open while using the preview. Press Ctrl+C to stop.
call npm run dev -- --open
if errorlevel 1 (
  echo The preview could not start. If it is already running, open http://127.0.0.1:5173/
  pause
  exit /b 1
)
