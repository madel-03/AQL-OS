[Setup]
AppId=AQL.Desktop
AppName=AQL
AppVersion=0.1.0
DefaultDirName={localappdata}\Programs\AQL
PrivilegesRequired=lowest
OutputDir=dist\installer
OutputBaseFilename=AQL-Setup
Compression=lzma2
SolidCompression=yes
UninstallDisplayIcon={app}\AQL-Desktop.exe

[Files]
Source: "dist\clipboard-search\AQL-Desktop\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{userprograms}\AQL"; Filename: "{app}\AQL-Desktop.exe"

[Run]
Filename: "{app}\AQL-Desktop.exe"; Description: "Open AQL"; Flags: postinstall nowait skipifsilent
