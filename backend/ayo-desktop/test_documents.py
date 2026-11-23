import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from documents import extract, export_text


class DocumentsTests(unittest.TestCase):
    def test_office_roundtrip(self):
        with TemporaryDirectory() as folder:
            for ext in ("docx", "xlsx"):
                path = Path(folder) / ("نتيجة." + ext)
                export_text(path, "مرحبا\n=1+2")
                self.assertEqual(extract(path), "مرحبا\n=1+2")

    def test_size_limit(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "sample.txt"
            path.write_text("a" * 40001)
            with self.assertRaises(ValueError):
                extract(path)
