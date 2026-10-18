"""下载器必须先验证官方固定哈希，失败时保留原文件。"""
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('download_yolo26', Path(__file__).resolve().parents[2] / 'scripts/download_yolo26_models.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Yolo26DownloadTests(unittest.TestCase):
    def test_verified_download_skip_and_failed_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            name = 'yolo26n.pt'
            content = b'fixture never deserialized'
            with patch.dict(module.MODEL_SHA256, {name: hashlib.sha256(content).hexdigest()}):
                with patch.object(module.urllib.request, 'urlopen', return_value=io.BytesIO(content)) as fetch:
                    module.download(name, root)
                    self.assertEqual((root / name).read_bytes(), content)
                    module.download(name, root)
                    self.assertEqual(fetch.call_count, 1)
                (root / name).write_bytes(b'original')
                with patch.object(module.urllib.request, 'urlopen', return_value=io.BytesIO(b'incomplete')):
                    with self.assertRaisesRegex(ValueError, 'SHA256'):
                        module.download(name, root)
                self.assertEqual((root / name).read_bytes(), b'original')
                self.assertEqual(list(root.glob('*.part')), [])

    def test_paths_urls_and_other_tasks_never_download(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(module.urllib.request, 'urlopen') as fetch:
            for name in ('../yolo26n.pt', 'https://example.invalid/model.pt', 'yolo26n-cls.pt'):
                with self.assertRaises(ValueError):
                    module.download(name, Path(directory))
            fetch.assert_not_called()
