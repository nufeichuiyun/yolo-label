#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
YOLO11 PT模型转RK3588 ONNX格式 - 简化版脚本
一键完成模型转换，无需复杂配置
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path


def convert_yolo11_to_rk3588(model_path: str):
    """
    一键转换YOLO11 PT模型为RK3588可用的ONNX格式
    
    Args:
        model_path: PT模型文件路径
    """
    print("🚀 YOLO11 PT模型转RK3588 ONNX格式转换器")
    print("=" * 50)
    
    # 检查模型文件
    if not os.path.exists(model_path):
        print(f"❌ 模型文件不存在: {model_path}")
        return False
    
    # 检查工作目录
    workspace = Path.cwd()
    if not (workspace / "ultralytics" / "engine" / "exporter.py").exists():
        print("❌ 请在YOLO11工程根目录下运行此脚本")
        return False
    
    try:
        # 1. 备份并更新配置文件
        config_file = workspace / "ultralytics" / "cfg" / "default.yaml"
        backup_file = config_file.with_suffix('.yaml.backup')
        
        print("📝 更新配置文件...")
        
        # 备份原配置
        if not backup_file.exists():
            shutil.copy2(config_file, backup_file)
            print(f"✓ 配置文件已备份到: {backup_file}")
        
        # 读取配置
        with open(config_file, 'r', encoding='utf-8') as f:
            config_content = f.read()
        
        # 更新模型路径
        old_model = "model: yolo11n.pt"
        new_model = f"model: {os.path.abspath(model_path)}"
        
        if old_model in config_content:
            config_content = config_content.replace(old_model, new_model)
            # print(f"✓ 模型路径已更新: yolo11n.pt -> {os.path.basename(model_path)}")
        else:
            print("⚠ 未找到默认模型配置，尝试添加新配置")
            # 在task行后添加模型配置
            config_content = config_content.replace(
                "task: detect",
                f"task: detect\nmodel: {os.path.abspath(model_path)}"
            )
        
        # 保存更新后的配置
        with open(config_file, 'w', encoding='utf-8') as f:
            f.write(config_content)
        
        # 2. 设置PYTHONPATH
        os.environ['PYTHONPATH'] = f"{workspace}:{os.environ.get('PYTHONPATH', '')}"
        print(f"✓ 设置PYTHONPATH: {workspace}")
        
        # 3. 运行导出命令
        print("🚀 开始导出模型...")
        cmd = [sys.executable, "ultralytics/engine/exporter.py"]
        
        result = subprocess.run(
            cmd,
            cwd=workspace,
            capture_output=True,
            text=True,
            env=os.environ.copy()
        )
        
        # 4. 恢复配置文件
        if backup_file.exists():
            shutil.copy2(backup_file, config_file)
            print("✓ 配置文件已恢复")
        
        if result.returncode == 0:
            print("✓ 模型导出成功!")
            
            # 查找生成的ONNX文件
            model_name = Path(model_path).stem
            onnx_file = Path(model_path).parent / f"{model_name}.onnx"
            
            if onnx_file.exists():
                size_mb = onnx_file.stat().st_size / (1024*1024)
                print(f"✓ 生成的ONNX文件: {onnx_file}")
                print(f"  文件大小: {size_mb:.2f} MB")
                print(f"  可以直接用于RK3588平台")
            else:
                print("⚠ 未找到生成的ONNX文件")
            
            return True
        else:
            print("❌ 模型导出失败!")
            if result.stderr:
                print("错误信息:")
                print(result.stderr)
            return False
            
    except Exception as e:
        print(f"❌ 转换过程中发生错误: {e}")
        # 确保配置文件被恢复
        try:
            if 'backup_file' in locals() and backup_file.exists():
                shutil.copy2(backup_file, config_file)
                print("✓ 配置文件已恢复")
        except:
            pass
        return False


def main():
    """主函数"""
    if len(sys.argv) != 2:
        print("使用方法: python simple_convert.py <模型文件路径>")
        print("示例:")
        print("  python simple_convert.py yolo11n.pt")
        print("  python simple_convert.py yolo11n-seg.pt")
        print("  python simple_convert.py yolo11n-pose.pt")
        print("  python simple_convert.py yolo11n-obb.pt")
        sys.exit(1)
    
    model_path = sys.argv[1]
    
    success = convert_yolo11_to_rk3588(model_path)
    
    if success:
        print("\n🎉 转换完成!")
        print("如需进一步转换为RKNN格式，请参考: https://github.com/airockchip/rknn_model_zoo")
    else:
        print("\n💥 转换失败!")
        sys.exit(1)


if __name__ == "__main__":
    main()
