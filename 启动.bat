@echo off
chcp 65001 >nul
rem 游戏开发者终端 · 坐席 —— 双击即起
rem 起服务（已在跑就跳过），然后用无地址栏窗口打开，当常驻屏用

cd /d "%~dp0"

netstat -ano | findstr "127.0.0.1:4280" | findstr LISTENING >nul
if errorlevel 1 (
  echo 起坐席服务...
  start "" /b node server.js
  timeout /t 2 /nobreak >nul
) else (
  echo 坐席已在跑，直接开窗。
)

rem --app 模式：没有地址栏和标签页，像个独立应用。常驻屏要的就是这个
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist %CHROME% (
  start "" %CHROME% --app=http://127.0.0.1:4280 --start-fullscreen
) else (
  start "" msedge --app=http://127.0.0.1:4280 --start-fullscreen
)
