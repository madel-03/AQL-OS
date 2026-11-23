from pathlib import Path


def extract(path):
    path = Path(path)
    if path.stat().st_size > 20_000_000:
        raise ValueError("الحد الأقصى 20 MB")
    suffix = path.suffix.lower()
    if suffix == ".txt":
        text = path.read_text(encoding="utf-8-sig")
    elif suffix == ".pdf":
        import pymupdf
        with pymupdf.open(path) as document:
            text = "\n".join(page.get_text() for page in document)
    elif suffix == ".docx":
        from docx import Document
        document = Document(path)
        text = "\n".join(p.text for p in document.paragraphs)
    elif suffix == ".xlsx":
        from openpyxl import load_workbook
        book = load_workbook(path, read_only=True, data_only=True)
        try:
            rows = []
            size = 0
            for sheet in book:
                for row in sheet.values:
                    line = "\t".join(str(v) if v is not None else "" for v in row)
                    size += len(line) + 1
                    if size > 40000:
                        raise ValueError("اختر جدولًا أصغر من 40000 حرف")
                    rows.append(line)
            text = "\n".join(rows)
        finally:
            book.close()
    else:
        raise ValueError("Unsupported file type")
    if not text.strip():
        raise ValueError("لم يُعثر على نص قابل للقراءة")
    if len(text) > 40000:
        raise ValueError("اختر مستندًا أقصر من 40000 حرف")
    return text.strip()


def export_text(path, text):
    from docx import Document
    from openpyxl import Workbook
    path = Path(path)
    if path.suffix.lower() == ".docx":
        doc = Document()
        for line in text.splitlines():
            doc.add_paragraph(line)
    elif path.suffix.lower() == ".xlsx":
        doc = Workbook()
        for line in text.splitlines():
            doc.active.append(line.split("\t"))
            for cell in doc.active[doc.active.max_row]:
                cell.data_type = "s"
    else:
        raise ValueError("Choose DOCX or XLSX")
    import tempfile
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        staged = Path(tmp.name)
    try:
        doc.save(staged)
        staged.replace(path)
    finally:
        staged.unlink(missing_ok=True)
