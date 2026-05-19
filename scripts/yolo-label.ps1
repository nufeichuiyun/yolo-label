#Requires -Version 5.1
<#
.SYNOPSIS
    YOLO-Label Windows 控制面板

.DESCRIPTION
    交互式管理 Docker Compose 服务（启动 / 停止 / 状态 / 日志 / 重建等）。
    需要 Docker Desktop（WSL2 后端）。GPU 用户需安装 NVIDIA 驱动并在
    Docker Desktop 中启用 GPU 支持。

.NOTES
    项目根目录通过脚本所在位置自动定位；无需手动改路径。
    可通过环境变量覆盖：
      DOCKER_BIN  Docker 可执行文件所在目录（默认走 PATH）
      SHM_SIZE    Celery worker 共享内存大小（默认 2g，32GB+ 内存建议 4g）
      GPU         设为 0 跳过 GPU compose 覆盖（CPU-only 部署时使用）
#>

$ErrorActionPreference = "Continue"

# ===== 自动定位项目根目录（脚本在 scripts/ 下，根目录为上一级）=====
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# ===== 自动定位 Docker =====
if ($env:DOCKER_BIN -and (Test-Path "$env:DOCKER_BIN\docker.exe")) {
    $env:PATH = "$env:DOCKER_BIN;$env:PATH"
} elseif (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    $defaultDocker = "C:\Program Files\Docker\Docker\resources\bin"
    if (Test-Path "$defaultDocker\docker.exe") {
        $env:PATH = "$defaultDocker;$env:PATH"
    } else {
        Write-Host "[错误] 找不到 docker。请先安装 Docker Desktop 或设置环境变量 DOCKER_BIN。" -ForegroundColor Red
        Read-Host "按回车退出"; exit 1
    }
}

# ===== Compose 文件组合 =====
if (-not $env:SHM_SIZE) { $env:SHM_SIZE = "2g" }

$CF = @("-f","docker-compose.yml","-f","docker-compose.dev.yml")
if ($env:GPU -ne "0") {
    if (Test-Path (Join-Path $ProjectDir "docker-compose.gpu.yml")) {
        $CF += @("-f","docker-compose.gpu.yml")
    }
}

if (-not (Test-Path (Join-Path $ProjectDir "docker-compose.yml"))) {
    Write-Host "[错误] 找不到 docker-compose.yml，请确认脚本位于项目的 scripts/ 目录下" -ForegroundColor Red
    Read-Host "按回车退出"; exit 1
}
Set-Location $ProjectDir

function Show-Menu {
    Clear-Host
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "   YOLO-Label 控制面板" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "   1. 启动服务"
    Write-Host "   2. 停止服务"
    Write-Host "   3. 查看状态"
    Write-Host "   4. 查看日志（实时，Ctrl+C 退出）"
    Write-Host "   5. 重启服务"
    Write-Host "   6. 打开浏览器"
    Write-Host "   7. 重建镜像（代码或依赖变动后用）"
    Write-Host "   8. 初始化数据库 / 重置 admin 密码"
    Write-Host "   0. 退出"
    Write-Host "==========================================" -ForegroundColor Cyan
    $gpu = if ($env:GPU -eq "0") { "CPU-only" } else { "GPU" }
    Write-Host ("   模式: {0}   SHM_SIZE: {1}" -f $gpu, $env:SHM_SIZE) -ForegroundColor DarkGray
}

function Pause-Menu { Read-Host "`n按回车返回菜单" | Out-Null }

function Do-Start {
    Write-Host "`n[启动中] 正在启动所有服务..." -ForegroundColor Yellow
    & docker compose @CF up -d
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n[成功] 服务已启动" -ForegroundColor Green
        Write-Host "  前端: http://localhost:3000"
        Write-Host "  API:  http://localhost:8000/docs"
        Write-Host "  默认账号: admin / admin123（首次运行后请尽快修改）"
    } else {
        Write-Host "`n[失败] 启动出错，请查看上方输出" -ForegroundColor Red
    }
    Pause-Menu
}

function Do-Stop {
    Write-Host "`n[停止中] 停止所有容器，数据卷会保留..." -ForegroundColor Yellow
    & docker compose @CF down
    Pause-Menu
}

function Do-Status {
    Write-Host "`n=== 容器状态 ===" -ForegroundColor Cyan
    & docker compose @CF ps
    Write-Host "`n=== GPU 状态（celery-worker 内）===" -ForegroundColor Cyan
    $gpu = & docker exec yolo-label-celery-worker python -c "import torch; print('CUDA available:', torch.cuda.is_available()); print('Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')" 2>$null
    if ($LASTEXITCODE -eq 0) { $gpu } else { Write-Host "  [worker 未运行]" -ForegroundColor Yellow }
    Write-Host "`n=== 端口检测 ===" -ForegroundColor Cyan
    foreach ($p in @(3000,8000)) {
        $r = Test-NetConnection -ComputerName 127.0.0.1 -Port $p -InformationLevel Quiet -WarningAction SilentlyContinue
        $tag = if ($r) { "OK" } else { "NOT REACHABLE" }
        $color = if ($r) { "Green" } else { "Red" }
        Write-Host ("  Port {0,-5} : {1}" -f $p, $tag) -ForegroundColor $color
    }
    Pause-Menu
}

function Do-Logs {
    Write-Host "`n选择查看哪个服务的日志："
    Write-Host "   1. 全部"
    Write-Host "   2. backend（API）"
    Write-Host "   3. celery-worker（训练/推理）"
    Write-Host "   4. frontend"
    Write-Host "   0. 返回"
    $c = Read-Host "请选择"
    switch ($c) {
        "1" { & docker compose @CF logs -f --tail=50 }
        "2" { & docker compose @CF logs -f --tail=50 backend }
        "3" { & docker compose @CF logs -f --tail=50 celery-worker }
        "4" { & docker compose @CF logs -f --tail=50 frontend }
    }
}

function Do-Restart {
    Write-Host "`n[重启中] 正在重启所有服务..." -ForegroundColor Yellow
    & docker compose @CF restart
    Pause-Menu
}

function Do-Open { Start-Process "http://localhost:3000" }

function Do-Build {
    Write-Host "`n[重建中] 重新构建后端和前端镜像（首次约 10-20 分钟）" -ForegroundColor Yellow
    $c = Read-Host "确认继续？(y/N)"
    if ($c -ne "y" -and $c -ne "Y") { return }
    & docker compose @CF build
    Write-Host "`n[完成] 选择 1. 启动服务 以新镜像启动" -ForegroundColor Green
    Pause-Menu
}

function Do-InitDb {
    Write-Host "`n[初始化] 创建数据库表并写入默认管理员（如已存在则跳过）..." -ForegroundColor Yellow
    & docker exec yolo-label-backend python init_db.py
    Pause-Menu
}

while ($true) {
    Show-Menu
    $choice = Read-Host "请选择"
    switch ($choice) {
        "1" { Do-Start }
        "2" { Do-Stop }
        "3" { Do-Status }
        "4" { Do-Logs }
        "5" { Do-Restart }
        "6" { Do-Open }
        "7" { Do-Build }
        "8" { Do-InitDb }
        "0" { exit 0 }
    }
}
