# ==============================================================================
#           Z-SCRAPER - Build Installer Script
#  Execute este script no PowerShell para gerar ZScraper-Setup.exe
# ==============================================================================
#
# REQUISITOS: Inno Setup 6 deve estar instalado.
# Download: https://jrsoftware.org/isdl.php
#
# USO: Abra o PowerShell como Administrador e execute:
#   cd "C:\Users\J.ROBERTO\Downloads\Z-SCRAPPER"
#   .\build-installer.ps1

$ErrorActionPreference = "Stop"
$ProgressPreference = "Continue"

# -- Paths --
$ROOT        = $PSScriptRoot
$INSTALLER   = Join-Path $ROOT "installer"
$DIST        = Join-Path $ROOT "dist"
$DIST_INST   = Join-Path $ROOT "dist-installer"
$NODE_DIR    = Join-Path $INSTALLER "node"
$CHROM_DIR   = Join-Path $INSTALLER "chromium"
$MOD_DIR     = Join-Path $INSTALLER "node_modules"
$CFG_DIR     = Join-Path $INSTALLER "config"
$ISCC_PATHS  = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
)
$ISCC = $ISCC_PATHS | Where-Object { Test-Path $_ } | Select-Object -First 1

# -- Banner --
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "   Z-Scraper - Gerador de Instalador Windows" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

# -- Step 0: Verify Inno Setup --
Write-Host "[0/7] Verificando Inno Setup..." -ForegroundColor Yellow
if (-not $ISCC) {
    Write-Host "  ERRO: Inno Setup nao encontrado nos caminhos padroes." -ForegroundColor Red
    Write-Host "  Baixe e instale em: https://jrsoftware.org/isdl.php" -ForegroundColor Red
    exit 1
}
Write-Host "  OK: Inno Setup encontrado em: $ISCC" -ForegroundColor Green

# -- Step 1: Build Frontend (Vite) --
Write-Host ""
Write-Host "[1/7] Compilando frontend React (Vite)..." -ForegroundColor Yellow
Set-Location $ROOT
npm run build:frontend 2>&1 | Out-String | Write-Host
if ($LASTEXITCODE -ne 0) { Write-Host "  ERRO no build do frontend!" -ForegroundColor Red; exit 1 }
Write-Host "  OK: Frontend compilado em dist/" -ForegroundColor Green

# -- Step 2: Bundle Server --
Write-Host ""
Write-Host "[2/7] Compilando servidor (esbuild bundle)..." -ForegroundColor Yellow
$OldErr = $ErrorActionPreference
$ErrorActionPreference = "Continue"
npx esbuild server.ts `
    --bundle `
    --platform=node `
    --format=cjs `
    --external:playwright `
    --external:playwright-core `
    --external:vite `
    --external:better-sqlite3 `
    --sourcemap `
    --outfile="$DIST\server.cjs" 2>&1 | Out-String | Write-Host
$ErrorActionPreference = $OldErr
if ($LASTEXITCODE -ne 0) { Write-Host "  ERRO no bundle do servidor!" -ForegroundColor Red; exit 1 }
Write-Host "  OK: Servidor compilado em dist/server.cjs" -ForegroundColor Green

# -- Step 3: Download Node.js Portable --
Write-Host ""
Write-Host "[3/7] Baixando Node.js portatil para Windows..." -ForegroundColor Yellow
$NODE_VERSION = "22.16.0"
$NODE_ZIP     = Join-Path $env:TEMP "node-portable.zip"
$NODE_URL     = "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip"

if (Test-Path $NODE_DIR) {
    Write-Host "  Pasta node/ ja existe - pulando download." -ForegroundColor DarkGray
} else {
    Write-Host "  Baixando Node.js v$NODE_VERSION..." -ForegroundColor DarkGray
    Invoke-WebRequest -Uri $NODE_URL -OutFile $NODE_ZIP -UseBasicParsing
    
    Write-Host "  Extraindo..." -ForegroundColor DarkGray
    $TEMP_NODE = Join-Path $env:TEMP "node-extract"
    if (Test-Path $TEMP_NODE) { Remove-Item $TEMP_NODE -Recurse -Force }
    Expand-Archive -Path $NODE_ZIP -DestinationPath $TEMP_NODE -Force
    
    # Move the inner folder to installer/node/
    $INNER = Get-ChildItem $TEMP_NODE -Directory | Select-Object -First 1
    New-Item -ItemType Directory -Path $NODE_DIR -Force | Out-Null
    Copy-Item -Path "$($INNER.FullName)\*" -Destination $NODE_DIR -Recurse -Force
    
    Remove-Item $NODE_ZIP -Force -ErrorAction SilentlyContinue
    Remove-Item $TEMP_NODE -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  OK: Node.js v$NODE_VERSION portatil pronto." -ForegroundColor Green
}

# -- Step 4: Install production node_modules --
Write-Host ""
Write-Host "[4/7] Instalando node_modules de producao..." -ForegroundColor Yellow

    Set-Location $INSTALLER
    # Instala todas as dependencias de producao listadas em installer/package.json
    $OldErr = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    npm install --omit=dev 2>&1 | Out-String | Write-Host
    $ErrorActionPreference = $OldErr
    
    Set-Location $ROOT
    Write-Host "  OK: node_modules de producao prontos." -ForegroundColor Green

# -- Step 5: Download Playwright Chromium --
Write-Host ""
Write-Host "[5/7] Baixando Chromium para o Playwright..." -ForegroundColor Yellow

if (Test-Path $CHROM_DIR) {
    Write-Host "  Chromium ja existe - pulando download." -ForegroundColor DarkGray
} else {
    New-Item -ItemType Directory -Path $CHROM_DIR -Force | Out-Null
    
    $env:PLAYWRIGHT_BROWSERS_PATH = $CHROM_DIR
    $NODE_EXE = Join-Path $NODE_DIR "node.exe"
    $NPX_CMD  = Join-Path $NODE_DIR "npx.cmd"
    
    Write-Host "  Baixando Chromium [~150MB]... Isso pode demorar alguns minutos." -ForegroundColor DarkGray
    & $NPX_CMD playwright install chromium 2>&1 | Out-String | Write-Host
    
    Write-Host "  OK: Chromium baixado." -ForegroundColor Green
}

# -- Step 6: Prepare config files --
Write-Host ""
Write-Host "[6/7] Preparando arquivos de configuracao..." -ForegroundColor Yellow

New-Item -ItemType Directory -Path $CFG_DIR -Force | Out-Null

# Copy .env with credentials
$ENV_SRC = Join-Path $ROOT ".env"
$ENV_DST = Join-Path $CFG_DIR ".env"
Copy-Item $ENV_SRC $ENV_DST -Force
Write-Host "  OK: Credenciais Supabase incluidas no instalador." -ForegroundColor Green

# Copy icon if exists, or create placeholder
$ICON_DST = "$INSTALLER\assets"
New-Item -ItemType Directory -Path $ICON_DST -Force | Out-Null
$ICON_SRC = "$INSTALLER\assets\icon.ico"
if (-not (Test-Path -Path "$ICON_SRC" -ErrorAction SilentlyContinue)) {
    Write-Host "  Aviso: icon.ico nao encontrado em installer/assets/ - usando icone padrao." -ForegroundColor DarkYellow
    try {
        Invoke-WebRequest -Uri "https://raw.githubusercontent.com/microsoft/vscode-icons/main/icons/file_type_node.ico" -OutFile "$ICON_SRC" -UseBasicParsing -ErrorAction SilentlyContinue
    } catch {}
}

# Also copy icon to launcher folder
$LAUNCH_ICON = "$INSTALLER\launcher\icon.ico"
if ( (Test-Path -Path "$ICON_SRC" -ErrorAction SilentlyContinue) -and (-not (Test-Path -Path "$LAUNCH_ICON" -ErrorAction SilentlyContinue)) ) {
    Copy-Item "$ICON_SRC" "$LAUNCH_ICON" -Force
}

Write-Host "  OK: Arquivos de configuracao prontos." -ForegroundColor Green

# -- Step 7: Run Inno Setup to generate .exe --
Write-Host ""
Write-Host "[7/7] Gerando instalador ZScraper-Setup.exe com Inno Setup..." -ForegroundColor Yellow

New-Item -ItemType Directory -Path $DIST_INST -Force | Out-Null

$ISS_FILE = Join-Path $INSTALLER "setup.iss"
& $ISCC $ISS_FILE 2>&1 | Out-String | Write-Host

if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERRO ao gerar o instalador!" -ForegroundColor Red
    exit 1
}

$EXE_PATH = Join-Path $DIST_INST "ZScraper-Setup.exe"
if (Test-Path $EXE_PATH) {
    $EXE_SIZE = [math]::Round((Get-Item $EXE_PATH).Length / 1MB, 1)
    
    Write-Host ""
    Write-Host "  ============================================" -ForegroundColor Green
    Write-Host "   INSTALADOR GERADO COM SUCESSO!" -ForegroundColor Green
    Write-Host "  ============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Arquivo: $EXE_PATH" -ForegroundColor White
    Write-Host "  Tamanho: $EXE_SIZE MB" -ForegroundColor White
    Write-Host ""
    Write-Host "  Compartilhe este arquivo com o outro computador." -ForegroundColor Cyan
    Write-Host "  Basta executar ZScraper-Setup.exe para instalar tudo automaticamente." -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host "  ERRO: O arquivo do instalador nao foi encontrado no destino esperado." -ForegroundColor Red
    exit 1
}
