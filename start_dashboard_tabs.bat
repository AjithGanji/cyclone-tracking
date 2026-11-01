@echo off
title Cyclone Dashboard Launcher
cd /d "%~dp0"

echo ===================================================================
echo  Starting Cyclone Tracking Dashboard in Windows Terminal
echo  Single Window with 3 Command Prompt Tabs:
echo    [Tab 1] Python Server
echo    [Tab 2] Cloudflare Tunnel (starts after 4s)
echo    [Tab 3] LocalTunnel (starts after 8s)
echo ===================================================================
echo.

:: Ensure all required tools are on PATH
set "PATH=%PATH%;%LOCALAPPDATA%\Microsoft\WindowsApps;C:\Program Files\nodejs;%LOCALAPPDATA%\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe;%LOCALAPPDATA%\Programs\Python\Python311;%LOCALAPPDATA%\Programs\Python\Python311\Scripts"

:: Ensure Git is on PATH (including GitHub Desktop bundled Git)
for /d %%G in ("%LOCALAPPDATA%\GitHubDesktop\app-*\resources\app\git\cmd") do (
  if exist "%%~G\git.exe" set "PATH=%PATH%;%%~G"
)

:: Launch all 3 Command Prompt tabs inside ONE single Windows Terminal window
wt.exe -w new -d "%CD%" -p "Command Prompt" --title "1 - Python Server" cmd /k "python server.py" ; new-tab -d "%CD%" -p "Command Prompt" --title "2 - Cloudflare Tunnel" cmd /k "scripts\tab2_cloudflare.bat" ; new-tab -d "%CD%" -p "Command Prompt" --title "3 - LocalTunnel" cmd /k "scripts\tab3_localtunnel.bat"

exit
