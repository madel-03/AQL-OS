# AQL for Windows

Run setup.cmd and start.cmd to open the published site inside the Windows app.
The embedded browser has its own persistent profile, so sign in there if prompted.
Closing the window hides it in the system tray. Use the tray menu to restore it,
toggle the floating button during minimization, or quit. Build.cmd packages the
desktop app into dist\polished\AQL-Desktop. Use installer.iss to package that folder.
## Optional local assistant

The native desktop client uses Python 3.12, Qt Quick Controls and SQLite. Main.qml owns the window, app.py coordinates user actions on the Qt thread, providers.py streams on a background thread, and store.py owns local persistence. Run these commands from this folder on Windows.

```bat
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m unittest discover
.venv\Scripts\python app.py
```

Ollama defaults to qwen3:0.6b on localhost port 11434. Install the model with `ollama pull qwen3:0.6b` if needed. Choose another installed model in settings. For cloud providers enter an enabled model ID and API key. Keys are stored in Windows Credential Manager under the legacy credential namespace AYO AI. Sending a cloud chat transmits that conversation to the selected service. History and settings live in %LOCALAPPDATA%\AYO AI\history.sqlite.

Run build-local.cmd to generate dist\AQL\AQL.exe. Distribute the entire containing folder. A Windows installer can package that folder and create a shortcut to the executable.

Foundation supports streamed Arabic and English text conversations, local history search, provider/model settings and text selection for copying. Cancellation stops displaying tokens immediately. The worker completes at the next event or read timeout. Existing Jarvis voice tooling is a separate process. Desktop automation, attachments, Office tools, memory and scheduled workflows are separate development stages.

## Available desktop tools

Use the island button to open the draggable compact window, then + to expand the command field. Enter sends to the current chat. Ctrl+I toggles the island while the app has focus. Exclusive fullscreen games may cover the overlay.

Attach a text PDF, DOCX, XLSX or UTF-8 text file, then type a question. Sending includes the extracted text in the selected provider's conversation. Export the last assistant answer using Save reply. DOCX paragraphs and XLSX rows are plain text. Scanned pages require a separate OCR workflow. Attachments are limited to 20 MB and 40000 extracted characters.

Organize folder offers a preview, moves individual files by extension after approval and supports undo for the most recent batch during this session. Action planning separately offers reviewed steps for Calculator, Notepad, standard folders and browser search. These steps launch the target and report launch errors. They do not verify the final contents of the target window.

Dictation uses the existing local AQL Whisper installation. Run the parent backend/setup-jarvis-voice.cmd if needed. Click the microphone, speak in Arabic, review the resulting text, then send. Typing works without the voice installation.

Compile installer.iss using Inno Setup 6 after running build.cmd to prepare a per-user installer with Start menu integration. The build is unsigned.

## Remaining scope

General browser workflows, screen vision, OCR, advanced Office editing, global keyboard activation/emergency stop, hands-free wake, scheduled tasks, opt-in memory, bilingual UI switching and installer signing are pending. Chat accepts both languages. Cloud models require an account and a model ID enabled there.



## Jarvis while the window is hidden

Right-click the tray icon and enable the Jarvis wake option. The microphone
stays active until you disable it or quit. Say "يا جارفس، ترجم الشاشة",
or say the wake phrase and follow with your request within ten seconds.
Screen requests capture the monitor under the pointer and send one image
to local Ollama. The app uses Windows text-to-speech for its reply.

Requirements are the existing local Whisper setup, a Windows speaking voice,
and a running Ollama service with qwen3:0.6b and qwen2.5vl:3b installed.
The wake listener starts disabled on each launch.




If the web view fails to load, use the retry or browser button. The desktop
microphone remains available from the toolbar or tray. Its level bar confirms
that audio reaches the local listener. The tray can reopen the last reply.

For screen translation, Windows OCR first tries to read visible text locally.
If OCR finds no text, AQL uses the Ollama vision model. Screen description
uses the vision model directly. The OCR language depends on installed Windows
language support. Screen translation and description work on one capture.
For a read-screen request, recognized text is also available directly via Windows OCR.
