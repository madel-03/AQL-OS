from PySide6.QtCore import QRect, Qt
from PySide6.QtWidgets import QDialog, QDialogButtonBox, QLabel, QRubberBand, QVBoxLayout


class CropCanvas(QLabel):
    def __init__(self, frame, apply_button):
        super().__init__()
        self.frame = frame
        self.apply_button = apply_button
        self.start = None
        self.region = QRect()
        preview = frame.scaled(820, 480, Qt.KeepAspectRatio, Qt.SmoothTransformation)
        # Match the zoomed preview bounds even on a high-DPI display.
        preview.setDevicePixelRatio(1)
        self.setPixmap(preview)
        self.setFixedSize(preview.size())
        self.setCursor(Qt.CrossCursor)
        self.band = QRubberBand(QRubberBand.Rectangle, self)

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.start = event.position().toPoint()
            self.region = QRect()
            self.apply_button.setEnabled(False)
            self.band.setGeometry(QRect(self.start, self.start))
            self.band.show()

    def mouseMoveEvent(self, event):
        if self.start is not None:
            self.region = QRect(self.start, event.position().toPoint()).normalized().intersected(self.rect())
            self.band.setGeometry(self.region)

    def mouseReleaseEvent(self, event):
        if self.start is not None and event.button() == Qt.LeftButton:
            self.mouseMoveEvent(event)
            self.start = None
            self.apply_button.setEnabled(self.region.width() >= 6 and self.region.height() >= 6)

    def cropped(self):
        sx = self.frame.width() / self.width()
        sy = self.frame.height() / self.height()
        return self.frame.copy(QRect(
            round(self.region.x() * sx), round(self.region.y() * sy),
            round(self.region.width() * sx), round(self.region.height() * sy),
        ))


def crop_frame(frame, parent):
    dialog = QDialog(parent)
    dialog.setWindowTitle("قص الصورة")
    dialog.setLayoutDirection(Qt.RightToLeft)
    layout = QVBoxLayout(dialog)
    layout.addWidget(QLabel("اسحب على الجزء اللي تبي ترسله."))
    buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
    apply = buttons.button(QDialogButtonBox.Ok)
    apply.setText("استخدم الجزء المحدد")
    apply.setEnabled(False)
    buttons.button(QDialogButtonBox.Cancel).setText("إلغاء")
    canvas = CropCanvas(frame, apply)
    layout.addWidget(canvas)
    layout.addWidget(buttons)
    buttons.accepted.connect(dialog.accept)
    buttons.rejected.connect(dialog.reject)
    return canvas.cropped() if dialog.exec() == QDialog.Accepted else None
