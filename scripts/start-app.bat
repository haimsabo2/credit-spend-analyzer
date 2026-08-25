@echo off
call "%~dp0config.bat"

echo ============================================
echo  Credit Spend Analyzer
echo  Mode: %CSA_MODE%
echo ============================================
echo  Backend:  http://127.0.0.1:%CSA_BACKEND_PORT%
echo  Frontend: http://%CSA_FRONTEND_HOST%:%CSA_FRONTEND_PORT%
echo ============================================
echo.

if /i "%CSA_MODE%"=="service" (
  echo Service mode: run start-backend.bat and start-frontend.bat separately.
  echo This launcher is for interactive dev; use NSSM/WinSW on the individual scripts.
  exit /b 1
)

start "CSA Backend" cmd /k call "%~dp0start-backend.bat"
timeout /t 3 /nobreak >nul
start "CSA Frontend" cmd /k call "%~dp0start-frontend.bat"

echo.
echo Launched backend and frontend in separate windows.
echo Close those windows (or run stop-app.bat) to shut down.
echo.
echo --- Windows service setup (optional, later) ---
echo 1. Install NSSM: https://nssm.cc/download
echo 2. set CSA_MODE=service
echo 3. nssm install CSA-Backend "%~dp0start-backend.bat"
echo 4. nssm set CSA-Backend AppEnvironmentExtra CSA_MODE=service
echo 5. nssm install CSA-Frontend "%~dp0start-frontend.bat"
echo 6. nssm set CSA-Frontend AppEnvironmentExtra CSA_MODE=service
echo 7. nssm start CSA-Backend ^&^& nssm start CSA-Frontend
echo.
