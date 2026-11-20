@echo off
cd /d "%~dp0"
node windows-companion.js
if errorlevel 1 pause
