import unittest
from tempfile import TemporaryDirectory
from pathlib import Path
from store import Store


class StoreTests(unittest.TestCase):
    def test_history_is_scoped_and_persistent(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "test.sqlite"
            db = Store(path)
            first = db.add(0, "user", "مرحبا")
            second = db.add(0, "user", "other")
            db.add(first, "assistant", "جواب")
            db.configure({"provider": "Ollama"})
            db.db.close()
            db = Store(path)
            self.assertEqual(db.chats("جواب"), [(first, "مرحبا")])
            self.assertEqual(len(db.history(second)), 1)
            self.assertEqual(db.setting("provider", ""), "Ollama")
            db.db.close()
