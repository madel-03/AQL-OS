@echo off
setlocal
cd /d "%~dp0"
if exist "dist\local-bridge\AQL-Desktop\AQL-Desktop.exe" (
    start "" "dist\local-bridge\AQL-Desktop\AQL-Desktop.exe"
    exit /b 0
)
if not exist ".venv\Scripts\pythonw.exe" call setup.cmd
if errorlevel 1 exit /b 1
start "" ".venv\Scripts\pythonw.exe" web_desktop.py
