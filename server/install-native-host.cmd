@echo off
setlocal
rem Install the native messaging host for Edge and Chrome (current user, no admin).
rem It generates native-host.json with this folder's real path, then registers it.

set "HOST=com.dsh.ai_archive"
set "DIR=%~dp0"
set "EXT_ID=ddljaaccplhdcomcmmcfjmnlfajonhol"
set "MANIFEST=%DIR%native-host.json"

if not exist "%DIR%native-host.mjs" (
  echo [ERROR] native-host.mjs not found next to this script.
  pause
  exit /b 1
)

set "NODE_OK="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_OK set "NODE_OK=%%i"
if not defined NODE_OK if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_OK=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_OK if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_OK=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_OK (
  echo [WARN] Node.js was not found in PATH.
  echo        Install it from https://nodejs.org/ before using the extension.
)

rem JSON needs doubled backslashes in paths
set "DIRJSON=%DIR:\=\\%"

> "%MANIFEST%" echo {
>>"%MANIFEST%" echo   "name": "%HOST%",
>>"%MANIFEST%" echo   "description": "AI Archive server launcher",
>>"%MANIFEST%" echo   "path": "%DIRJSON%native-host.cmd",
>>"%MANIFEST%" echo   "type": "stdio",
>>"%MANIFEST%" echo   "allowed_origins": ["chrome-extension://%EXT_ID%/"]
>>"%MANIFEST%" echo }

echo Wrote %MANIFEST%

reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST%" /ve /t REG_SZ /d "%MANIFEST%" /f
if errorlevel 1 (
  echo [ERROR] failed to write the Edge registry key
  pause
  exit /b 1
)
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST%" /ve /t REG_SZ /d "%MANIFEST%" /f

echo.
echo [OK] registered %HOST%
echo      manifest: %MANIFEST%
echo.
echo Next: close ALL browser windows, reopen, then reload the extension.
pause
