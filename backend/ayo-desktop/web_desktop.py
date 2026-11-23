import sys
from pathlib import Path

from PySide6.QtCore import QSettings, QUrl, Qt, QTimer
from PySide6.QtGui import QIcon
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication, QMainWindow, QMenu, QPushButton, QSystemTrayIcon


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
        self.setCentralWidget(self.web)
        self.web.load(SITE)

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
        self.island.clicked.connect(self.restore)

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
        self.voice_toggle.toggled.connect(self.voice.enable)
        self.voice.status.connect(self.show_voice_status)
        self.voice.stopped.connect(self.clear_voice_toggle)
        self.menu.addSeparator()
        self.menu.addAction("خروج من عقل", self.quit)
        self.tray.setContextMenu(self.menu)
        self.tray.activated.connect(self.on_tray)
        self.tray.show()

    def clear_voice_toggle(self):
        self.voice_toggle.blockSignals(True)
        self.voice_toggle.setChecked(False)
        self.voice_toggle.blockSignals(False)

    def show_voice_status(self, text):
        self.tray.setToolTip(text[:120])
        if self.island.isVisible():
            self.island.setToolTip(text)
        self.statusBar().showMessage(text, 10000)
        if not self.isVisible() or self.isMinimized():
            self.tray.showMessage("جارفس | عقل", text)

    def on_tray(self, reason):
        if reason == QSystemTrayIcon.Trigger:
            self.restore()

    def set_overlay(self, enabled):
        self.settings.setValue("showIsland", enabled)
        self.update_island()

    def update_island(self):
        if self.exiting or not self.overlay.isChecked() or (self.isVisible() and not self.isMinimized()):
            self.island.hide()
            return
        screen = self.screen() or QApplication.primaryScreen()
        area = screen.availableGeometry()
        self.island.move(area.center().x() - self.island.width() // 2, area.top() + 12)
        self.island.show()

    def changeEvent(self, event):
        super().changeEvent(event)
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
        self.showNormal()
        self.raise_()
        self.activateWindow()
        self.update_island()

    def quit(self):
        self.exiting = True
        self.voice.enable(False)
        self.island.hide()
        self.tray.hide()
        QApplication.quit()


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("عقل | AQL")
    app.setQuitOnLastWindowClosed(False)
    icon = QIcon(str(Path(__file__).resolve().parent / "assets" / "aql.ico"))
    app.setWindowIcon(icon)
    window = DesktopWindow(icon)
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
