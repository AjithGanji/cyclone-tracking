@echo off
title Auto IMD Updater & GitHub Pusher
cd /d "%~dp0"

echo ===================================================================
echo  Starting Background IMD Scraper and GitHub Pusher...
echo ===================================================================

:: Ensure python and git are on PATH
for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if exist "%%D\resources\app\git\cmd\git.exe" (
        set "PATH=%%D\resources\app\git\cmd;%PATH%"
    )
)
set "PATH=%PATH%;%LOCALAPPDATA%\Programs\Python\Python311;%LOCALAPPDATA%\Programs\Python\Python311\Scripts;C:\Program Files\Git\cmd"

python scripts\auto_push_github.py

pause

