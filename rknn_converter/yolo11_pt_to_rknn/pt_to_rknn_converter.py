#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
YOLO11 PT模型一键转换为RKNN格式
整合了三个转换步骤：PT -> ONNX -> RKNN
"""

import os
import sys
import subprocess
import argparse
import shutil
from pathlib import Path
import tempfile


def check_dependencies(auto_install=True):
    """检查必要的依赖是否已安装"""
    print("🔍 检查依赖环境...")
    
    missing_deps = []
    
    # 检查RKNN Toolkit2
    try:
        import rknn
        print("✅ RKNN Toolkit2 已安装")
    except ImportError:
        print("❌ RKNN Toolkit2 未安装")
        missing_deps.append("rknn")
    
    # 检查PyTorch
    try:
        import torch
        print("✅ PyTorch 已安装")
    except ImportError:
        print("❌ PyTorch 未安装")
        missing_deps.append("torch")
    
    # 检查YOLO11工程目录是否存在
    script_dir = Path(__file__).parent
    yolo_dir = script_dir / "yolo11_pt_to_rk_onnx"
    if yolo_dir.exists() and (yolo_dir / "ultralytics").exists():
        print("✅ YOLO11工程目录已存在")
    else:
        print("❌ YOLO11工程目录不存在")
        missing_deps.append("yolo11")
    
    if missing_deps:
        if auto_install:
            print(f"\n🔧 检测到缺失依赖: {', '.join(missing_deps)}")
            print("🚀 开始自动安装依赖...")
            
            if install_dependencies():
                print("✅ 依赖安装完成，重新检查...")
                return check_dependencies(auto_install=False)  # 递归检查，避免无限循环
            else:
                print("❌ 依赖安装失败")
                return False
        else:
            print("\n💡 请运行以下命令安装依赖:")
            print("   ./install_all_dependencies.sh")
            return False
    
    return True


def install_dependencies():
    """自动安装依赖"""
    script_dir = Path(__file__).parent
    install_script = script_dir / "install_all_dependencies.sh"
    
    if not install_script.exists():
        print(f"❌ 安装脚本不存在: {install_script}")
        return False
    
    try:
        print("📦 运行依赖安装脚本...(预计需要10分钟)")
        result = subprocess.run(
            ["bash", str(install_script)],
            cwd=script_dir,
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0:
            print("✅ 依赖安装成功!")
            print("🔄 重新启动程序以加载新安装的依赖...")
            
            # 重新启动当前程序
            import sys
            os.execv(sys.executable, [sys.executable] + sys.argv)
            
        else:
            print("❌ 依赖安装失败!")
            if result.stderr:
                print("错误信息:")
                print(result.stderr)
            return False
            
    except Exception as e:
        print(f"❌ 安装过程中发生错误: {e}")
        return False


def convert_pt_to_onnx(pt_path, output_dir):
    """
    步骤1: 将PT模型转换为ONNX格式
    
    Args:
        pt_path: PT模型文件路径
        output_dir: 输出目录
    """
    print("\n🚀 步骤1: PT模型转ONNX格式")
    print("=" * 50)
    
    # 检查PT文件
    if not os.path.exists(pt_path):
        print(f"❌ PT模型文件不存在: {pt_path}")
        return None
    
    # 切换到yolo11_pt_to_rk_onnx目录
    yolo_dir = Path(__file__).parent / "yolo11_pt_to_rk_onnx"
    if not yolo_dir.exists():
        print(f"❌ YOLO11转换目录不存在: {yolo_dir}")
        return None
    
    # 创建临时目录用于转换
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_pt = os.path.join(temp_dir, os.path.basename(pt_path))
        shutil.copy2(pt_path, temp_pt)
        
        try:
            # 设置环境变量
            env = os.environ.copy()
            env['PYTHONPATH'] = f"{yolo_dir}:{env.get('PYTHONPATH', '')}"
            
            # 运行转换脚本
            cmd = [sys.executable, "simple_convert.py", temp_pt]
            result = subprocess.run(
                cmd,
                cwd=yolo_dir,
                capture_output=True,
                text=True,
                env=env
            )
            
            if result.returncode == 0:
                # 查找生成的ONNX文件
                pt_name = Path(pt_path).stem
                temp_onnx = os.path.join(temp_dir, f"{pt_name}.onnx")
                
                if os.path.exists(temp_onnx):
                    # 复制到输出目录（含 .onnx.data 等外部数据文件，RKNN 加载需要）
                    output_onnx = os.path.join(output_dir, f"{pt_name}.onnx")
                    shutil.copy2(temp_onnx, output_onnx)
                    for f in Path(temp_dir).glob(f"{pt_name}.onnx*"):
                        if f.name != f"{pt_name}.onnx":
                            shutil.copy2(f, os.path.join(output_dir, f.name))
                    
                    size_mb = os.path.getsize(output_onnx) / (1024*1024)
                    print(f"✅ ONNX转换成功!")
                    print(f"   输出文件: {output_onnx}")
                    print(f"   文件大小: {size_mb:.2f} MB")
                    return output_onnx
                else:
                    print("❌ 未找到生成的ONNX文件")
                    return None
            else:
                print("❌ PT转ONNX失败!")
                if result.stderr:
                    print("错误信息:")
                    print(result.stderr)
                return None
                
        except Exception as e:
            print(f"❌ 转换过程中发生错误: {e}")
            return None


def convert_onnx_to_rknn(onnx_path, images_folder, output_dir):
    """
    步骤2: 将ONNX模型转换为RKNN格式
    
    Args:
        onnx_path: ONNX模型文件路径
        images_folder: 量化校准图片文件夹
        output_dir: 输出目录
    """
    print("\n🚀 步骤2: ONNX模型转RKNN格式(预计需要2分钟)")
    print("=" * 50)
    
    # 检查ONNX文件
    if not os.path.exists(onnx_path):
        print(f"❌ ONNX模型文件不存在: {onnx_path}")
        return None
    
    # 检查图片文件夹
    if not os.path.exists(images_folder):
        print(f"❌ 图片文件夹不存在: {images_folder}")
        return None
    
    # 切换到onnx_to_rknn目录
    rknn_dir = Path(__file__).parent / "onnx_to_rknn"
    if not rknn_dir.exists():
        print(f"❌ RKNN转换目录不存在: {rknn_dir}")
        return None
    
    try:
        # 将图片文件夹路径转换为绝对路径
        abs_images_folder = os.path.abspath(images_folder)
        
        # 运行RKNN转换脚本
        cmd = [sys.executable, "convert_rk3588.py", onnx_path, abs_images_folder]
        result = subprocess.run(
            cmd,
            cwd=rknn_dir,
            capture_output=True,
            text=True
        )
        
        # 查找生成的RKNN文件
        onnx_name = Path(onnx_path).stem
        rknn_path = os.path.join(output_dir, f"{onnx_name}.rknn")
        
        if result.returncode == 0 and os.path.exists(rknn_path):
            size_mb = os.path.getsize(rknn_path) / (1024*1024)
            print(f"✅ RKNN转换成功!")
            print(f"   输出文件: {rknn_path}")
            print(f"   文件大小: {size_mb:.2f} MB")
            return rknn_path
        elif result.returncode == 0:
            print("❌ 未找到生成的RKNN文件")
            print("详细输出信息:")
            if result.stdout:
                print("标准输出:")
                print(result.stdout)
            return None
        else:
            print("❌ ONNX转RKNN失败!")
            print("详细错误信息:")
            if result.stdout:
                print("标准输出:")
                print(result.stdout)
            if result.stderr:
                print("错误输出:")
                print(result.stderr)
            return None
            
    except Exception as e:
        print(f"❌ 转换过程中发生错误: {e}")
        return None


def main():
    """主函数"""
    parser = argparse.ArgumentParser(
        description='YOLO11 PT模型一键转换为RKNN格式',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用示例：
  python3 pt_to_rknn_converter.py model.pt ./images/
  python3 pt_to_rknn_converter.py yolo11n.pt ./calibration_images/
  
说明：
  - 自动完成PT -> ONNX -> RKNN的完整转换流程
  - 使用int8量化优化模型
  - 输出文件保存在输入模型同目录
  - 自动检测并安装缺失的依赖包
        """
    )
    
    parser.add_argument('pt_path', help='PT模型文件路径')
    parser.add_argument('images_folder', help='包含量化校准图片的文件夹路径')
    parser.add_argument('--output-dir', '-o', help='输出目录 (默认: PT文件同目录)')
    parser.add_argument('--skip-deps-check', action='store_true', help='跳过依赖检查')
    parser.add_argument('--no-auto-install', action='store_true', help='禁用自动安装依赖')
    
    args = parser.parse_args()
    
    print("🎯 YOLO11 PT模型一键转换为RKNN格式")
    print("=" * 60)
    print(f"PT模型: {args.pt_path}")
    print(f"图片文件夹: {args.images_folder}")
    
    # 设置输出目录
    if args.output_dir:
        output_dir = args.output_dir
    else:
        output_dir = os.path.dirname(os.path.abspath(args.pt_path))
    
    print(f"输出目录: {output_dir}")
    print("=" * 60)
    
    # 检查依赖
    if not args.skip_deps_check:
        auto_install = not args.no_auto_install
        if not check_dependencies(auto_install=auto_install):
            print("\n💥 依赖检查失败!")
            sys.exit(1)
    
    # 创建输出目录
    os.makedirs(output_dir, exist_ok=True)
    
    # 步骤1: PT -> ONNX
    onnx_path = convert_pt_to_onnx(args.pt_path, output_dir)
    if not onnx_path:
        print("\n💥 PT转ONNX失败!")
        sys.exit(1)
    
    # 步骤2: ONNX -> RKNN
    rknn_path = convert_onnx_to_rknn(onnx_path, args.images_folder, output_dir)
    if not rknn_path:
        print("\n💥 ONNX转RKNN失败!")
        sys.exit(1)
    
    # 转换完成
    print("\n🎉 转换完成!")
    print("=" * 60)
    print(f"✅ 最终输出文件: {rknn_path}")
    
    # 显示文件信息
    pt_size = os.path.getsize(args.pt_path) / (1024*1024)
    onnx_size = os.path.getsize(onnx_path) / (1024*1024)
    rknn_size = os.path.getsize(rknn_path) / (1024*1024)
    
    print(f"📊 文件大小对比:")
    print(f"   PT模型:   {pt_size:.2f} MB")
    print(f"   ONNX模型: {onnx_size:.2f} MB")
    print(f"   RKNN模型: {rknn_size:.2f} MB")
    
    print(f"\n🚀 RKNN模型已准备就绪，可以部署到RK3588平台!")


if __name__ == "__main__":
    main()
