# YOLO11 模型批量下载脚本 (Windows PowerShell)
# 自动下载目标检测和实例分割的全部尺寸模型
# 用法: 在 PowerShell 中执行 .\scripts\download_yolo_models.ps1
# 或右键 -> 使用 PowerShell 运行

$ErrorActionPreference = "Stop"
$BaseUrl = "https://github.com/ultralytics/assets/releases/download/v8.4.0"

# 目标检测模型 (n/s/m/l/x)
$DetectionModels = @(
    "yolo11n.pt",
    "yolo11s.pt",
    "yolo11m.pt",
    "yolo11l.pt",
    "yolo11x.pt"
)

# 实例分割模型
$SegmentationModels = @(
    "yolo11n-seg.pt",
    "yolo11s-seg.pt",
    "yolo11m-seg.pt",
    "yolo11l-seg.pt",
    "yolo11x-seg.pt"
)

$AllModels = $DetectionModels + $SegmentationModels

# 输出目录：优先用 MODELS_DIR 环境变量；否则脚本在 project/scripts/ 时用 project/models，否则用当前目录/models
if ($env:MODELS_DIR) {
    $ModelsDir = $env:MODELS_DIR
} elseif ($PSScriptRoot) {
    $ModelsDir = Join-Path (Split-Path -Parent $PSScriptRoot) "models"
} else {
    $ModelsDir = Join-Path (Get-Location).Path "models"
}

if (-not (Test-Path $ModelsDir)) {
    New-Item -ItemType Directory -Path $ModelsDir -Force | Out-Null
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " YOLO11 模型批量下载" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "输出目录: $ModelsDir" -ForegroundColor Gray
Write-Host ""

$ok = 0
$skip = 0
$fail = 0

foreach ($name in $AllModels) {
    $dst = Join-Path $ModelsDir $name
    $url = "$BaseUrl/$name"

    if (Test-Path $dst) {
        Write-Host "[跳过] $name (已存在)" -ForegroundColor Yellow
        $skip++
        continue
    }

    try {
        Write-Host "[下载] $name ..." -ForegroundColor White -NoNewline
        # 使用 TLS 1.2，兼容 GitHub
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $url -OutFile $dst -UseBasicParsing -TimeoutSec 120
        Write-Host " 完成" -ForegroundColor Green
        $ok++
    }
    catch {
        Write-Host " 失败: $($_.Exception.Message)" -ForegroundColor Red
        $fail++
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " 下载完成: 成功 $ok, 跳过 $skip, 失败 $fail" -ForegroundColor Cyan
Write-Host " 模型保存至: $ModelsDir" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if ($fail -gt 0) {
    exit 1
}
