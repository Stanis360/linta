@echo off
title Baustellen-Server
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js fehlt. Bitte von https://nodejs.org installieren. & pause & exit /b)
node server.js
pause
