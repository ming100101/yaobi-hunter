@echo off
REM Double-click this to STOP all Yaobi background jobs (app + recorder) and
REM keep them off across reboots. Run yaobi-resume.cmd to turn back on.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0yaobi-ctl.ps1" kill
echo.
pause
