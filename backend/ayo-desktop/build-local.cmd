@echo off
cd /d "%~dp0"
.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean --onedir --windowed --name AQL --exclude-module numpy --exclude-module onnxruntime --exclude-module PySide6.QtWebEngineCore --add-data "../jarvis-listen.py;." --icon assets/aql.ico --add-data "assets;assets" --add-data "Main.qml;." app.py

if errorlevel 1 exit /b 1
copy /Y "dist\AQL\_internal\PySide6\*140*.dll" "dist\AQL\_internal\"
if exist "dist\AQL\_internal\icuuc.dll" ren "dist\AQL\_internal\icuuc.dll" icuuc.dll.unused
