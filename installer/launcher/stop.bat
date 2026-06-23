@echo off
:: Z-Scraper - Stop Server

set APP_DIR=%~dp0..
set PID_FILE=%TEMP%\zscraper.pid

if not exist "%PID_FILE%" (
    echo Z-Scraper nao esta rodando.
    timeout /t 2 /nobreak >NUL
    exit /b 0
)

set /p SERVER_PID=<"%PID_FILE%"

echo Encerrando Z-Scraper (PID: %SERVER_PID%)...

taskkill /PID %SERVER_PID% /F >NUL 2>&1

del "%PID_FILE%" >NUL 2>&1

echo Z-Scraper encerrado com sucesso.
timeout /t 2 /nobreak >NUL
