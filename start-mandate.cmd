@echo off
title Mandate launcher
echo Starting the signet Alby Hub. Leave its window open while you use Mandate.
start "Alby Hub (signet)" wsl.exe -d Ubuntu --exec bash -c "cd ~/albyhub && LD_LIBRARY_PATH=$PWD/lib exec ./bin/albyhub"
timeout /t 8 >nul
echo Starting the Mandate engine. Leave its window open too.
start "Mandate engine" cmd /k "cd /d %~dp0 && node src/server.mjs"
echo.
echo Next:
echo   1. Open http://localhost:8080 and unlock the hub with your password.
echo   2. Open https://mandate-proof.ibnweb3lab.workers.dev/ and click Console.
echo      If your browser asks to allow access to your local network, click Allow.
echo.
pause
