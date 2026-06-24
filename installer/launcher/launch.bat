@echo off
setlocal enabledelayedexpansion

:: ─────────────────────────────────────────────────
::  Z-Scraper Launcher
::  Inicia o servidor Node.js e abre o navegador
:: ─────────────────────────────────────────────────

set "APP_DIR=%~dp0.."
cd /d "%APP_DIR%"

set "NODE_EXE=%APP_DIR%\node\node.exe"
set "SERVER_FILE=%APP_DIR%\dist\server.cjs"
set "PORT=3000"
set "PID_FILE=%TEMP%\zscraper.pid"

:: Configurar ambiente de producao
set "NODE_ENV=production"
set "PLAYWRIGHT_BROWSERS_PATH=%APP_DIR%\chromium"
set "NODE_PATH=%APP_DIR%\node_modules"

:: Verificar se o servidor ja esta rodando
if exist "%PID_FILE%" (
    set /p OLD_PID=<"%PID_FILE%"
    tasklist /FI "PID eq !OLD_PID!" 2>NUL | find "node.exe" >NUL
    if !errorlevel! == 0 (
        echo.
        echo  Z-Scraper ja esta rodando!
        echo  Abrindo janela proprietaria em http://localhost:%PORT%...
        timeout /t 1 /nobreak >NUL
        set "EDGE_EXE="
        if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
            set "EDGE_EXE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
        ) else if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
            set "EDGE_EXE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
        )
        if defined EDGE_EXE (
            start "" "!EDGE_EXE!" --app="http://localhost:%PORT%" --window-size=1280,800
        ) else (
            start "" "http://localhost:%PORT%"
        )
        exit /b 0
    )
    del "%PID_FILE%" >NUL 2>&1
)

title Z-Scraper v1.1.0

echo.
echo  =========================================
echo   Z-Scraper v1.1.0
echo   Extrator de Corretores - Zap Imoveis
echo  =========================================
echo.
echo  Iniciando servidor...

:: Iniciar o servidor Node.js em background
start /B "" "%NODE_EXE%" "%SERVER_FILE%" > "%TEMP%\zscraper.log" 2>&1

:: Capturar o PID do node
timeout /t 2 /nobreak >NUL
for /f "tokens=2 delims= " %%P in ('tasklist /FI "IMAGENAME eq node.exe" /FO TABLE /NH 2^>NUL') do (
    echo %%P > "%PID_FILE%"
    goto :pid_saved
)
:pid_saved

:: Aguardar o servidor ficar pronto (ate 25 segundos)
set /a TRIES=0
echo  Aguardando servidor iniciar...
:wait_loop
timeout /t 1 /nobreak >NUL
set /a TRIES+=1

powershell -NoProfile -Command ^
  "try { $null = Invoke-WebRequest -Uri 'http://localhost:%PORT%' -TimeoutSec 1 -UseBasicParsing; exit 0 } catch { exit 1 }" >NUL 2>&1

if %errorlevel% == 0 goto :server_ready
if %TRIES% lss 25 goto :wait_loop

echo  Servidor demorou para iniciar. Abrindo navegador mesmo assim...

:server_ready
echo.
echo  =========================================
echo   Servidor ativo: http://localhost:%PORT%
echo  =========================================
echo.
echo  O aplicativo foi aberto no seu navegador.
echo  NAO feche esta janela enquanto usar o
echo  Z-Scraper.
echo.
echo  Para encerrar: feche esta janela ou use
echo  o atalho "Parar Z-Scraper".
echo  =========================================
echo.

:: Abrir em janela proprietaria (Microsoft Edge App Mode) se disponivel, caso contrario no navegador padrao
set "EDGE_EXE="
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    set "EDGE_EXE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
) else if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    set "EDGE_EXE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)

if defined EDGE_EXE (
    start "" "%EDGE_EXE%" --app="http://localhost:%PORT%" --window-size=1280,800
) else (
    start "" "http://localhost:%PORT%"
)

:: Manter a janela aberta enquanto o servidor rodar
:keep_alive
timeout /t 5 /nobreak >NUL
if exist "%PID_FILE%" (
    tasklist /FI "IMAGENAME eq node.exe" 2>NUL | find "node.exe" >NUL
    if !errorlevel! == 0 goto :keep_alive
)

echo.
echo  Servidor encerrado.
del "%PID_FILE%" >NUL 2>&1
pause
