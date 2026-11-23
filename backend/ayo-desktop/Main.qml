import QtQuick
import QtQuick.Controls
import QtQuick.Controls.Material
import QtQuick.Layouts
import QtQuick.Window
import QtQuick.Dialogs as Dialogs

ApplicationWindow {
    id: win
    width: 1060; height: 700; minimumWidth: 640; minimumHeight: 440
    visible: true; title: "عقل | AQL"; color: "#0c0d1c"
    Material.theme: Material.Dark
    Material.accent: "#73f5d1"
    font.family: "Segoe UI"
    background: Rectangle {
        color: "#181722"
        Image { anchors.fill: parent; source: "assets/warm-room.webp"; fillMode: Image.PreserveAspectCrop }
        Rectangle { anchors.fill: parent; color: "#ac171420" }
    }
    property var dataState: JSON.parse(desktop.state)
    property bool folded: false
    Dialogs.FolderDialog { id: chooseFolder; onAccepted: desktop.previewFolder(selectedFolder) }
    Dialog {
        id: preview; anchors.centerIn: parent; modal: true; title: "مراجعة نقل الملفات"
        standardButtons: Dialog.Ok | Dialog.Cancel
        onAccepted: desktop.moveFiles(false)
        ScrollView { width: 450; height: 250; TextArea { id: previewText; readOnly: true } }
    }
    Dialog {
        id: actions; anchors.centerIn: parent; modal: true; title: "السماح بتنفيذ الخطوات؟"
        standardButtons: Dialog.Ok | Dialog.Cancel
        onAccepted: desktop.runActions()
        Label { id: steps; width: 400; wrapMode: Text.Wrap }
    }
    property string docNotice: ""
    property string imported: ""
    property string exportContent: ""
    Connections {
        target: desktop
        function onActionPreview(value) { steps.text = value; actions.open() }
        function onPreviewReady(value) { previewText.text = value; preview.open() }
        function onHeard(value) { composer.text = value }
        function onDocumentReady(value) { win.imported = value; win.docNotice = "المرفق جاهز للإرسال" }
        function onDocumentStatus(value) { win.docNotice = value }
    }
    Dialogs.FileDialog {
        id: openDoc; nameFilters: ["Documents (*.pdf *.docx *.xlsx *.txt)"]
        onAccepted: { win.imported = ""; win.docNotice = "قراءة الملف…"; desktop.readDocument(selectedFile) }
    }
    Dialogs.FileDialog {
        id: saveDoc; fileMode: Dialogs.FileDialog.SaveFile
        nameFilters: ["Word (*.docx)", "Excel (*.xlsx)"]
        defaultSuffix: selectedNameFilter.index === 1 ? "xlsx" : "docx"
        onAccepted: desktop.saveDocument(selectedFile, win.exportContent)
    }
    function submit() {
        if (!composer.text.trim() || dataState.busy) return
        desktop.send(composer.text + (imported ? "\n\n[محتوى المستند المرفق]\n" + imported : ""))
        if (dataState.busy) { composer.clear(); imported = ""; docNotice = "" }
    }
    RowLayout {
        anchors.fill: parent; anchors.margins: 12; spacing: 20; layoutDirection: Qt.RightToLeft
        Rectangle {
            Layout.fillHeight: true; Layout.preferredWidth: win.folded ? 64 : 234
            radius: 18; border.color: "#524e5062"; color: "#dc191a29"
            ColumnLayout {
                anchors.fill: parent; anchors.margins: 12
                RowLayout {
                    Layout.fillWidth: true
                    Image { visible: !win.folded; source: "assets/aql-192.png"; Layout.preferredWidth: 62; Layout.preferredHeight: 62 }
                    Item { Layout.fillWidth: true }
                    ToolButton { text: "☰"; Accessible.name: "طي القائمة"; onClicked: win.folded = !win.folded }
                }
                Button { text: win.folded ? "+" : "محادثة جديدة  +"; enabled: !win.dataState.busy; onClicked: desktop.select(0) }
                TextField { visible: !win.folded; Layout.fillWidth: true; placeholderText: "بحث في المحادثات"; onTextEdited: desktop.search(text) }
                ListView {
                    visible: !win.folded; Layout.fillWidth: true; Layout.fillHeight: true
                    clip: true; model: win.dataState.chats
                    delegate: ItemDelegate { required property var modelData; width: ListView.view.width
                        text: modelData[1]; enabled: !win.dataState.busy; onClicked: desktop.select(modelData[0]) }
                }
                Item { visible: win.folded; Layout.fillHeight: true }
                ToolButton { visible: !win.folded; text: "تنظيم مجلد"; enabled: !win.dataState.busy; onClicked: chooseFolder.open() }
                ToolButton { visible: win.dataState.canUndo; text: "تراجع عن النقل"; enabled: !win.dataState.busy; onClicked: desktop.moveFiles(true) }
                ToolButton { text: win.folded ? "◉" : "الجزيرة"; onClicked: island.visible = !island.visible }
                ToolButton { text: win.folded ? "⚙" : "الإعدادات  ⚙"; enabled: !win.dataState.busy; onClicked: settings.open() }
            }
        }
        ColumnLayout {
            Layout.fillWidth: true; Layout.fillHeight: true; Layout.rightMargin: 20; Layout.topMargin: 18; Layout.bottomMargin: 16
            Label { text: "تحدّث مع عقل"; Layout.alignment: Qt.AlignRight; font.pixelSize: 26; font.weight: Font.DemiBold; color: "#eeedf9" }
            Label { text: win.dataState.provider + "   ·   " + win.dataState.model; color: "#9EAECE" }
            Label { text: win.dataState.provider === "Ollama" ? "معالجة على جهازك" : "تُرسل المحادثة إلى " + win.dataState.provider; color: "#AE9BFF" }
            ListView {
                id: messages
                Label {
                    anchors.centerIn: parent; visible: messages.count === 0
                    text: "وش ودّك نسوي اليوم؟"; font.pixelSize: 28; font.weight: Font.DemiBold; color: "#eeedf9"
                }
                clip: true; Layout.fillHeight: true; Layout.fillWidth: true; spacing: 10
                model: win.dataState.messages.concat(win.dataState.partial ? [{role:"assistant", content:win.dataState.partial}] : [])
                onContentHeightChanged: positionViewAtEnd()
                delegate: Rectangle {
                    required property var modelData
                    width: messages.width; height: body.implicitHeight + 26; radius: 12
                    color: modelData.role === "user" ? "#e62a3537" : "#e6232335"
                    TextEdit {
                        id: body; anchors.left: parent.left; anchors.right: parent.right; anchors.margins: 14; y: 12
                        text: parent.modelData.content; color: "#E5EBFF"; font.pixelSize: 16
                        readOnly: true; selectByMouse: true; wrapMode: TextEdit.Wrap
                        textFormat: TextEdit.PlainText
                    }
                }
            }
            RowLayout {
                ToolButton { text: win.dataState.listening ? "إيقاف المايك" : "إملاء"; onClicked: desktop.toggleVoice() }
                ToolButton { text: "إرفاق مستند"; enabled: !win.dataState.busy; onClicked: openDoc.open() }
                ToolButton { text: "إزالة المرفق"; visible: !!win.imported; onClicked: {win.imported = ""; win.docNotice = ""} }
                ToolButton { text: "حفظ الرد"; visible: win.dataState.messages.length > 0 && win.dataState.messages[win.dataState.messages.length-1].role === "assistant"
                    onClicked: {win.exportContent = win.dataState.messages[win.dataState.messages.length-1].content; saveDoc.open()} }
                Label { text: win.docNotice; Layout.fillWidth: true; wrapMode: Text.Wrap }
            }
            Label { text: win.dataState.notice; visible: text.length > 0; Layout.fillWidth: true; wrapMode: Text.Wrap; color: "#FFC99A" }
            RowLayout {
                Layout.fillWidth: true
                TextField { id: composer; Layout.fillWidth: true; placeholderText: "اسأل عقل…"; onAccepted: win.submit() }
                Button { text: "خطّة تنفيذ"; enabled: !win.dataState.busy && !!composer.text.trim() && !win.imported; onClicked: desktop.prepareActions(composer.text) }
                Button { text: win.dataState.busy ? "إيقاف" : "إرسال"; onClicked: win.dataState.busy ? desktop.stop() : win.submit() }
            }
        }
    }
    Shortcut { sequence: "Ctrl+I"; onActivated: island.visible = !island.visible }
    Window {
        id: island; title: "جزيرة عقل"; color: "transparent"
        flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool
        property bool expanded: false
        width: expanded ? 380 : 156; height: expanded ? 114 : 48
        x: Math.round((Screen.width-width)/2); y: 12
        Rectangle {
            anchors.fill: parent; radius: 21; color: "#11192E"; border.color: "#9b8aff"
            ColumnLayout {
                anchors.fill: parent; anchors.margins: 6
                RowLayout {
                    Layout.fillWidth: true
                    Image { source: "assets/aql-192.png"; Layout.preferredWidth: 32; Layout.preferredHeight: 32 }
                    Label {
                        Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter
                        text: win.dataState.busy ? "عقل   •   يجيب" : "عقل   •   جاهز"; color: "#E4DFFF"
                        MouseArea { anchors.fill: parent; onPressed: island.startSystemMove() }
                    }
                    ToolButton { text: island.expanded ? "−" : "+"; onClicked: island.expanded = !island.expanded }
                }
                RowLayout {
                    visible: island.expanded
                    TextField { id: quick; Layout.fillWidth: true; placeholderText: "اسأل عقل"; onAccepted: {
                        if (text.trim() && !win.dataState.busy) { desktop.send(text); if (win.dataState.busy) clear() }
                    } }
                    ToolButton { text: win.dataState.busy ? "إيقاف" : "المحادثة"; onClicked: {
                        if (win.dataState.busy) desktop.stop(); else { win.showNormal(); win.raise(); win.requestActivate() }
                    } }
                }
            }
        }
    }
    Dialog {
        id: settings; anchors.centerIn: parent; modal: true; title: "إعدادات المحادثة"
        onOpened: { provider.currentIndex = provider.find(win.dataState.provider); modelName.text = win.dataState.model; secret.clear() }
        ColumnLayout {
            ComboBox { id: provider; model: ["Ollama","OpenAI","Anthropic"]; onActivated: { modelName.text = desktop.modelFor(currentText); secret.clear() } }
            TextField { id: modelName; Layout.preferredWidth: 310; placeholderText: "Model ID" }
            TextField { id: secret; visible: provider.currentText !== "Ollama"; Layout.fillWidth: true; echoMode: TextInput.Password; placeholderText: "مفتاح API جديد" }
            Button { text: "حفظ"; onClicked: { if (desktop.configure(provider.currentText,modelName.text,secret.text)) settings.close() } }
        }
    }
}





