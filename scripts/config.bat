@echo off
REM Shared settings for Credit Spend Analyzer startup scripts.
REM Override any value before calling these scripts, e.g.:
REM   set CSA_MODE=service
REM   set CSA_BACKEND_PORT=8000

REM Resolve repo root from this file's location (must not use parens block — breaks %VAR% expansion).
if not defined CSA_ROOT for %%I in ("%~dp0..") do set "CSA_ROOT=%%~fI"

set "CSA_BACKEND_DIR=%CSA_ROOT%\backend"
set "CSA_FRONTEND_DIR=%CSA_ROOT%\frontend"
set "CSA_LOG_DIR=%CSA_ROOT%\logs"

if not defined CSA_BACKEND_PORT set "CSA_BACKEND_PORT=8000"
if not defined CSA_FRONTEND_PORT set "CSA_FRONTEND_PORT=5173"
if not defined CSA_BACKEND_HOST set "CSA_BACKEND_HOST=0.0.0.0"
if not defined CSA_FRONTEND_HOST set "CSA_FRONTEND_HOST=127.0.0.1"

REM dev     = uvicorn --reload + vite dev server (interactive development)
REM service = uvicorn + vite preview (no reload; suitable for NSSM / WinSW)
if not defined CSA_MODE set "CSA_MODE=dev"

if exist "%CSA_ROOT%\.venv\Scripts\python.exe" (
  set "CSA_PYTHON=%CSA_ROOT%\.venv\Scripts\python.exe"
) else (
  set "CSA_PYTHON=python"
)

if not exist "%CSA_LOG_DIR%" mkdir "%CSA_LOG_DIR%"
