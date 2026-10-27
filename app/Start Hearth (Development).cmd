@echo off
cd /d "%~dp0"
if not exist "node_modules\electron" (echo Installing dependencies for first run... & call npm install & if errorlevel 1 goto failed)
call npm run dev
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo Something went wrong. Copy this window output to ChatGPT.
pause
