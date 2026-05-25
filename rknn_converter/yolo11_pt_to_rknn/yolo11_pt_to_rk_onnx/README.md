# YOLO11 PT模型转RK3588 ONNX格式使用说明

## 概述

本工程基于YOLO11官方程序修改，专门用于将PyTorch格式的YOLO11模型转换为RK3588平台可用的ONNX格式模型文件。

## 特性

- 🚀 支持检测、分割、姿态、旋转框检测等多种YOLO11模型
- 🔧 自动配置环境变量和配置文件
- 📁 自动备份和恢复配置文件
- ✅ 完整的错误处理和状态反馈
- 🎯 一键完成所有转换操作

## 支持的模型类型

| 模型类型 | 文件名示例 | 说明 |
|---------|-----------|------|
| 检测模型 | `yolo11n.pt`, `yolo11s.pt`, `yolo11m.pt`, `yolo11l.pt`, `yolo11x.pt` | 目标检测任务 |
| 分割模型 | `yolo11n-seg.pt`, `yolo11s-seg.pt`, `yolo11m-seg.pt`, `yolo11l-seg.pt`, `yolo11x-seg.pt` | 实例分割任务 |
| 姿态模型 | `yolo11n-pose.pt`, `yolo11s-pose.pt`, `yolo11m-pose.pt`, `yolo11l-pose.pt`, `yolo11x-pose.pt` | 关键点检测任务 |
| OBB模型 | `yolo11n-obb.pt`, `yolo11s-obb.pt`, `yolo11m-obb.pt`, `yolo11l-obb.pt`, `yolo11x-obb.pt` | 旋转框检测任务 |

## 使用方法

### 快速开始

```bash
# 1. 安装依赖（首次使用）
pip install -r requirements.txt

# 2. 运行转换脚本
python simple_convert.py <模型文件路径>
```

### 详细用法

```bash
# 基本用法
python simple_convert.py <模型文件路径>

# 示例：转换检测模型
python simple_convert.py yolo11n.pt

# 示例：转换分割模型
python simple_convert.py yolo11n-seg.pt

# 示例：转换姿态模型
python simple_convert.py yolo11n-pose.pt

# 示例：转换OBB模型
python simple_convert.py yolo11n-obb.pt
```

## 环境要求

- Python 3.8+
- PyTorch 2.0+
- 在YOLO11工程根目录下运行
- 确保模型文件存在且可访问

## 输出文件

转换成功后，会在原始PT模型文件所在目录生成对应的ONNX文件：

- 输入：`yolo11n.pt`
- 输出：`yolo11n.onnx`

## 注意事项

⚠️ **重要提醒**：

1. **必须在YOLO11工程根目录下运行脚本**
2. **确保模型文件路径正确且文件存在**
3. **转换过程中会自动备份和恢复配置文件**
4. **生成的ONNX模型已针对RK3588平台优化**
5. **首次使用前请确保已安装所有必要的Python依赖包**

## 后续步骤

转换完成后，您可以：

1. **直接使用ONNX模型** - 在支持ONNX的推理框架中使用
2. **转换为RKNN格式** - 使用RKNN Toolkit进一步优化
3. **部署到RK3588平台** - 在实际硬件上运行推理

## 技术支持

如需进一步转换为RKNN格式或获取更多RK3588相关信息，请参考：
- [RKNN Model Zoo](https://github.com/airockchip/rknn_model_zoo)
- [RKNN Toolkit文档](https://www.rock-chips.com/a/cn/downloadcenter/index.html)

