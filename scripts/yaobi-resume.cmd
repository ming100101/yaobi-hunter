@echo off
REM Double-click this to RESUME Yaobi background jobs (clears the KILL switch and
REM relaunches the app + recorder).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0yaobi-ctl.ps1" resume
echo.
pause
