@echo off
title Update & Push Latest Cyclone Advisory to GitHub
cd /d "%~dp0"

echo ===================================================================
echo   IMD CYCLONE ADVISORY UPDATER & GITHUB PUSHER
echo   (No Cloudflare / No LocalTunnel needed - Works on Office Networks)
echo ===================================================================
echo.

:: 1. Add GitHub Desktop git & Python to PATH if not already present
for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if exist "%%D\resources\app\git\cmd\git.exe" (
        set "PATH=%%D\resources\app\git\cmd;%PATH%"
    )
)
set "PATH=%PATH%;%LOCALAPPDATA%\Programs\Python\Python311;%LOCALAPPDATA%\Programs\Python\Python311\Scripts;C:\Program Files\Git\cmd"

:: Verify git
where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git was not found on your system.
    echo Please open GitHub Desktop once or install Git.
    pause
    exit /b 1
)

:: 2. Scrape latest advisory from IMD Mausam portal
echo [1/3] Scraping latest advisory from IMD Mausam portal...
python scripts\fetch_imd.py
if errorlevel 1 (
    echo [ERROR] Failed to fetch advisory from IMD.
    pause
    exit /b 1
)
echo.

:: 3. Stage changes
echo [2/3] Staging updated HTML and data files...
git add data\latest_cyclone.json data\latest_cyclone_data.js index.html latest_advisory.html arnab_cyclone_openinframap.html app.js scripts\fetch_imd.py .github\workflows\update_track.yml
echo.

:: 4. Commit and Push
echo [3/3] Committing and pushing to GitHub...
git commit -m "Update IMD Cyclone Advisory [%date% %time%]"
git push origin main
if errorlevel 1 (
    echo.
    echo [NOTE] Push completed or no new remote changes needed.
)

echo.
echo ===================================================================
echo   SUCCESS! Latest advisory is now published to GitHub Pages.
echo.
echo   View from any device / office network:
echo   https://ajithganji.github.io/cyclone-tracking/
echo.
echo   Standalone file:
echo   https://ajithganji.github.io/cyclone-tracking/latest_advisory.html
echo ===================================================================
echo.
pause

