import os
import unittest
from pathlib import Path
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtCore import QUrl
from PySide6.QtGui import QGuiApplication
from PySide6.QtQml import QQmlApplicationEngine
from app import Desktop
from store import Store


class UiTests(unittest.TestCase):
    def test_qml_boots_and_chat_selection(self):
        app = QGuiApplication.instance() or QGuiApplication([])
        bridge = Desktop(Store(":memory:"))
        engine = QQmlApplicationEngine()
        engine.rootContext().setContextProperty("desktop", bridge)
        engine.load(QUrl.fromLocalFile(str(Path(__file__).resolve().with_name("Main.qml"))))
        self.assertTrue(engine.rootObjects())
        app.processEvents()
        engine.deleteLater()
