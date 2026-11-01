@echo off
title Pull Latest IMD Cyclone Advisory
cd /d "%~dp0"

echo ===================================================================
echo  🌀 Checking IMD Mausam & Pulling Latest Cyclone Advisory...
echo ===================================================================
echo.

:: Ensure tools and Git are on PATH
set "PATH=%PATH%;%LOCALAPPDATA%\Microsoft\WindowsApps;C:\Program Files\nodejs;%LOCALAPPDATA%\Programs\Python\Python311;%LOCALAPPDATA%\Programs\Python\Python311\Scripts"
for /d %%G in ("%LOCALAPPDATA%\GitHubDesktop\app-*\resources\app\git\cmd") do (
  if exist "%%~G\git.exe" set "PATH=%PATH%;%%~G"
)

python scripts\fetch_imd.py

echo.
echo ===================================================================
echo  Done! Press any key to exit this window.
echo ===================================================================
pause

