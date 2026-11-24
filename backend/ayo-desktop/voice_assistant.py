import base64
import json
import os
from pathlib import Path
import re
import threading
import unicodedata

import requests
from PySide6.QtCore import QByteArray, QBuffer, QIODevice, QObject, QProcess, Qt, QTimer, Signal
from PySide6.QtGui import QCursor
from PySide6.QtTextToSpeech import QTextToSpeech
from PySide6.QtWidgets import QApplication

from local_reply import HYBRID, OFFLINE, desktop_answer


SCREEN = re.compile(
    r"شاش[هة]|شاشتي|وش\s+(?:قدامي|مكتوب)|لوح[هة]\s+العرض|\bscreen\b", re.I
)
TRANSLATION = re.compile(r"ترجم|ترجمة|translate", re.I)
READ_TEXT = re.compile(r"وش\s+مكتوب|اقر[اأ]|أقر[اأ]|\bread\b", re.I)


def encode_frame(frame, max_edge):
    data = QByteArray()
    buffer = QBuffer(data)
    buffer.open(QIODevice.WriteOnly)
    if max(frame.width(), frame.height()) > max_edge:
        frame = frame.scaled(max_edge, max_edge, Qt.KeepAspectRatio, Qt.SmoothTransformation)
    return base64.b64encode(bytes(data)).decode("ascii") if frame.save(buffer, "JPG", 88) else None


def wake_request(text):
    characters = [(index, character) for index, character in enumerate(text)
                  if not unicodedata.combining(character) and character != "ـ"]
    normalized = "".join(character for _, character in characters)
    match = re.match(r"^[\s،.!]*(?:يا\s*)?(?:جار[فڤب]س|جارفيس|جرفس|jarvis)\b[\s،:,.!?؟-]*(.*)",
                     normalized, re.IGNORECASE)
    if not match:
        return None
    start = match.start(1)
    return text[characters[start][0]:].strip() if start < len(characters) else ""


class VoiceAssistant(QObject):
    status = Signal(str)
    answered = Signal(str)
    typed_answered = Signal(str)
    request_finished = Signal(int, str)
    mic_state = Signal(str)
    mic_level = Signal(int)
    stopped = Signal()

    def __init__(self, window):
        super().__init__(window)
        self.listener = QProcess(self)
        self.listener.readyReadStandardOutput.connect(self.read_transcripts)
        self.listener.finished.connect(self.on_exit)
        self.listener.errorOccurred.connect(self.on_error)
        self.speaker = QTextToSpeech("winrt", self) if "winrt" in QTextToSpeech.availableEngines() else QTextToSpeech(self)
        for locale in self.speaker.availableLocales():
            if locale.name().startswith("ar"):
                self.speaker.setLocale(locale)
                break
        self.speaker.setRate(-0.12)
        self.speaker.setPitch(-0.08)
        self.enabled = False
        self.busy = False
        self.typed_request = False
        self.request_id = 0
        self.listener_failure = None
        self.listener_stopping = False
        self.awaiting_request = False
        self.followup = QTimer(self)
        self.followup.setSingleShot(True)
        self.followup.timeout.connect(self.clear_followup)
        self.request_finished.connect(self.complete)

    def clear_followup(self):
        self.awaiting_request = False

    def enable(self, enabled):
        self.enabled = enabled
        self.awaiting_request = False
        if not enabled:
            if not self.typed_request:
                self.request_id += 1
                self.busy = False
            self.followup.stop()
            self.listener_stopping = self.listener.state() != QProcess.NotRunning
            self.listener.kill()
            self.speaker.stop()
            self.set_mic_state("المايك متوقف")
            return
        root = Path(os.environ["LOCALAPPDATA"]) / "AQL" / "voice"
        script = Path(__file__).resolve().with_name("jarvis-listen.py")
        if not script.exists():
            script = script.parent.parent / script.name
        python = root / "Scripts" / "python.exe"
        if not (python.is_file() and (root / "model/model.bin").is_file() and script.is_file()):
            self.set_mic_state("الصوت المحلي يحتاج إعداد")
            self.status.emit("شغّل setup-jarvis-voice.cmd لتجهيز الصوت المحلي")
            self.enabled = False
            self.stopped.emit()
            return
        self.listener_failure = None
        self.set_mic_state("جارٍ تشغيل المايك…")
        self.listener.setProgram(str(python))
        self.listener.setArguments([str(script), str(root / "model")])
        if self.listener.state() == QProcess.NotRunning:
            self.listener.start()

    def set_mic_state(self, label):
        self.mic_level.emit(0)
        self.mic_state.emit(label)
        self.status.emit(label)

    def on_error(self, error):
        if error == QProcess.FailedToStart:
            self.set_mic_state("تعذر تشغيل محرك الصوت المحلي")
            self.enabled = False
            self.stopped.emit()

    def on_exit(self, *_):
        was_stopping, self.listener_stopping = self.listener_stopping, False
        if not self.enabled:
            return
        # A rapid off/on toggle may still be waiting for the old worker to exit.
        if was_stopping:
            self.listener.start()
            return
        self.enabled = False
        self.clear_followup()
        self.set_mic_state(self.listener_failure or "توقّف المايك. جرّب تشغيله من جديد.")
        self.stopped.emit()

    def read_transcripts(self):
        while self.listener.canReadLine():
            try:
                event = json.loads(bytes(self.listener.readLine()))
            except (ValueError, UnicodeError):
                continue
            if not self.enabled or self.listener_stopping:
                continue
            if event.get("ready"):
                self.set_mic_state("أستمع لنداء يا جارفس")
            if event.get("error"):
                self.listener_failure = "تعذر قراءة المايك: " + event["error"]
            if "level" in event:
                self.mic_level.emit(event["level"])
            text = event.get("text")
            if not text or self.busy or self.speaker.state() == QTextToSpeech.Speaking:
                continue
            request = text if self.awaiting_request else wake_request(text)
            if request is None:
                continue
            self.awaiting_request = not request
            if request:
                self.followup.stop()
                self.ask(request)
            else:
                self.followup.start(10000)
                self.reply("سمّ، وش تحتاج؟")

    def ask(self, request, *, frame=None, typed=False):
        if self.busy:
            return False
        image = ocr_image = None
        mode = self.parent().analysis_mode
        sees_screen = frame is not None or (not typed and bool(SCREEN.search(request)))
        translate = bool(TRANSLATION.search(request))
        read_only = bool(READ_TEXT.search(request)) and not translate
        if sees_screen:
            if frame is None:
                screen = QApplication.screenAt(QCursor.pos()) or QApplication.primaryScreen()
                frame = screen.grabWindow(0)
            if frame.isNull():
                self.status.emit("تعذر أخذ لقطة للشاشة.")
                return False
            image = encode_frame(frame, 1280 if mode == HYBRID else 768)
            if not image:
                self.status.emit("تعذر تجهيز لقطة الشاشة.")
                return False
            ocr_image = encode_frame(frame, 1920)

        self.busy = True
        self.typed_request = typed
        self.request_id += 1
        request_id = self.request_id
        if not typed:
            self.status.emit("أجهّز اللقطة للتحليل…" if image else "جارفس يجهز الرد…")

        def run(token):
            try:
                answer = desktop_answer(request, image, ocr_image, read_only, translate, mode=mode, token=token)
            except requests.Timeout:
                answer = "انتهت مهلة النموذج المحلي. جرّب مرة ثانية."
            except requests.ConnectionError:
                answer = "ما قدرت أتصل بـ Ollama. تأكد أنه شغّال على الكمبيوتر."
            except requests.HTTPError as error:
                answer = f"تعذر إكمال الطلب. Ollama رجّع خطأ {error.response.status_code}."
            except (requests.RequestException, ValueError, KeyError):
                answer = "تعذر الحصول على رد من Ollama المحلي."
            self.request_finished.emit(request_id, answer)

        started = False
        def start_worker(token=""):
            nonlocal started
            if started or request_id != self.request_id:
                return
            started = True
            threading.Thread(target=run, args=(token,), daemon=True).start()

        if mode == HYBRID and not read_only:
            QTimer.singleShot(2500, start_worker)
            self.parent().get_cloud_token(start_worker)
        elif mode == HYBRID and image:
            # A read-only request stays local, even if OCR cannot recognize it.
            mode = OFFLINE
            start_worker()
        else:
            start_worker()
        return True

    def complete(self, request_id, answer):
        if request_id != self.request_id:
            return
        if self.typed_request:
            self.typed_request = False
            self.busy = False
            self.typed_answered.emit(answer)
        else:
            self.reply(answer)
        self.answered.emit(answer)

    def preview_voice(self):
        if not self.busy:
            self.status.emit("أهلًا، معك جارفس.")
            self.speaker.say("أهلًا، معك جارفس.")

    def reply(self, text):
        self.busy = False
        if self.enabled:
            self.status.emit(text)
            speech = re.sub(r"(?m)^[#>*\-]+\s*", "", text)
            self.speaker.say(speech.replace("**", "").replace("`", ""))
