@echo off
chcp 65001 >nul
REM YOLO-Label Windows control panel - launcher for the PowerShell UI.
REM Run from anywhere: double-click or call from cmd.
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0yolo-label.ps1"