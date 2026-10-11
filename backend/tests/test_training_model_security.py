"""训练入口到加载器的边界回归：真实授权/数据库，模拟队列与 YOLO。"""
import contextlib
import hashlib
import importlib
import io
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
import yaml

import test_bulk_task_security as fixtures
from app.models import Annotation, AnnotationType, Category, Image, TrainingTask
from app.trusted_models import MODEL_SHA256, allowed_base_models, validate_base_model
from app.services import training_service
from app.tasks import training_runner

# bulk fixture 的导入隔离可能让包属性持有旧模块；显式获取并测试实际模块。
worker = importlib.import_module("app.tasks.training")


class TrainingModelSecurityTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.BulkTaskSecurityTests()
        self.fixture.setUp()
        self.db = self.fixture.db
        self.root = self.fixture.root / "models"
        self.root.mkdir()
        self.category = Category(project_id=self.fixture.project.id, name="example", color="#000000")
        self.db.add(self.category)
        self.db.flush()
        for i in range(10):
            image = Image(project_id=self.fixture.project.id, filename=f"fixture{i}.png", filepath=f"images/{self.fixture.project.id}/fixture{i}.png")
            self.db.add(image)
            self.db.flush()
            self.db.add(Annotation(image_id=image.id, category_id=self.category.id, annotator_id=self.fixture.owner.id, bbox_data='{}'))
        self.db.commit()
        # 使用无反序列化内容的测试权重，清单覆盖仅在本测试上下文内有效。
        self.weight = b"trusted fixture bytes, never deserialized"
        digest = hashlib.sha256(self.weight).hexdigest()
        self.stack = contextlib.ExitStack()
        self.stack.enter_context(patch.dict(MODEL_SHA256, {name: digest for name in MODEL_SHA256}))
        self.stack.enter_context(patch.dict(os.environ, {"MODEL_DIR": str(self.root)}))
        self.stack.enter_context(patch.object(worker, "MODEL_DIR", str(self.root)))
        self.stack.enter_context(patch.object(worker, "TRAINING_OUTPUT_DIR", str(self.fixture.root / "training_output")))
        # route 从 fixture 持有的实际函数 globals 获取，避免对错误缓存模块打补丁。
        route = next(route for route in self.fixture.app.routes if route.path == "/api/training" and "POST" in route.methods)
        self.route_globals = route.endpoint.__globals__
        self.stack.enter_context(patch.dict(
            self.route_globals["validate_base_model"].__globals__["MODEL_SHA256"],
            {name: digest for name in MODEL_SHA256},
        ))
        self.queue = Mock()
        self.queue.delay.return_value = types.SimpleNamespace(id=None)
        self.stack.enter_context(patch.dict(self.route_globals, {"MODEL_DIR": str(self.root), "train_model_task": self.queue}))
        self.yolo = Mock(return_value=Mock())
        fake = types.ModuleType("ultralytics")
        fake.YOLO = self.yolo
        self.stack.enter_context(patch.dict(sys.modules, {"ultralytics": fake}))
        self.stack.enter_context(patch("app.task_heartbeat.mark_alive"))

    def tearDown(self):
        self.stack.close()
        self.fixture.tearDown()

    def write_weight(self, name="yolo11n.pt"):
        path = self.root / name
        path.write_bytes(self.weight)
        return path

    def submit(self, value=None, omitted=False):
        data = {"project_id": self.fixture.project.id, "epochs": 1, "convert_to_rknn": False}
        if not omitted:
            data["base_model"] = value
        return self.fixture.client.post("/api/training", json=data)

    def run_stub_loader(self, name, annotation_type="detection"):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return training_runner.run_training("stub", "stub-data", "stub-output", name, 1, 640, 1, 0, "cpu", annotation_type)

    def test_api_rejects_url_paths_unknown_and_mismatched_models_before_queue(self):
        self.write_weight()
        bad = ("https://example.invalid/model.pt", "/app/models/yolo11n.pt", "../yolo11n.pt", "uploads/2/private.pt", "yolo11x.pt", "yolo11n-seg.pt", "", "YOLO11N.PT")
        for value in bad:
            with self.subTest(value=value):
                self.assertEqual(self.submit(value).status_code, 400)
        self.queue.delay.assert_not_called()
        self.assertEqual(self.db.query(TrainingTask).count(), 1)

    def test_api_missing_or_tampered_local_model_fails_closed(self):
        self.assertEqual(self.submit("yolo11n.pt").status_code, 400)
        self.write_weight().write_bytes(b"different untrusted bytes")
        self.assertEqual(self.submit("yolo11n.pt").status_code, 400)
        self.queue.delay.assert_not_called()

    def test_valid_default_and_explicit_model_reach_queue_and_loader(self):
        for name in ("yolo11n.pt", "yolo11s.pt"):
            self.write_weight(name)
        response = self.submit(omitted=True)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.queue.delay.call_args.kwargs["base_model"], "yolo11n.pt")
        response = self.submit("yolo11s.pt")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.queue.delay.call_args.kwargs["base_model"], "yolo11s.pt")
        self.assertEqual(self.run_stub_loader("yolo11s.pt"), 0)
        self.yolo.assert_called_once_with(str((self.root / "yolo11s.pt").resolve()))

    def test_segmentation_defaults_and_available_list_match_trusted_manifest(self):
        self.fixture.project.annotation_type = AnnotationType.SEGMENTATION
        self.db.commit()
        self.write_weight("yolo11n-seg.pt")
        response = self.submit(omitted=True)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.queue.delay.call_args.kwargs["base_model"], "yolo11n-seg.pt")
        self.assertEqual(self.run_stub_loader("yolo11n-seg.pt", "segmentation"), 0)
        for kind in ("detection", "segmentation"):
            values = [item["value"] for item in training_service.get_available_base_models(kind)]
            self.assertEqual(values, list(allowed_base_models(kind)))
            self.assertTrue(all(value in MODEL_SHA256 and "11x" not in value for value in values))

    def test_runner_rejects_all_unsafe_sources_before_yolo(self):
        self.write_weight()
        for value, kind in (("https://example.invalid/model.pt", "detection"), ("../yolo11n.pt", "detection"), (str(self.root / "yolo11n.pt"), "detection"), ("yolo11n.pt", "segmentation"), ("yolo11n.pt", "keypoint"), ("yolo11s.pt", "detection")):
            with self.subTest(value=value, kind=kind):
                self.assertEqual(self.run_stub_loader(value, kind), 1)
        self.write_weight().write_bytes(b"tampered")
        self.assertEqual(self.run_stub_loader("yolo11n.pt"), 1)
        self.yolo.assert_not_called()

    def test_symlink_escape_rejected_by_api_and_runner_even_with_trusted_bytes(self):
        outside = self.fixture.root / "outside.pt"
        outside.write_bytes(self.weight)
        (self.root / "yolo11n.pt").symlink_to(outside)
        self.assertEqual(self.submit("yolo11n.pt").status_code, 400)
        self.assertEqual(self.run_stub_loader("yolo11n.pt"), 1)
        self.queue.delay.assert_not_called()
        self.yolo.assert_not_called()

    def run_worker(self, name, project_id=None):
        actor = types.SimpleNamespace(db=self.db, update_state=Mock())
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return worker.train_model_task.run.__func__(actor, self.fixture.train_task.task_id, project_id or self.fixture.project.id, name, epochs=1)

    def test_worker_uses_db_project_type_before_dataset_or_subprocess(self):
        self.write_weight()
        self.fixture.project.annotation_type = AnnotationType.SEGMENTATION
        self.db.commit()
        with patch.object(worker, "prepare_dataset") as dataset, patch.object(worker.subprocess, "run") as process:
            for value in ("yolo11n.pt", "https://example.invalid/model.pt"):
                with self.assertRaises(ValueError):
                    self.run_worker(value)
            with self.assertRaises(ValueError):
                self.run_worker("yolo11n-seg.pt", self.fixture.other_project.id)
        dataset.assert_not_called()
        process.assert_not_called()

    def test_worker_passes_verified_real_project_type_to_runner(self):
        self.write_weight()
        with patch.object(worker, "prepare_dataset", return_value=("fixture-data", 8, 2)), patch.object(worker, "mark_alive"), patch.object(worker, "create_training_archive", return_value="fixture.zip"), patch.object(worker.subprocess, "run", return_value=types.SimpleNamespace(returncode=0, stdout="", stderr="")) as process:
            self.run_worker("yolo11n.pt")
        arguments = process.call_args.args[0]
        self.assertEqual(arguments[arguments.index("--annotation-type") + 1], "detection")
        self.assertEqual(arguments[arguments.index("--base-model") + 1], "yolo11n.pt")

    def test_completed_redelivery_skips_missing_base_without_downgrade(self):
        output = self.root / "trained_1_1_best.pt"
        output.write_bytes(b"previous trusted output fixture")
        self.fixture.train_task.output_model_path = output.name
        self.fixture.train_task.status = "completed"
        self.db.commit()
        with patch.object(worker, "prepare_dataset") as dataset, patch.object(worker.subprocess, "run") as process:
            result = self.run_worker("yolo11n.pt")
        self.assertEqual(self.fixture.train_task.status, "completed")
        self.assertEqual(result["output_model_path"], output.name)
        dataset.assert_not_called()
        process.assert_not_called()

    def test_category_newlines_remain_yaml_name_not_download_or_path(self):
        malicious_name = "example\ndownload: echo NEVER_EXECUTE\npath: /unexpected\n#"
        self.category.name = malicious_name
        self.db.commit()
        output = self.fixture.root / "dataset"
        with patch.object(training_service, "UPLOAD_DIR", str(self.fixture.root / "empty-uploads")):
            filename, _, _ = training_service.prepare_dataset(self.db, self.fixture.project.id, str(output))
        document = yaml.safe_load(Path(filename).read_text())
        self.assertEqual(set(document), {"path", "train", "val", "names"})
        self.assertEqual(document["names"][0], malicious_name)
        self.assertEqual(document["path"], str(output))


class BundledWeightsIntegrityTests(unittest.TestCase):
    def test_eight_bundled_weights_match_pinned_hashes_without_loading(self):
        root = Path(__file__).resolve().parents[2] / "models"
        for kind in ("detection", "segmentation"):
            for name in allowed_base_models(kind):
                with self.subTest(name=name):
                    self.assertEqual(validate_base_model(name, kind, str(root)), root / name)


if __name__ == "__main__":
    unittest.main()
