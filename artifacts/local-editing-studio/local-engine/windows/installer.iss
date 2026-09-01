#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{D507B035-C013-4CE4-B072-52FA249EE19A}
AppName=Local Editing Engine
AppVersion={#AppVersion}
DefaultDirName={autopf}\Local Editing Studio
DefaultGroupName=Local Editing Studio
OutputDir=..\dist
OutputBaseFilename=LocalEditingEngine-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\engine\LocalEditingEngine.exe
WizardStyle=modern

[Files]
Source: "..\dist\LocalEditingEngine\*"; DestDir: "{app}\engine"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "Start-Engine.ps1"; DestDir: "{app}\commands"; Flags: ignoreversion
Source: "Stop-Engine.ps1"; DestDir: "{app}\commands"; Flags: ignoreversion
Source: "Show-Status.ps1"; DestDir: "{app}\commands"; Flags: ignoreversion
Source: "Migrate-Data.ps1"; Flags: dontcopy
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\تشغيل محرك المونتاج"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\commands\Start-Engine.ps1"""; WorkingDir: "{app}"
Name: "{group}\حالة محرك المونتاج ورمز الاقتران"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\commands\Show-Status.ps1"""; WorkingDir: "{app}"
Name: "{group}\إيقاف محرك المونتاج"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\commands\Stop-Engine.ps1"""; WorkingDir: "{app}"
Name: "{group}\إزالة محرك المونتاج"; Filename: "{uninstallexe}"
Name: "{autodesktop}\تشغيل محرك المونتاج"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\commands\Start-Engine.ps1"""; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "إنشاء اختصار تشغيل على سطح المكتب"; GroupDescription: "اختصارات إضافية:"
Name: "autostart"; Description: "تشغيل المحرك عند تسجيل الدخول"; GroupDescription: "التشغيل:"

[Registry]
Root: HKA; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "LocalEditingEngine"; ValueData: """{sys}\WindowsPowerShell\v1.0\powershell.exe"" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\commands\Start-Engine.ps1"""; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\commands\Start-Engine.ps1"""; Description: "تشغيل محرك المونتاج الآن"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\commands\Stop-Engine.ps1"" -Silent"; Flags: runhidden; RunOnceId: "StopEngine"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  ExtractTemporaryFile('Migrate-Data.ps1');
  if not Exec(
    ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File "' +
      ExpandConstant('{tmp}\Migrate-Data.ps1') + '" -InstallDir "' +
      ExpandConstant('{app}') + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode
  ) then
  begin
    Result := 'تعذر تشغيل أداة ترحيل المشاريع المحلية. لم يتم تثبيت التحديث.';
    exit;
  end;
  if ResultCode <> 0 then
  begin
    Result := 'تعذر نقل المشاريع المحلية بأمان. لم يتم تثبيت التحديث ولم تُحذف البيانات القديمة.';
    exit;
  end;
  Result := '';
end;