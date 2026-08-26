@echo off
rem Spark CLI installer wrapper for cmd.exe users. Delegates to install.ps1,
rem which implements the actual download/verify/install flow.
setlocal
set "SCRIPT=%~dp0install.ps1"
if not exist "%SCRIPT%" set "SCRIPT=install.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
exit /b %ERRORLEVEL%
