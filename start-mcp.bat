@echo off
setlocal
cd /d %~dp0
if not exist dist\index.js (
  echo dist\index.js not found. Running npm run build...
  call npm run build || exit /b 1
)
node dist\index.js
