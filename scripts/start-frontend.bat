@echo off
setlocal
call "%~dp0config.bat"

cd /d "%CSA_FRONTEND_DIR%" || (
  echo ERROR: Frontend folder not found: %CSA_FRONTEND_DIR%
  exit /b 1
)

where npm >nul 2>&1 || (
  echo ERROR: npm not found on PATH. Install Node.js first.
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing frontend dependencies...
  call npm install || exit /b 1
)

echo [%date% %time%] Starting frontend (%CSA_MODE%) on http://%CSA_FRONTEND_HOST%:%CSA_FRONTEND_PORT%

if /i "%CSA_MODE%"=="service" (
  if not exist "dist\index.html" (
    echo Building frontend for service mode...
    call npm run build || exit /b 1
  )
  call npm run preview -- --host %CSA_FRONTEND_HOST% --port %CSA_FRONTEND_PORT% >> "%CSA_LOG_DIR%\frontend.log" 2>&1
) else (
  call npm run dev -- --host %CSA_FRONTEND_HOST% --port %CSA_FRONTEND_PORT%
)

if errorlevel 1 (
  echo.
  echo Frontend failed to start.
  if /i not "%CSA_MODE%"=="service" pause
  exit /b 1
)

endlocal
