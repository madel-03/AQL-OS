@echo off
setlocal
cd /d "%~dp0"
set "PYINSTALLER_CONFIG_DIR=%CD%\build\cache"
.venv\Scripts\python.exe -m PyInstaller --noconfirm --onedir --distpath dist\hybrid-analysis --windowed --name AQL-Desktop --icon assets/aql.ico --add-data "assets/aql.ico;assets" --add-data "../jarvis-listen.py;." web_desktop.py
if errorlevel 1 exit /b 1
copy /Y "dist\hybrid-analysis\AQL-Desktop\_internal\PySide6\*140*.dll" "dist\hybrid-analysis\AQL-Desktop\_internal\"
if exist "dist\hybrid-analysis\AQL-Desktop\_internal\icuuc.dll" ren "dist\hybrid-analysis\AQL-Desktop\_internal\icuuc.dll" icuuc.dll.unused
