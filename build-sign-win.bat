@echo off
setlocal

cd /d "%~dp0apps\desktop"
rem Backward-compatible alias. The build is unsigned unless WIN_CSC_LINK and
rem WIN_CSC_KEY_PASSWORD are provided.
bash scripts/build-win-release.sh x64 --publish never
