@echo off
title 2 - Cloudflare Tunnel
cd /d "%~dp0\.."

echo ===================================================================
echo  [Cloudflare Tunnel]
echo  Waiting 4 seconds for Python server (Tab 1) to initialize...
echo ===================================================================
ping 127.0.0.1 -n 5 >nul

echo Starting Cloudflare Quick Tunnel...
cloudflared tunnel --url http://localhost:8000

