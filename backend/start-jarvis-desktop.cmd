@echo off
powershell.exe -NoProfile -STA -ExecutionPolicy RemoteSigned -File "%~dp0jarvis-desktop.ps1"
if errorlevel 1 pause
