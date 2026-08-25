@echo off
setlocal
call "%~dp0config.bat"

cd /d "%CSA_BACKEND_DIR%" || (
  echo ERROR: Backend folder not found: %CSA_BACKEND_DIR%
  exit /b 1
)

echo [%date% %time%] Starting backend (%CSA_MODE%) on %CSA_BACKEND_HOST%:%CSA_BACKEND_PORT%
echo Using Python: %CSA_PYTHON%

if /i "%CSA_MODE%"=="service" (
  "%CSA_PYTHON%" -m uvicorn app.main:app --host %CSA_BACKEND_HOST% --port %CSA_BACKEND_PORT% >> "%CSA_LOG_DIR%\backend.log" 2>&1
) else (
  "%CSA_PYTHON%" -m uvicorn app.main:app --reload --host %CSA_BACKEND_HOST% --port %CSA_BACKEND_PORT%
)

if errorlevel 1 (
  echo.
  echo Backend failed to start. Common fixes:
  echo   1. Create venv:  python -m venv .venv
  echo   2. Activate and install:  .venv\Scripts\activate ^&^& pip install -r backend\requirements.txt
  echo   3. Or install globally:  pip install -r backend\requirements.txt
  if /i not "%CSA_MODE%"=="service" pause
  exit /b 1
)

endlocal
