"""训练完整包解压后能在新目录读取数据集，且不修改原始训练配置。"""
import sys
import tempfile
import unittest
import zipfile
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services import training_archive_service as archive


class TrainingArchiveTests(unittest.TestCase):
    def test_dataset_paths_survive_relocation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            dataset = root / "original"
            for split in ("train", "val"):
                image = dataset / "images" / split / "sample.png"
                image.parent.mkdir(parents=True)
                image.write_bytes(b"test-image")
            config = {"path": str(dataset), "train": "images/train", "val": "images/val", "names": {0: "测试色块"}}
            source_yaml = yaml.safe_dump(config, allow_unicode=True)
            (dataset / "data.yaml").write_text(source_yaml, encoding="utf-8")
            runs = root / "runs"
            runs.mkdir()
            (runs / "results.csv").write_text("epoch\n1\n", encoding="utf-8")
            model = root / "best.pt"
            model.write_bytes(b"test-model")
            archives = root / "archives"
            with patch.object(archive, "TRAINING_ARCHIVES_DIR", str(archives)):
                result = archive.create_training_archive("测试", 1, 1, datetime(2026, 10, 13), str(dataset), str(runs), str(model))
            self.assertEqual((dataset / "data.yaml").read_text(encoding="utf-8"), source_yaml)
            relocated = root / "relocated"
            with zipfile.ZipFile(archives / Path(result).name) as zf:
                self.assertIsNone(zf.testzip())
                zf.extractall(relocated)
            exported_yaml = next(relocated.rglob("data.yaml"))
            exported = yaml.safe_load(exported_yaml.read_text(encoding="utf-8"))
            self.assertNotIn("path", exported)
            self.assertEqual(exported["names"], config["names"])
            for split in ("train", "val"):
                self.assertTrue((exported_yaml.parent / exported[split] / "sample.png").is_file())
            self.assertEqual(next(relocated.rglob("best.pt")).read_bytes(), b"test-model")
            self.assertEqual(next(relocated.rglob("results.csv")).read_text(encoding="utf-8"), "epoch\n1\n")


if __name__ == "__main__":
    unittest.main()
