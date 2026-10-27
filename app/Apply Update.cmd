@echo off
cd /d "%~dp0"
echo Close Hearth Audiobooks before applying a patch.
echo Put exactly one patch ZIP into the updates folder.
echo.
where py >nul 2>&1
if %errorlevel%==0 (py -3 apply_patch.py) else (python apply_patch.py)
if errorlevel 1 goto failed
echo.
echo Patch applied. You may start Hearth now.
pause
exit /b 0
:failed
echo.
echo Update failed. Your existing application should remain unchanged.
pause
exit /b 1
