#!/bin/bash

# RKNN Toolkit2 x64 PC 一键安装脚本
# 适用于 x86_64 架构的 Linux 系统

set -e  # 遇到错误立即退出

echo "🚀 开始安装 RKNN Toolkit2 for x64 PC..."

# 检查系统架构
ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ]; then
    echo "❌ 错误: 此脚本仅支持 x86_64 架构的系统"
    echo "当前系统架构: $ARCH"
    exit 1
fi

# 检查 Python 版本
echo "🔍 检查 Python 环境..."
if ! command -v python3 &> /dev/null; then
    echo "❌ 错误: 未找到 python3，请先安装 Python 3.10"
    exit 1
fi

PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "✅ 检测到 Python 版本: $PYTHON_VERSION"

if [[ "$PYTHON_VERSION" != "3.10" ]]; then
    echo "⚠️  警告: 推荐使用 Python 3.10，当前版本: $PYTHON_VERSION"
    read -p "是否继续安装? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "安装已取消"
        exit 1
    fi
fi

# 检查 pip
if ! command -v pip3 &> /dev/null; then
    echo "❌ 错误: 未找到 pip3，请先安装 pip"
    exit 1
fi

echo "✅ pip3 已安装"

# 检查并设置pip国内源
echo "🔍 检查pip源配置..."
CURRENT_INDEX_URL=$(pip3 config get global.index-url 2>/dev/null || echo "default")
if [[ "$CURRENT_INDEX_URL" == "default" || "$CURRENT_INDEX_URL" == "" ]]; then
    echo "📦 设置pip国内源（清华大学镜像）..."
    pip3 config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
    echo "✅ pip国内源设置完成"
else
    echo "✅ pip源已配置: $CURRENT_INDEX_URL"
fi

# 升级 pip
echo "📦 升级 pip..."
pip3 install --upgrade pip

# 安装依赖包
echo "📦 安装依赖包..."
if [ -f "requirements_cp310-2.3.2.txt" ]; then
    echo "⚠️  注意: 安装过程中可能出现依赖冲突警告，这是正常现象"
    pip3 install -r requirements_cp310-2.3.2.txt --force-reinstall
    echo "✅ 依赖包安装完成"
else
    echo "❌ 错误: 未找到 requirements_cp310-2.3.2.txt 文件"
    exit 1
fi

# 安装 RKNN Toolkit2
echo "📦 安装 RKNN Toolkit2..."
if [ -f "rknn_toolkit2-2.3.2-cp310-cp310-manylinux_2_17_x86_64.manylinux2014_x86_64.whl" ]; then
    pip3 install rknn_toolkit2-2.3.2-cp310-cp310-manylinux_2_17_x86_64.manylinux2014_x86_64.whl
    echo "✅ RKNN Toolkit2 安装完成"
    
    # 处理可能的torchvision版本冲突
    echo "🔧 检查并修复依赖冲突..."
    if pip3 show torchvision &>/dev/null; then
        TORCH_VERSION=$(python3 -c "import torch; print(torch.__version__)" 2>/dev/null || echo "unknown")
        if [[ "$TORCH_VERSION" == "2.4.0" ]]; then
            echo "⚠️  检测到torchvision版本冲突，正在修复..."
            pip3 uninstall torchvision -y
            pip3 install torchvision==0.19.0
            echo "✅ torchvision版本冲突已修复"
        fi
    fi
else
    echo "❌ 错误: 未找到 RKNN Toolkit2 安装包"
    exit 1
fi

# 验证安装
echo "🔍 验证安装..."
if python3 -c "import rknn; print('✅ RKNN Toolkit2 安装成功!')" 2>/dev/null; then
    echo ""
    echo "🎉 安装完成！"
    echo "📝 您现在可以使用 RKNN Toolkit2 进行模型转换和推理了"
    echo ""
    echo "💡 使用示例:"
    echo "   python3 -c \"import rknn; print('RKNN Toolkit2 已就绪')\""
else
    echo "❌ 安装验证失败，请检查错误信息"
    exit 1
fi
