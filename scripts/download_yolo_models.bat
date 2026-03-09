@echo off
chcp 65001 >nul
REM YOLO11 模型批量下载 - Windows 批处理入口
REM 双击运行或 cmd 中执行: scripts\download_yolo_models.bat

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0download_yolo_models.ps1"
pause
