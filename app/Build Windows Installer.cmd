@echo off
cd /d "%~dp0"
if not exist "node_modules\electron" (call npm install & if errorlevel 1 goto failed)
call npm run check
if errorlevel 1 goto failed
call npm run build:win
if errorlevel 1 goto failed
echo Installer is in the dist folder.
explorer "%~dp0dist"
pause
exit /b 0
:failed
echo Build failed. Please copy the error output.
pause
