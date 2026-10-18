"""下载固定发行版 YOLO26 权重，校验通过才安装；仅使用 Python 标准库。"""
import argparse
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.trusted_models import MODEL_SHA256

MODELS = tuple(name for name in MODEL_SHA256 if name.startswith('yolo26'))
BASE_URL = 'https://github.com/ultralytics/assets/releases/download/v8.4.0'


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def download(name, directory):
    if name not in MODELS:
        raise ValueError('仅允许固定清单内的 YOLO26 检测/实例分割权重')
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / name
    if output.is_file() and digest(output) == MODEL_SHA256[name]:
        return '已校验，跳过'
    fd, temporary = tempfile.mkstemp(prefix=name + '.', suffix='.part', dir=directory)
    os.close(fd)
    temporary = Path(temporary)
    try:
        with urllib.request.urlopen(f'{BASE_URL}/{name}', timeout=120) as source, temporary.open('wb') as target:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                target.write(block)
        if digest(temporary) != MODEL_SHA256[name]:
            raise ValueError('SHA256 与固定官方清单不符，未安装该权重')
        temporary.replace(output)
        return '下载并校验完成'
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('models', nargs='*', help='不填则下载全部十个模型，例如 yolo26n.pt yolo26n-seg.pt')
    parser.add_argument('--output-dir', type=Path, default=Path(os.getenv('MODELS_DIR', Path(__file__).resolve().parents[1] / 'models')))
    args = parser.parse_args()
    names = args.models or MODELS
    if any(name not in MODELS for name in names):
        parser.error('模型名必须来自 YOLO26 检测/实例分割固定清单，不接受路径或网址')
    for name in names:
        print(f'{name}: {download(name, args.output_dir)}', flush=True)
