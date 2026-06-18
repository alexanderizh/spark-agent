@echo off
setlocal

cd /d "%~dp0apps\desktop"
bash scripts/build-win-release.sh x64 --publish never
