from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
import unittest
from organize import apply_plan, make_plan


class OrganizeTests(unittest.TestCase):
    def test_preview_collision_undo(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            src = root / "note.txt"
            src.write_text("original")
            plan = make_plan(root)
            self.assertTrue(src.exists())
            undo, errors = apply_plan(plan, Event())
            self.assertFalse(errors)
            src.write_text("new")
            self.assertTrue(apply_plan(undo, Event())[1])
            self.assertEqual(src.read_text(), "new")
