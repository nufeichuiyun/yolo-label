#!/bin/bash

# YOLO11 PT到RKNN一键转换工具 - 依赖安装脚本
# 自动安装所有必要的依赖包

set -e  # 遇到错误立即退出

echo "🚀 YOLO11 PT到RKNN一键转换工具 - 依赖安装"
echo "=" * 60

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

echo ""
echo "📦 步骤1: 安装RKNN Toolkit2..."
echo "=" * 40

# 安装RKNN Toolkit2
cd install_rknn
if [ -f "install_rknn_x64.sh" ]; then
    chmod +x install_rknn_x64.sh
    ./install_rknn_x64.sh
    echo "✅ RKNN Toolkit2 安装完成"
else
    echo "❌ 错误: 未找到 install_rknn_x64.sh 文件"
    exit 1
fi

cd ..

echo ""
echo "📦 步骤2: 安装YOLO11依赖..."
echo "=" * 40

# 安装YOLO11依赖
cd yolo11_pt_to_rk_onnx
if [ -f "requirements.txt" ]; then
    echo "⚠️  注意: 安装YOLO11依赖包..."
    pip3 install -r requirements.txt
    echo "✅ YOLO11依赖包安装完成"
else
    echo "❌ 错误: 未找到 requirements.txt 文件"
    exit 1
fi

cd ..

echo ""
echo "🔍 验证安装..."
echo "=" * 40

# 验证RKNN Toolkit2
if python3 -c "import rknn; print('✅ RKNN Toolkit2 安装成功!')" 2>/dev/null; then
    echo "✅ RKNN Toolkit2 验证通过"
else
    echo "❌ RKNN Toolkit2 验证失败"
    exit 1
fi

# 验证PyTorch
if python3 -c "import torch; print('✅ PyTorch 安装成功!')" 2>/dev/null; then
    echo "✅ PyTorch 验证通过"
else
    echo "❌ PyTorch 验证失败"
    exit 1
fi

# 验证ultralytics
if python3 -c "import ultralytics; print('✅ Ultralytics 安装成功!')" 2>/dev/null; then
    echo "✅ Ultralytics 验证通过"
else
    echo "❌ Ultralytics 验证失败"
    exit 1
fi

echo ""
echo "🎉 所有依赖安装完成！"
echo "=" * 60
echo "📝 您现在可以使用以下命令进行模型转换："
echo ""
echo "💡 使用示例:"
echo "   python3 pt_to_rknn_converter.py <PT模型路径> <图片文件夹路径>"
echo ""
echo "📋 示例命令:"
echo "   python3 pt_to_rknn_converter.py yolo11n.pt ./images/"
echo "   python3 pt_to_rknn_converter.py yolo11n-seg.pt ./calibration_images/"
echo ""
echo "🔧 如需帮助，请运行:"
echo "   python3 pt_to_rknn_converter.py --help"
echo ""
