@echo off
setlocal
title AI Archive Server

set "NODE_EXE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%i"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE_EXE (
  echo [ERROR] Node.js not found.
  echo Install Node.js from https://nodejs.org/ then run this again.
  pause
  exit /b 1
)

echo Using node: %NODE_EXE%
"%NODE_EXE%" "%~dp0server.mjs"
echo.
echo Server stopped.
pause
