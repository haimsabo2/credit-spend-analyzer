@echo off
call "%~dp0config.bat"

echo Stopping Credit Spend Analyzer processes...

call :kill_port %CSA_BACKEND_PORT% "backend"
call :kill_port %CSA_FRONTEND_PORT% "frontend"

echo Done.
exit /b 0

:kill_port
set "PORT=%~1"
set "LABEL=%~2"
set "FOUND=0"

for /f "tokens=5" %%P in ('netstat -aon ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  set "FOUND=1"
  echo Stopping %LABEL% - PID %%P, port %PORT%...
  taskkill /F /PID %%P >nul 2>&1
)

if "%FOUND%"=="0" echo No %LABEL% process listening on port %PORT%.
exit /b 0
