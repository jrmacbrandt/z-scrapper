[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}}
AppName=Z-Scraper
AppVersion=1.1.0
AppVerName=Z-Scraper v1.1.0
AppPublisher=Z-Scraper
AppPublisherURL=http://localhost:3000
DefaultDirName={autopf}\ZScraper
DefaultGroupName=Z-Scraper
AllowNoIcons=yes
OutputDir=..\dist-installer
OutputBaseFilename=ZScraper-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64
MinVersion=10.0


[Languages]
Name: "portuguese"; MessagesFile: "compiler:Languages\Portuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na &Área de Trabalho"; GroupDescription: "Atalhos adicionais:"; Flags: checkedonce
Name: "startmenuicon"; Description: "Criar atalho no &Menu Iniciar"; GroupDescription: "Atalhos adicionais:"; Flags: checkedonce
Name: "startup"; Description: "Iniciar o Z-Scraper com o Windows"; GroupDescription: "Inicialização:"; Flags: unchecked


[Files]
; Node.js portable
Source: "..\installer\node\*"; DestDir: "{app}\node"; Flags: ignoreversion recursesubdirs createallsubdirs

; App compiled files (dist/)
Source: "..\dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs createallsubdirs

; Playwright Chromium browsers
Source: "..\installer\chromium\*"; DestDir: "{app}\chromium"; Flags: ignoreversion recursesubdirs createallsubdirs

; node_modules (playwright only)
Source: "..\installer\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

; Launcher scripts
Source: "..\installer\launcher\launch.bat"; DestDir: "{app}\launcher"; Flags: ignoreversion
Source: "..\installer\launcher\stop.bat"; DestDir: "{app}\launcher"; Flags: ignoreversion

; .env with Supabase credentials
Source: "..\installer\config\.env"; DestDir: "{app}"; Flags: ignoreversion

; package.json (needed at runtime)
Source: "..\package.json"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Z-Scraper"; Filename: "{app}\launcher\launch.bat"; WorkingDir: "{app}"
Name: "{group}\Parar Z-Scraper"; Filename: "{app}\launcher\stop.bat"; WorkingDir: "{app}"
Name: "{group}\Desinstalar Z-Scraper"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Z-Scraper"; Filename: "{app}\launcher\launch.bat"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\Z-Scraper"; Filename: "{app}\launcher\launch.bat"; WorkingDir: "{app}"; Tasks: startup

[Run]
Filename: "{app}\launcher\launch.bat"; Description: "Abrir Z-Scraper agora"; Flags: nowait postinstall skipifsilent shellexec

[UninstallRun]
Filename: "{app}\launcher\stop.bat"; Flags: shellexec runhidden; RunOnceId: "StopServer"
