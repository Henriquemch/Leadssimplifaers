@echo off
setlocal
cd /d "%~dp0.."

where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher not found. Install Python 3.12 or newer from python.org and try again.
  pause
  exit /b 1
)

echo Installing the free parser dependency if needed...
py -3 -m pip install --disable-pip-version-check openpyxl
if errorlevel 1 (
  echo Could not install openpyxl. Check your internet connection and Python installation.
  pause
  exit /b 1
)

echo.
echo Running SAFE DRY-RUN only. No database writes will be made.
set LEADPILOT_DRY_RUN=true
set LEADPILOT_WORKER_URL=
set INGEST_SECRET=
py -3 scripts\import-base-contracts.py
if errorlevel 1 (
  echo.
  echo Dry-run failed. Copy the error text and send it for diagnosis.
  pause
  exit /b 1
)

echo.
echo Dry-run completed. Copy the JSON summary above and send it for analysis.
pause
endlocal
