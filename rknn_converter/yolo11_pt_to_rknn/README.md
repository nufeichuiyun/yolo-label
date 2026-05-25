# YOLO11 PT模型一键转换为RKNN格式

## 📋 项目简介

本项目提供一键将YOLO11的PyTorch模型转换为RK3588平台可用的RKNN格式模型的完整解决方案。

### ✨ 主要特性

- 🚀 **一键转换**: 自动完成PT → ONNX → RKNN的完整转换流程
- 📦 **依赖管理**: 提供自动化依赖安装脚本
- 🎯 **参数化输入**: 支持命令行参数指定PT文件和图片文件夹
- ✅ **错误处理**: 完整的错误检查和状态反馈
- 🧹 **自动清理**: 转换完成后自动清理临时文件

## 🏗️ 项目结构

```
yolo11_pt_to_rknn/
├── install_rknn/                    # RKNN Toolkit2安装包和脚本
│   ├── install_rknn_x64.sh          # RKNN安装脚本
│   ├── rknn_toolkit2-2.3.2-*.whl    # RKNN Toolkit2安装包
│   ├── requirements_cp310-2.3.2.txt # RKNN依赖包列表
│   └── README.md                    # RKNN安装说明
├── yolo11_pt_to_rk_onnx/            # YOLO11 PT转ONNX工具
│   ├── simple_convert.py            # PT转ONNX脚本
│   ├── ultralytics/                 # YOLO11源码
│   └── requirements.txt             # YOLO11依赖包
├── onnx_to_rknn/                    # ONNX转RKNN工具
│   ├── convert_rk3588.py            # ONNX转RKNN脚本
│   └── README.md                    # 使用说明
├── pt_to_rknn_converter.py          # 一键转换主脚本
├── install_all_dependencies.sh      # 依赖安装脚本
└── README.md                        # 本文件
```

## 🚀 快速开始

### 转换模型

```bash
# 基本用法
python3 pt_to_rknn_converter.py <PT模型路径> <图片文件夹路径>

# 示例
python3 pt_to_rknn_converter.py yolo11n.pt ./images/
python3 pt_to_rknn_converter.py yolo11n-seg.pt ./calibration_images/
```

## 📖 使用说明

### 环境要求

- **操作系统**: Linux (推荐 Ubuntu 22.04)
- **架构**: x86_64
- **Python**: 3.10.x (推荐)
- **内存**: 建议 4GB 以上

### 支持的模型类型

支持所有YOLO11模型类型：检测、分割、姿态、OBB等。

### 命令行参数

```bash
python3 pt_to_rknn_converter.py [选项] <PT模型路径> <图片文件夹路径>

参数:
  PT模型路径         PT模型文件路径 (必需)
  图片文件夹路径      包含量化校准图片的文件夹路径 (必需)

选项:
  -h, --help         显示帮助信息
  -o, --output-dir   输出目录 (默认: PT文件同目录)
  --skip-deps-check  跳过依赖检查
  --no-auto-install  禁用自动安装依赖
```

### 自动依赖安装

脚本会自动检测并安装缺失的依赖包，无需手动安装：
- **RKNN Toolkit2**: 自动安装RKNN Toolkit2和相关依赖
- **PyTorch**: 自动安装PyTorch和torchvision
- **YOLO11**: 自动安装ultralytics和相关依赖

### 图片要求

- **数量**: 推荐50-200张图片，最少20张
- **格式**: JPG/JPEG, PNG, BMP
- **质量**: 图片清晰，覆盖模型实际应用的各种场景

## 🔄 转换流程

1. **依赖检查**: 自动检测并安装缺失的依赖包
2. **PT转ONNX**: 使用YOLO11工具将PT模型转换为ONNX格式
3. **ONNX转RKNN**: 使用RKNN Toolkit2将ONNX模型转换为RKNN格式
4. **文件输出**: 将最终RKNN模型保存到指定目录
5. **清理资源**: 自动删除临时文件

## 📊 输出文件

转换完成后，会在输出目录生成以下文件：

- `{模型名}.onnx` - 中间ONNX格式文件
- `{模型名}.rknn` - 最终RKNN格式文件


## 📝 使用示例

```bash
# 基本转换
python3 pt_to_rknn_converter.py yolo11n.pt ./images/

# 转换分割模型
python3 pt_to_rknn_converter.py yolo11n-seg.pt ./calibration_images/

# 指定输出目录
python3 pt_to_rknn_converter.py -o ./output/ yolo11n.pt ./images/
```

## 🔗 相关链接

- [YOLO11官方文档](https://github.com/ultralytics/ultralytics)
- [RKNN Model Zoo](https://github.com/airockchip/rknn_model_zoo)
