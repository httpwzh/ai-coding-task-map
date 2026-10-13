@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
set "VITE_JS=%~dp0node_modules\vite\bin\vite.js"
set "APP_URL=http://127.0.0.1:4173"

if not exist "%VITE_JS%" (
  echo [ERROR] Dependencies are missing.
  echo Run install-dsh-task-map.bat or pnpm install in this folder first.
  pause
  exit /b 1
)

if not exist "%NODE_EXE%" (
  where node >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Node.js runtime was not found.
    echo Start DeepSeek Harness once, or install Node.js, then retry.
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
)

netstat -ano | findstr /R /C:":4173 .*LISTENING" >nul
if %ERRORLEVEL% EQU 0 (
  echo Existing server found on port 4173.
) else (
  echo Starting AI Task Map server...
  start "AI Task Map Server" /min "%NODE_EXE%" "%VITE_JS%" preview --host 127.0.0.1 --port 4173 --strictPort
  timeout /t 3 /nobreak >nul
)

start "AI Task Map Browser" "%APP_URL%"
echo URL: %APP_URL%
echo Close the minimized server window to stop the service.
