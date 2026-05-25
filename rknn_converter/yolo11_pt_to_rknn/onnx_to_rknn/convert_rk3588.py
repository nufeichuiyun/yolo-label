#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RK3588专用模型转换程序 (简化版)
固定int8量化，自动设置输出路径，显示详细信息
"""

import os
import sys
import glob
import argparse
from pathlib import Path
from rknn.api import RKNN

def create_dataset_file(image_folder, output_file, image_extensions=['jpg', 'jpeg', 'png', 'bmp']):
    """
    自动生成dataset文件
    
    Args:
        image_folder: 图片文件夹路径
        output_file: 输出的dataset文件路径
        image_extensions: 支持的图片扩展名
    """
    image_folder = Path(image_folder)
    if not image_folder.exists():
        print(f"错误：图片文件夹 {image_folder} 不存在！")
        return False
    
    # 查找所有图片文件
    image_files = []
    for ext in image_extensions:
        pattern = str(image_folder / f"*.{ext}")
        image_files.extend(glob.glob(pattern))
        pattern = str(image_folder / f"*.{ext.upper()}")
        image_files.extend(glob.glob(pattern))
    
    if not image_files:
        print(f"错误：在文件夹 {image_folder} 中未找到任何图片文件！")
        print(f"支持的格式：{', '.join(image_extensions)}")
        return False
    
    # 按文件名排序
    image_files.sort()
    
    # 写入dataset文件
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            for img_path in image_files:
                # 转换为绝对路径
                abs_path = os.path.abspath(img_path)
                f.write(f"{abs_path}\n")
        
        print(f"成功生成dataset文件：{output_file}")
        print(f"包含 {len(image_files)} 张图片")
        return True
        
    except Exception as e:
        print(f"生成dataset文件时出错：{e}")
        return False

def convert_model(onnx_path, image_folder):
    """
    转换ONNX模型到RKNN格式 (固定int8量化)
    
    Args:
        onnx_path: ONNX模型路径
        image_folder: 图片文件夹路径
    """
    
    # 检查输入文件
    if not os.path.exists(onnx_path):
        print(f"错误：ONNX模型文件 {onnx_path} 不存在！")
        return False
    
    # 自动设置输出路径：与输入模型同目录，扩展名改为.rknn
    onnx_dir = os.path.dirname(onnx_path)
    onnx_name = os.path.splitext(os.path.basename(onnx_path))[0]
    output_path = os.path.join(onnx_dir, f"{onnx_name}.rknn")
    
    print(f"输出路径：{output_path}")
    
    # 创建临时dataset文件
    temp_dataset = "temp_dataset.txt"
    if not create_dataset_file(image_folder, temp_dataset):
        return False
    
    try:
        # 创建RKNN对象 (默认不显示详细信息)
        rknn = RKNN(verbose=False)
        
        # 配置模型
        print('--> 配置模型')
        rknn.config(
            mean_values=[[0, 0, 0]], 
            std_values=[[255, 255, 255]], 
            target_platform='rk3588'
        )
        print('配置完成')
        
        # 加载ONNX模型
        print('--> 加载ONNX模型')
        ret = rknn.load_onnx(model=onnx_path)
        if ret != 0:
            print('加载模型失败！')
            return False
        print('模型加载完成')
        
        # 构建模型 (固定int8量化)
        print('--> 构建RKNN模型 (int8量化)')
        ret = rknn.build(do_quantization=True, dataset=temp_dataset)
        if ret != 0:
            print('构建模型失败！')
            return False
        print('模型构建完成')
        
        # 导出RKNN模型
        print('--> 导出RKNN模型')
        ret = rknn.export_rknn(output_path)
        if ret != 0:
            print('导出模型失败！')
            return False
        print(f'模型导出完成：{output_path}')
        
        # 释放资源
        rknn.release()
        
        return True
        
    except Exception as e:
        print(f"转换过程中出错：{e}")
        return False
    finally:
        # 清理临时文件
        if os.path.exists(temp_dataset):
            os.remove(temp_dataset)
            print("临时dataset文件已清理")

def main():
    parser = argparse.ArgumentParser(
        description='RK3588专用模型转换程序 (简化版)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用示例：
  python3 convert_rk3588.py model.onnx ./images/
  
说明：
  - 固定使用int8量化
  - 输出文件自动保存到输入模型同目录
  - 默认不显示详细信息
        """
    )
    
    parser.add_argument('onnx_path', help='ONNX模型文件路径')
    parser.add_argument('image_folder', help='包含量化校准图片的文件夹路径')
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("RK3588专用模型转换程序 (简化版)")
    print("=" * 60)
    print(f"ONNX模型: {args.onnx_path}")
    print(f"图片文件夹: {args.image_folder}")
    print(f"量化类型: int8 (固定)")
    print(f"详细信息: 否 (默认)")
    print("=" * 60)
    
    # 执行转换
    success = convert_model(
        onnx_path=args.onnx_path,
        image_folder=args.image_folder
    )
    
    if success:
        print("\n✅ 模型转换成功！")
        # 重新计算输出路径用于显示
        onnx_dir = os.path.dirname(args.onnx_path)
        onnx_name = os.path.splitext(os.path.basename(args.onnx_path))[0]
        output_path = os.path.join(onnx_dir, f"{onnx_name}.rknn")
        print(f"输出文件：{output_path}")
    else:
        print("\n❌ 模型转换失败！")
        sys.exit(1)

if __name__ == '__main__':
    main()
