#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#ifndef PayloadRoot
  #define PayloadRoot "..\build\windows\payload"
#endif
#ifndef AssetsRoot
  #define AssetsRoot "..\build\branding"
#endif
#ifndef OutputRoot
  #define OutputRoot "..\release"
#endif
#ifndef ChineseLanguageFile
  #define ChineseLanguageFile "ChineseSimplified.isl"
#endif
#ifndef LicenseFile
  #define LicenseFile "..\LICENSE"
#endif

[Setup]
AppId={{7C9A5E42-5184-4C91-9780-7C4868467B46}
AppName=天平校验视频分析系统
AppVersion={#MyAppVersion}
AppVerName=天平校验视频分析系统 {#MyAppVersion}
AppPublisher=WoodenP1ckaxe
AppPublisherURL=https://github.com/WoodenP1ckaxe/tianping-video-verification
AppSupportURL=https://github.com/WoodenP1ckaxe/tianping-video-verification/issues
AppUpdatesURL=https://github.com/WoodenP1ckaxe/tianping-video-verification/releases
VersionInfoVersion={#MyAppVersion}
VersionInfoProductName=天平校验视频分析系统
VersionInfoDescription=天平校验视频分析系统完全离线安装程序
VersionInfoCopyright=Copyright (c) 2026 WoodenP1ckaxe
DefaultDirName={localappdata}\Programs\TianpingVideoVerification
DefaultGroupName=天平校验视频分析系统
DisableProgramGroupPage=yes
DisableWelcomePage=no
AllowNoIcons=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputRoot}
OutputBaseFilename=TianpingVideoVerification-{#MyAppVersion}-Windows-x64-Setup
SetupIconFile={#AssetsRoot}\app.ico
WizardImageFile={#AssetsRoot}\wizard-large.bmp
WizardSmallImageFile={#AssetsRoot}\wizard-small.bmp
UninstallDisplayIcon={app}\control\TianpingControl.exe
UninstallDisplayName=天平校验视频分析系统 {#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
UsePreviousAppDir=yes
UsePreviousTasks=yes
LicenseFile={#LicenseFile}
SetupLogging=yes
ChangesEnvironment=no

[Languages]
Name: "chs"; MessagesFile: "{#ChineseLanguageFile}"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: unchecked
Name: "autostart"; Description: "登录 Windows 后自动启动本系统"; GroupDescription: "附加任务："

[Files]
Source: "{#PayloadRoot}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadRoot}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadRoot}\control\*"; DestDir: "{app}\control"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadRoot}\docs\*"; DestDir: "{app}\docs"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadRoot}\licenses\*"; DestDir: "{app}\licenses"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\天平校验视频分析系统"; Filename: "{app}\control\TianpingControl.exe"; WorkingDir: "{app}"; IconFilename: "{app}\control\TianpingControl.exe"
Name: "{group}\使用说明"; Filename: "{app}\docs\使用说明.html"
Name: "{group}\卸载天平校验视频分析系统"; Filename: "{uninstallexe}"
Name: "{autodesktop}\天平校验视频分析系统"; Filename: "{app}\control\TianpingControl.exe"; WorkingDir: "{app}"; IconFilename: "{app}\control\TianpingControl.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "TianpingVideoVerification"; ValueData: """{app}\control\TianpingControl.exe"" --autostart"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\control\TianpingControl.exe"; Parameters: "--first-run"; Description: "立即启动天平校验视频分析系统"; Flags: nowait postinstall skipifsilent
Filename: "{app}\docs\使用说明.html"; Description: "打开快速使用说明"; Flags: shellexec nowait postinstall skipifsilent unchecked

[UninstallRun]
Filename: "{app}\control\TianpingControl.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated
