@echo off
setlocal
set "BASE_PYTHON=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
set "VOICE_HOME=%LOCALAPPDATA%\AQL\voice"
if not exist "%BASE_PYTHON%" (
  echo Install Python 3.12 for your Windows user first.
  exit /b 1
)
"%BASE_PYTHON%" -m venv "%VOICE_HOME%" || exit /b 1
"%VOICE_HOME%\Scripts\python.exe" -m pip install faster-whisper sounddevice || exit /b 1
"%VOICE_HOME%\Scripts\python.exe" -c "import sys; from faster_whisper.utils import download_model; download_model('base', output_dir=sys.argv[1])" "%VOICE_HOME%\model" || exit /b 1
echo Arabic voice is ready. Restart Jarvis to enable it.
