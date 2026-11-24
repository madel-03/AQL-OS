import hashlib
import sys
from urllib.parse import urlencode
from pathlib import Path

from PySide6.QtCore import QEvent, QLockFile, QSettings, QStandardPaths, QUrl, Qt, QTimer
from PySide6.QtGui import QCursor, QDesktopServices, QIcon, QKeySequence, QPixmap
from PySide6.QtNetwork import QLocalServer, QLocalSocket
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import (
    QApplication, QDialog, QHBoxLayout, QLabel, QLineEdit, QMainWindow, QMenu, QMessageBox, QProgressBar,
    QPushButton, QStackedWidget, QSystemTrayIcon, QTextEdit, QVBoxLayout, QWidget,
)


from voice_assistant import VoiceAssistant


SITE = QUrl("https://aql-os-orcin.vercel.app/")


class DesktopWindow(QMainWindow):
    def __init__(self, icon):
        super().__init__()
        self.settings = QSettings("AQL", "Desktop")
        self.exiting = False
        self.setWindowTitle("عقل | AQL")
        self.resize(1180, 800)
        self.profile = QWebEngineProfile("AQL", self)
        self.web = QWebEngineView(self)
        self.web.setPage(QWebEnginePage(self.profile, self.web))
        self.build_web_shell()

        self.island = QPushButton("عقل", self)
        self.island.setWindowFlags(Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.island.setAttribute(Qt.WA_ShowWithoutActivating)
        self.island.setAccessibleName("افتح نافذة عقل")
        self.island.setIcon(icon)
        self.island.setFixedSize(116, 42)
        self.island.setStyleSheet(
            "QPushButton { background: #191a29; color: #eeedf9; border: 1px solid #9b8aff;"
            " border-radius: 20px; font: bold 15px 'Segoe UI'; }"
            " QPushButton:hover { background: #32294d; }"
        )
        self.island.clicked.connect(self.toggle_quick_chat)
        self.voice_card = QLabel(self)
        self.voice_card.setWindowFlags(Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.voice_card.setAttribute(Qt.WA_ShowWithoutActivating)
        self.voice_card.setTextFormat(Qt.PlainText)
        self.voice_card.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.voice_card.setWordWrap(True)
        self.voice_card.setStyleSheet(
            "QLabel { background: #191a29; color: #eeedf9; border: 1px solid #9b8aff;"
            " border-radius: 18px; padding: 12px 16px; font: 16px 'Segoe UI'; }"
        )
        self.voice_card_timer = QTimer(self)
        self.voice_card_timer.setSingleShot(True)
        self.voice_card_timer.timeout.connect(self.voice_card.hide)

        self.tray = QSystemTrayIcon(icon, self)
        self.tray.setToolTip("عقل | AQL")
        self.menu = QMenu(self)
        self.menu.addAction("افتح عقل", self.restore)
        self.overlay = self.menu.addAction("أظهر الجزيرة عند التصغير")
        self.overlay.setCheckable(True)
        self.overlay.setChecked(self.settings.value("showIsland", True, type=bool))
        self.overlay.toggled.connect(self.set_overlay)
        self.voice = VoiceAssistant(self)
        self.voice_toggle = self.menu.addAction("استمع لنداء يا جارفس")
        self.voice_toggle.setCheckable(True)
        self.voice_toggle.toggled.connect(self.toggle_microphone)
        self.mic_button.clicked.connect(
            lambda: self.voice_toggle.setChecked(not self.voice_toggle.isChecked())
        )
        self.voice.status.connect(self.show_voice_status)
        self.voice.mic_state.connect(self.update_microphone_label)
        self.voice.mic_level.connect(self.mic_meter.setValue)
        self.voice.stopped.connect(self.clear_voice_toggle)
        self.voice.answered.connect(self.save_last_reply)
        self.build_quick_chat()
        self.last_reply = ""
        self.reply_action = self.menu.addAction("آخر رد من جارفس", self.open_last_reply)
        self.reply_action.setEnabled(False)
        self.menu.addAction("جرّب صوت جارفس", self.voice.preview_voice)
        self.menu.addSeparator()
        self.menu.addAction("خروج من عقل", self.quit)
        self.tray.setContextMenu(self.menu)
        self.tray.activated.connect(self.on_tray)
        self.tray.show()
        self.idle_timer = QTimer(self)
        self.idle_timer.setSingleShot(True)
        self.idle_timer.timeout.connect(self.freeze_idle_website)
        self.load_site()

    def freeze_idle_website(self):
        page = self.web.page()
        if (not self.isVisible() or self.isMinimized()) and page.recommendedState() != QWebEnginePage.LifecycleState.Active:
            page.setLifecycleState(QWebEnginePage.LifecycleState.Frozen)

    def showEvent(self, event):
        super().showEvent(event)
        if hasattr(self, "idle_timer"):
            self.idle_timer.stop()
            self.web.page().setLifecycleState(QWebEnginePage.LifecycleState.Active)

    def hideEvent(self, event):
        super().hideEvent(event)
        if hasattr(self, "idle_timer") and not self.exiting:
            self.idle_timer.start(10000)

    def build_quick_chat(self):
        self.quick_frame = None
        self.quick_capturing = False
        self.quick_waiting = False
        self.quick_product_waiting = False
        self.quick_chat = QDialog(self, Qt.Tool | Qt.WindowStaysOnTopHint)
        self.quick_chat.setWindowTitle("اسأل جارفس")
        self.quick_chat.setFixedWidth(392)
        self.quick_chat.setLayoutDirection(Qt.RightToLeft)
        self.quick_chat.setStyleSheet(
            "QDialog { background: #191a29; }"
            "QLabel { color: #d9d0f0; }"
            "QLineEdit, QTextEdit { color: #f2edff; background: #222337; border: 1px solid #50466f;"
            " border-radius: 8px; padding: 8px; }"
            "QPushButton { background: #302846; color: #f2edff; padding: 6px 10px; border-radius: 8px; }"
            "QPushButton:hover { background: #483a65; } QPushButton:disabled { color: #a8a0b5; }"
        )
        layout = QVBoxLayout(self.quick_chat)
        self.quick_input = QLineEdit()
        self.quick_input.setPlaceholderText("اكتب سؤالك أو الصق صورة…")
        self.quick_input.installEventFilter(self)
        self.quick_input.setMaxLength(2000)
        self.quick_input.returnPressed.connect(self.send_quick_request)
        layout.addWidget(self.quick_input)

        self.quick_preview = QLabel()
        self.quick_preview.setAlignment(Qt.AlignCenter)
        self.quick_preview.hide()
        layout.addWidget(self.quick_preview)
        self.quick_status = QLabel()
        self.quick_status.setWordWrap(True)
        self.quick_status.setTextFormat(Qt.PlainText)
        layout.addWidget(self.quick_status)
        self.quick_reply = QTextEdit()
        self.quick_reply.setReadOnly(True)
        self.quick_reply.setFixedHeight(134)
        self.quick_reply.hide()
        layout.addWidget(self.quick_reply)

        controls = QHBoxLayout()
        self.quick_capture_button = QPushButton("لقطة شاشة")
        self.quick_capture_button.setAutoDefault(False)
        self.quick_capture_button.clicked.connect(self.choose_capture_screen)
        controls.addWidget(self.quick_capture_button)
        self.quick_remove = QPushButton("إزالة اللقطة")
        self.quick_remove.setAutoDefault(False)
        self.quick_remove.clicked.connect(self.clear_quick_frame)
        self.quick_remove.hide()
        controls.addWidget(self.quick_remove)
        controls.addStretch()
        self.quick_send = QPushButton("إرسال")
        self.quick_send.setAutoDefault(False)
        self.quick_send.clicked.connect(lambda: self.send_quick_request())
        controls.addWidget(self.quick_send)
        layout.addLayout(controls)
        product = QPushButton("ابحث عن منتج")
        product.setAutoDefault(False)
        product.clicked.connect(self.open_product_search)
        layout.addWidget(product)
        main = QPushButton("افتح عقل")
        main.setAutoDefault(False)
        main.clicked.connect(self.restore)
        layout.addWidget(main)
        self.quick_chat.finished.connect(lambda _: self.clear_quick_frame())
        self.voice.typed_answered.connect(self.show_quick_reply)

    def eventFilter(self, watched, event):
        if (watched is getattr(self, "quick_input", None) and event.type() == QEvent.Type.KeyPress
                and event.matches(QKeySequence.StandardKey.Paste) and not self.quick_waiting):
            image = QApplication.clipboard().image()
            if not image.isNull():
                self.preview_quick_frame(QPixmap.fromImage(image), "الصورة جاهزة. اكتب سؤالك واضغط إرسال.")
                return True
        return super().eventFilter(watched, event)

    def open_product_search(self):
        if self.quick_waiting:
            return
        query = self.quick_input.text().strip()
        if self.quick_frame is not None:
            self.send_quick_request(product=True)
            return
        if not query:
            self.quick_status.setText("اكتب اسم المنتج أو موديله أولًا. إذا عندك صورة، اسأل جارفس عن الاسم.")
            return
        url = "https://www.google.com/search?" + urlencode({"tbm": "shop", "q": query})
        if not QDesktopServices.openUrl(QUrl(url)):
            self.quick_status.setText("تعذّر فتح المتصفح.")

    def preview_quick_frame(self, frame, status):
        self.quick_frame = frame
        self.quick_preview.setPixmap(frame.scaled(300, 135, Qt.KeepAspectRatio, Qt.SmoothTransformation))
        self.quick_preview.show()
        self.quick_remove.show()
        self.quick_status.setText(status)
        self.quick_chat.adjustSize()

    def show_quick_chat(self):
        screen = self.island.screen() or self.screen()
        area = screen.availableGeometry()
        self.quick_chat.adjustSize()
        self.quick_chat.move(area.center().x() - self.quick_chat.width() // 2, area.top() + 62)
        self.quick_chat.show()
        self.quick_chat.raise_()
        self.quick_chat.activateWindow()
        self.quick_input.setFocus()

    def toggle_quick_chat(self):
        if self.quick_chat.isVisible():
            self.quick_chat.reject()
        else:
            self.show_quick_chat()

    def clear_quick_frame(self):
        self.quick_frame = None
        self.quick_preview.clear()
        self.quick_preview.hide()
        self.quick_remove.hide()
        if not self.quick_waiting:
            self.quick_status.clear()
        self.quick_chat.adjustSize()

    def choose_capture_screen(self):
        screens = QApplication.screens()
        if len(screens) == 1:
            self.capture_quick_frame(screens[0])
            return
        menu = QMenu(self.quick_chat)
        menu.setTitle("اختر الشاشة")
        choices = {}
        for index, screen in enumerate(screens, 1):
            size = screen.size()
            label = f"الشاشة {index} · {screen.name()} · {size.width()} × {size.height()}"
            if screen is self.quick_chat.screen():
                label += " (شاشة جارفس)"
            choices[menu.addAction(label)] = screen
        position = self.quick_capture_button.mapToGlobal(self.quick_capture_button.rect().bottomLeft())
        selected = menu.exec(position)
        if selected is not None:
            self.capture_quick_frame(choices[selected])

    def capture_quick_frame(self, screen):
        self.quick_capturing = True
        self.quick_chat.hide()
        self.island.hide()
        self.voice_card.hide()
        QTimer.singleShot(220, lambda: self.finish_quick_capture(screen))

    def finish_quick_capture(self, screen):
        if self.exiting or not self.quick_capturing:
            return
        self.quick_capturing = False
        if screen not in QApplication.screens():
            screen = QApplication.primaryScreen()
        frame = screen.grabWindow(0)
        if frame.isNull():
            self.clear_quick_frame()
            self.quick_status.setText("تعذّر أخذ لقطة للشاشة.")
        else:
            self.preview_quick_frame(frame, "اللقطة جاهزة. أرسلها مع سؤالك أو اضغط إرسال لوصف الشاشة.")
        self.update_island()
        self.show_quick_chat()

    def send_quick_request(self, *, product=False):
        text = self.quick_input.text().strip()
        if self.quick_waiting or (not text and self.quick_frame is None):
            return
        if self.voice.busy:
            self.quick_status.setText("جارفس يرد على طلب آخر. أرسل بعد ما يخلص.")
            return
        prompt = text or "صف ما يظهر على الشاشة."
        if product:
            prompt = ("حدّد المنتج الظاهر إن أمكن. ابدأ بسطر SEARCH_QUERY: ثم الاسم والموديل بكلمات البحث. "
                      "إذا تعذّر التحديد اكتب SEARCH_QUERY: UNKNOWN. بعدها اشرح بجملة قصيرة. "
                      "لا تختلق اسمًا أو سعرًا.")
            if text:
                prompt += "\nتفاصيل المستخدم: " + text
        if not self.voice.ask(prompt, frame=self.quick_frame, typed=True):
            self.quick_status.setText("تعذّر تجهيز الطلب. جرّب مرة ثانية.")
            return
        self.quick_waiting = True
        self.quick_product_waiting = product
        self.quick_send.setEnabled(False)
        self.quick_capture_button.setEnabled(False)
        self.quick_input.clear()
        self.clear_quick_frame()
        self.quick_status.setText("جارٍ تجهيز الرد…")
        self.quick_reply.hide()
        self.quick_chat.adjustSize()

    def show_quick_reply(self, text):
        self.quick_waiting = False
        product, self.quick_product_waiting = self.quick_product_waiting, False
        if product and text.upper().startswith("SEARCH_QUERY:"):
            first, _, reply = text.partition("\n")
            query = first.split(":", 1)[1].strip()
            if 0 < len(query) <= 120 and query.upper() != "UNKNOWN" and "://" not in query:
                if not self.quick_input.text().strip():
                    self.quick_input.setText(query)
                text = (reply.strip() or query) + "\n\nاضغط «ابحث عن منتج» لعرض المتاجر."
            else:
                text = reply.strip() or "ما قدرت أحدد اسم المنتج من الصورة."
        self.quick_send.setEnabled(True)
        self.quick_capture_button.setEnabled(True)
        self.quick_reply.setPlainText(text)
        self.quick_reply.show()
        self.quick_status.clear()
        self.quick_chat.adjustSize()
        if not self.quick_chat.isVisible():
            self.show_voice_status(text)

    def build_web_shell(self):
        shell = QWidget(self)
        shell.setStyleSheet(
            "QWidget { background: #151522; color: #f1edf9; font: 14px 'Segoe UI'; }"
            " QPushButton { background: #28243b; border: 1px solid #51476c; border-radius: 8px;"
            " padding: 6px 12px; } QPushButton:hover { background: #393152; }"
            " QProgressBar { background: #252339; border: 0; border-radius: 3px; }"
            " QProgressBar::chunk { background: #a8ebd8; border-radius: 3px; }"
        )
        layout = QVBoxLayout(shell)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        toolbar = QHBoxLayout()
        toolbar.setContentsMargins(12, 8, 12, 8)
        toolbar.addStretch()
        self.mic_meter = QProgressBar()
        self.mic_meter.setAccessibleName("مستوى المايك")
        self.mic_meter.setRange(0, 100)
        self.mic_meter.setValue(0)
        self.mic_meter.setTextVisible(False)
        self.mic_meter.setFixedSize(66, 6)
        self.mic_meter.hide()
        self.mic_label = QLabel("المايك متوقف")
        self.mic_button = QPushButton("شغّل المايك")
        for item in (self.mic_meter, self.mic_label, self.mic_button):
            toolbar.addWidget(item)
        layout.addLayout(toolbar)

        self.pages = QStackedWidget()
        self.pages.addWidget(self.web)
        waiting = QWidget()
        center = QVBoxLayout(waiting)
        center.setAlignment(Qt.AlignCenter)
        self.web_status = QLabel()
        self.web_status.setAlignment(Qt.AlignCenter)
        self.web_status.setWordWrap(True)
        self.web_status.setMaximumWidth(420)
        center.addWidget(self.web_status)
        self.retry_button = QPushButton("أعد تحميل الموقع")
        self.retry_button.clicked.connect(self.load_site)
        center.addWidget(self.retry_button)
        browser = QPushButton("افتح في المتصفح")
        browser.clicked.connect(lambda: QDesktopServices.openUrl(SITE))
        center.addWidget(browser)
        self.pages.addWidget(waiting)
        layout.addWidget(self.pages, 1)
        self.setCentralWidget(shell)

        self.load_timer = QTimer(self)
        self.load_timer.setSingleShot(True)
        self.load_timer.timeout.connect(self.website_timed_out)
        self.web.loadFinished.connect(self.website_loaded)
        self.web.renderProcessTerminated.connect(
            lambda *_: self.website_problem("توقفت صفحة عقل عن العرض.")
        )

    def load_site(self):
        self.web_status.setText("يفتح موقع عقل…")
        self.pages.setCurrentIndex(1)
        self.retry_button.setEnabled(False)
        self.load_timer.start(25000)
        self.web.load(SITE)

    def website_loaded(self, ok):
        self.load_timer.stop()
        self.retry_button.setEnabled(True)
        if ok:
            self.pages.setCurrentIndex(0)
        else:
            self.website_problem("تعذر تحميل موقع عقل. تأكد من اتصال الإنترنت وحاول مرة ثانية.")

    def website_timed_out(self):
        self.website_problem("تحميل موقع عقل أخذ وقتًا أطول من المعتاد.")

    def website_problem(self, text):
        self.load_timer.stop()
        self.web_status.setText(text)
        self.retry_button.setEnabled(True)
        self.pages.setCurrentIndex(1)

    def toggle_microphone(self, enabled):
        self.mic_button.setText("وقّف المايك" if enabled else "شغّل المايك")
        self.mic_meter.setVisible(enabled)
        self.voice.enable(enabled)

    def update_microphone_label(self, text):
        self.mic_label.setText(text[:64])
        self.mic_label.setToolTip(text)
        self.island.setText("أستمع" if text.startswith("أستمع") else "عقل")

    def save_last_reply(self, answer):
        self.last_reply = answer
        self.reply_action.setEnabled(True)

    def open_last_reply(self):
        dialog = QDialog(self)
        dialog.setWindowFlag(Qt.WindowStaysOnTopHint)
        dialog.setWindowTitle("آخر رد من جارفس")
        dialog.resize(520, 300)
        layout = QVBoxLayout(dialog)
        reply = QTextEdit(dialog)
        reply.setReadOnly(True)
        reply.setPlainText(self.last_reply)
        layout.addWidget(reply)
        dialog.exec()

    def clear_voice_toggle(self):
        self.voice_toggle.blockSignals(True)
        self.voice_toggle.setChecked(False)
        self.voice_toggle.blockSignals(False)
        self.mic_button.setText("شغّل المايك")
        self.mic_meter.hide()

    def show_voice_status(self, text):
        if self.exiting:
            return
        self.tray.setToolTip(text[:120])
        screen = QApplication.screenAt(QCursor.pos()) or self.screen()
        area = screen.availableGeometry()
        width = min(540, area.width() - 32)
        message = text if len(text) <= 480 else text[:477] + "…"
        self.voice_card.setText("جارفس  ·  " + message)
        self.voice_card.setFixedWidth(width)
        self.voice_card.setFixedHeight(max(44, self.voice_card.heightForWidth(width)))
        offset = 60 if self.island.isVisible() and self.island.screen() == screen else 12
        self.voice_card.move(area.x() + (area.width() - width) // 2, area.top() + offset)
        self.voice_card.show()
        self.voice_card_timer.start(6000 if len(text) < 45 else 14000)

    def on_tray(self, reason):
        if reason == QSystemTrayIcon.Trigger:
            self.restore()

    def set_overlay(self, enabled):
        self.settings.setValue("showIsland", enabled)
        self.update_island()

    def update_island(self):
        if self.exiting or self.quick_capturing or not self.overlay.isChecked() or (self.isVisible() and not self.isMinimized()):
            self.island.hide()
            return
        screen = self.screen() or QApplication.primaryScreen()
        area = screen.availableGeometry()
        self.island.move(area.center().x() - self.island.width() // 2, area.top() + 12)
        self.island.show()

    def changeEvent(self, event):
        super().changeEvent(event)
        if hasattr(self, "idle_timer") and event.type() == event.Type.WindowStateChange:
            if self.isMinimized():
                self.idle_timer.start(10000)
            elif self.isVisible():
                self.idle_timer.stop()
                self.web.page().setLifecycleState(QWebEnginePage.LifecycleState.Active)
        if hasattr(self, "overlay"):
            QTimer.singleShot(0, self.update_island)

    def closeEvent(self, event):
        if self.exiting:
            event.accept()
        else:
            event.ignore()
            if self.tray.isSystemTrayAvailable():
                self.hide()
            else:
                self.showMinimized()
            self.update_island()

    def restore(self):
        self.quick_capturing = False
        self.quick_chat.reject()
        self.showNormal()
        self.raise_()
        self.activateWindow()
        self.update_island()

    def quit(self):
        self.exiting = True
        self.voice.enable(False)
        self.quick_chat.close()
        self.island.hide()
        self.voice_card.hide()
        self.tray.hide()
        QApplication.quit()


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("AQL")
    app.setApplicationDisplayName("عقل | AQL")
    app.setQuitOnLastWindowClosed(False)
    icon = QIcon(str(Path(__file__).resolve().parent / "assets" / "aql.ico"))
    app.setWindowIcon(icon)
    profile_path = Path(QStandardPaths.writableLocation(QStandardPaths.AppLocalDataLocation))
    profile_path.mkdir(parents=True, exist_ok=True)
    instance = "AQL.Desktop." + hashlib.sha256(str(profile_path).encode()).hexdigest()[:20]
    lock = QLockFile(str(profile_path / "desktop.lock"))
    lock.setStaleLockTime(0)
    if not lock.tryLock(150):
        client = QLocalSocket()
        client.connectToServer(instance)
        if client.waitForConnected(1500):
            client.disconnectFromServer()
            return 0
        QMessageBox.warning(None, "عقل | AQL", "عقل شغّال بالفعل أو نافذته ما زالت تفتح.")
        return 1

    server = QLocalServer()
    server.setSocketOptions(QLocalServer.UserAccessOption)
    if not server.listen(instance):
        QMessageBox.warning(None, "عقل | AQL", "تعذر تجهيز نافذة عقل. جرّب تشغيله مرة ثانية.")
        return 1

    window = DesktopWindow(icon)

    def reopen():
        while server.hasPendingConnections():
            client = server.nextPendingConnection()
            client.disconnectFromServer()
            client.deleteLater()
        window.restore()

    server.newConnection.connect(reopen)
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())

