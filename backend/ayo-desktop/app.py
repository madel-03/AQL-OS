import json
import os
import sys
import threading
from pathlib import Path
from keyring.backends.Windows import WinVaultKeyring
from PySide6.QtCore import QProcess, QObject, Property, Signal, Slot, QUrl
from PySide6.QtGui import QGuiApplication, QIcon
from PySide6.QtQml import QQmlApplicationEngine
from providers import MODELS, generate
from store import Store


class Desktop(QObject):
    changed = Signal()
    token = Signal(str)
    ended = Signal(str)
    actionReady = Signal(object, str)
    actionPreview = Signal(str)
    previewReady = Signal(str)
    fileFinished = Signal(object, str)
    heard = Signal(str)
    documentReady = Signal(str)
    documentStatus = Signal(str)

    def __init__(self, db):
        super().__init__()
        self.db = db
        self.voice = QProcess(self)
        self.voice.readyReadStandardOutput.connect(self.readVoice)
        self.voice.finished.connect(lambda *_: self.changed.emit())
        self.voice.errorOccurred.connect(self.voiceError)
        self.chat = 0
        self.partial = ""
        self.active = False
        self.notice = ""
        self.filter = ""
        self.actions = []
        self.actionReady.connect(self.showActions)
        self.plan = []
        self.undo = []
        self.file_stop = threading.Event()
        self.fileFinished.connect(self.fileComplete)
        self.stop_event = threading.Event()
        self.token.connect(self.append)
        self.ended.connect(self.finish)

    @Property(str, notify=changed)
    def state(self):
        provider = self.db.setting("provider", "Ollama")
        return json.dumps(dict(provider=provider, model=self.modelFor(provider), busy=self.active,
            chats=self.db.chats(self.filter), messages=self.db.history(self.chat),
            listening=self.voice.state() != QProcess.NotRunning, canUndo=bool(self.undo), partial=self.partial, notice=self.notice), ensure_ascii=False)

    @Slot()
    def toggleVoice(self):
        if self.voice.state() != QProcess.NotRunning:
            self.voice.kill()
            return
        root = Path(os.environ["LOCALAPPDATA"]) / "AQL" / "voice"
        python = root / "Scripts" / "python.exe"
        script = Path(__file__).resolve().parent / "jarvis-listen.py"
        if not script.exists():
            script = script.parent.parent / script.name
        if not python.exists() or not (root / "model" / "model.bin").exists():
            self.notice = "ثبّت الصوت المحلي من setup-jarvis-voice.cmd"
        else:
            self.notice = "جارٍ تجهيز الميكروفون…"
            self.voice.start(str(python), [str(script), str(root / "model")])
        self.changed.emit()

    def voiceError(self, error):
        if error == QProcess.FailedToStart:
            self.notice = self.voice.errorString()
        self.changed.emit()

    @Slot()
    def readVoice(self):
        while self.voice.canReadLine():
            event = json.loads(bytes(self.voice.readLine()))
            if event.get("text"):
                self.heard.emit(event["text"])
                self.notice = "راجع النص ثم أرسله"
                self.voice.kill()
            elif event.get("error"):
                self.notice = event["error"]
            elif event.get("ready"):
                self.notice = "أستمع الآن…"
            else:
                continue
            self.changed.emit()

    @Slot(str)
    def prepareActions(self, request):
        from actions import plan_actions
        if self.active or not request.strip():
            return
        provider = self.db.setting("provider", "Ollama")
        model = self.modelFor(provider)
        self.stop_event.clear()
        self.actions = []
        self.active = True
        self.notice = "جارٍ إعداد خطة"
        self.changed.emit()

        def work():
            try:
                key = "" if provider == "Ollama" else WinVaultKeyring().get_password("AYO AI", provider)
                if provider != "Ollama" and not key:
                    raise ValueError("مفتاح الخدمة مطلوب")
                steps = plan_actions(provider, model, key, request, self.stop_event)
                self.actionReady.emit(steps, "")
            except Exception as error:
                self.actionReady.emit([], str(error))
        threading.Thread(target=work, daemon=True).start()

    @Slot(object, str)
    def showActions(self, steps, error):
        self.active = False
        self.actions = [] if self.stop_event.is_set() else steps
        self.notice = "تم الإيقاف" if self.stop_event.is_set() else error
        self.changed.emit()
        if self.actions:
            self.actionPreview.emit("\n".join(f"{i}. {s['tool']} — {s['value']}" for i,s in enumerate(steps,1)))

    @Slot()
    def runActions(self):
        from actions import execute
        if self.active or not self.actions:
            return
        steps, self.actions = self.actions, []
        self.active = True
        self.stop_event.clear()
        self.changed.emit()
        def work():
            results = []
            try:
                for step in steps:
                    if self.stop_event.is_set():
                        break
                    execute(step)
                    results.append("✓ " + step["value"])
            except Exception as error:
                results.append(str(error))
            self.actionReady.emit([], "\n".join(results))
        threading.Thread(target=work, daemon=True).start()

    @Slot(QUrl)
    def previewFolder(self, url):
        if self.active:
            return
        from organize import make_plan
        self.active = True
        self.changed.emit()
        def work():
            try:
                moves = make_plan(url.toLocalFile())
                self.fileFinished.emit(moves, "preview")
            except Exception as error:
                self.fileFinished.emit([], str(error))
        threading.Thread(target=work, daemon=True).start()

    @Slot(object, str)
    def fileComplete(self, moves, status):
        self.active = False
        if status == "preview":
            self.plan = moves
            self.notice = "" if moves else "لا توجد ملفات مناسبة للنقل"
            if moves:
                self.previewReady.emit("\n".join(f"{s.name}  →  {d.parent.name}" for s,d,*_ in moves))
        else:
            self.undo = moves
            self.notice = status
        self.changed.emit()

    @Slot(bool)
    def moveFiles(self, undo):
        from organize import apply_plan
        if self.active:
            return
        moves = self.undo if undo else self.plan
        if not moves:
            return
        self.plan = []
        self.active = True
        self.file_stop.clear()
        self.changed.emit()
        def work():
            done, failures = apply_plan(moves, self.file_stop)
            status = f"اكتمل {len(done)} من {len(moves)}"
            if failures:
                status += "\n" + "\n".join(failures)
            remaining = [item for item in moves if item[0] not in {step[1] for step in done}] if undo else done
            self.fileFinished.emit(remaining, status)
        threading.Thread(target=work, daemon=True).start()

    @Slot(QUrl)
    def readDocument(self, url):
        from documents import extract
        def work():
            try:
                self.documentReady.emit(extract(url.toLocalFile()))
            except Exception as error:
                self.documentStatus.emit(str(error))
        threading.Thread(target=work, daemon=True).start()

    @Slot(QUrl, str)
    def saveDocument(self, url, content):
        from documents import export_text
        def work():
            try:
                export_text(url.toLocalFile(), content)
                self.documentStatus.emit("تم حفظ الملف")
            except Exception as error:
                self.documentStatus.emit(str(error))
        threading.Thread(target=work, daemon=True).start()

    @Slot(str, result=str)
    def modelFor(self, provider):
        return self.db.setting("model." + provider, MODELS.get(provider, ""))

    @Slot(str)
    def search(self, value):
        self.filter = value
        self.changed.emit()

    @Slot(int)
    def select(self, chat):
        if not self.active:
            self.chat = chat
            self.notice = ""
            self.changed.emit()

    @Slot(str, str, str, result=bool)
    def configure(self, provider, model, secret):
        if self.active or provider not in MODELS or not model.strip():
            return False
        try:
            if secret and provider != "Ollama":
                WinVaultKeyring().set_password("AYO AI", provider, secret)
            self.db.configure({"provider": provider, "model." + provider: model.strip()})
            self.notice = ""
        except Exception as error:
            self.notice = str(error)
            self.changed.emit()
            return False
        self.changed.emit()
        return True

    @Slot(str)
    def send(self, value):
        if self.active or not value.strip():
            return
        provider = self.db.setting("provider", "Ollama")
        model = self.modelFor(provider)
        try:
            key = "" if provider == "Ollama" else WinVaultKeyring().get_password("AYO AI", provider)
            if provider != "Ollama" and not key:
                raise ValueError("أضف مفتاح الخدمة في الإعدادات / API key required.")
        except Exception as error:
            self.notice = str(error)
            self.changed.emit()
            return
        self.chat = self.db.add(self.chat, "user", value.strip())
        history = self.db.history(self.chat)
        self.partial = self.notice = ""
        self.active = True
        self.stop_event.clear()
        self.changed.emit()

        def run():
            try:
                for piece in generate(provider, model, history, key, self.stop_event):
                    if piece and not self.stop_event.is_set():
                        self.token.emit(piece)
                self.ended.emit("")
            except Exception as error:
                self.ended.emit(str(error))

        threading.Thread(target=run, daemon=True).start()

    @Slot(str)
    def append(self, piece):
        if not self.stop_event.is_set():
            self.partial += piece
            self.changed.emit()

    @Slot(str)
    def finish(self, error):
        if self.partial:
            self.db.add(self.chat, "assistant", self.partial)
        self.notice = "تم الإيقاف / Stopped" if self.stop_event.is_set() else error
        if not self.partial and not self.notice:
            self.notice = "لم يصل نص / Empty response"
        self.partial = ""
        self.active = False
        self.changed.emit()

    @Slot()
    def stop(self):
        self.stop_event.set()
        self.file_stop.set()
        self.notice = "جارٍ الإيقاف / Stopping…"
        self.changed.emit()


def main():
    app = QGuiApplication(sys.argv)
    app.setApplicationDisplayName("عقل | AQL")
    app.setWindowIcon(QIcon(str(Path(__file__).resolve().parent / "assets" / "aql.ico")))
    root = Path(os.environ["LOCALAPPDATA"]) / "AYO AI"
    root.mkdir(exist_ok=True)
    desktop = Desktop(Store(root / "history.sqlite"))
    engine = QQmlApplicationEngine()
    engine.rootContext().setContextProperty("desktop", desktop)
    engine.load(QUrl.fromLocalFile(str(Path(__file__).resolve().with_name("Main.qml"))))
    if not engine.rootObjects():
        return 1
    app.aboutToQuit.connect(desktop.stop_event.set)
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())




