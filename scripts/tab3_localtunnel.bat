@echo off
title 3 - LocalTunnel (cyclone-tracker)
cd /d "%~dp0\.."

echo ===================================================================
echo  [LocalTunnel]
echo  Waiting 8 seconds for Python server and Cloudflare to start...
echo ===================================================================
ping 127.0.0.1 -n 9 >nul

echo Starting LocalTunnel with retry loop for https://cyclone-tracker.loca.lt/...
python scripts\run_localtunnel.py

