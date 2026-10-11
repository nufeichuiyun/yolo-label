"""模型上传边界回归；使用临时 SQLite/目录与模拟解析器，不加载 PT。"""
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("YOLO_LABEL_ENV", "test")
os.environ.setdefault("SECRET_KEY", "test-only-model-security-key-32-characters")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.database import Base, get_db
from app.models import AnnotationType, Model, Project, User, UserRole
from app.routers import models


class ModelSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.admin = User(username="admin", email="admin@example.test", hashed_password="unused", role=UserRole.SUPER_ADMIN)
        self.other = User(username="other", email="other@example.test", hashed_password="unused", role=UserRole.PROJECT_ADMIN)
        self.db.add_all([self.admin, self.other])
        self.db.flush()
        self.projects = [Project(name=f"Project {i}", annotation_type=AnnotationType.DETECTION, creator_id=self.admin.id) for i in range(2)]
        self.db.add_all(self.projects)
        self.db.commit()
        self.current_user = self.admin
        self.app = FastAPI()
        self.app.include_router(models.router)
        self.app.dependency_overrides[get_db] = lambda: self.db
        self.app.dependency_overrides[get_current_user] = lambda: self.current_user
        self.client = TestClient(self.app)
        self.model_dir = patch.object(models, "MODEL_DIR", str(self.root))
        self.model_dir.start()
        self.parser = types.ModuleType("app.tasks.models")
        self.parser.extract_model_classes_sync = Mock(return_value=["example"])
        self.parser.extract_model_classes_task = Mock()
        self.parser.extract_model_classes_task.apply.return_value.get.return_value = ["example"]
        self.parser_patch = patch.dict(sys.modules, {"app.tasks.models": self.parser})
        self.parser_patch.start()

    def tearDown(self):
        self.parser_patch.stop()
        self.model_dir.stop()
        self.client.close()
        self.db.close()
        self.engine.dispose()
        self.temp.cleanup()

    def upload(self, project, content=b"not-a-real-checkpoint", name="model"):
        return self.client.post(f"/api/models/project/{project.id}/upload", data={"name": name}, files={"file": ("yolo11n.pt", content, "application/octet-stream")})

    def test_non_super_admin_rejected_before_directory_or_model_load(self):
        for role in (UserRole.PROJECT_ADMIN, UserRole.ANNOTATOR):
            with self.subTest(role=role):
                self.other.role = role
                self.current_user = self.other
                with patch.object(models, "ensure_model_dir") as create_directory:
                    response = self.upload(self.projects[0])
                self.assertEqual(response.status_code, 403)
                create_directory.assert_not_called()
                self.parser.extract_model_classes_sync.assert_not_called()
                self.assertEqual(list(self.root.iterdir()), [])

    def test_same_client_filename_has_isolated_unique_paths(self):
        baseline = self.root / "yolo11n.pt"
        baseline.write_bytes(b"trusted baseline")
        first = self.upload(self.projects[0], b"project one").json()
        second = self.upload(self.projects[1], b"project two").json()
        third = self.upload(self.projects[0], b"another upload", name="other name").json()
        paths = [item["filename"] for item in (first, second, third)]
        self.assertEqual(len(set(paths)), 3)
        self.assertTrue(paths[0].startswith(f"uploads/{self.projects[0].id}/"))
        self.assertTrue(paths[1].startswith(f"uploads/{self.projects[1].id}/"))
        self.assertEqual((self.root / paths[0]).read_bytes(), b"project one")
        self.assertEqual((self.root / paths[1]).read_bytes(), b"project two")
        self.assertEqual(first["filepath"], f"models/{paths[0]}")
        self.assertEqual(baseline.read_bytes(), b"trusted baseline")

    def test_uuid_collision_never_overwrites_or_removes_existing_file(self):
        filename = self.root / "uploads" / str(self.projects[0].id) / "fixed.pt"
        filename.parent.mkdir(parents=True)
        filename.write_bytes(b"existing")
        with patch.object(models, "uuid4", return_value=types.SimpleNamespace(hex="fixed")):
            response = self.upload(self.projects[0])
        self.assertEqual(response.status_code, 500)
        self.assertEqual(filename.read_bytes(), b"existing")
        self.parser.extract_model_classes_sync.assert_not_called()
        self.assertEqual(self.db.query(Model).count(), 0)

    def test_database_failure_cleans_only_new_upload(self):
        baseline = self.root / "yolo11n.pt"
        baseline.write_bytes(b"baseline")
        with patch.object(self.db, "commit", side_effect=RuntimeError("database unavailable")):
            response = self.upload(self.projects[0])
        self.assertEqual(response.status_code, 500)
        self.assertEqual(list(self.root.rglob("*.pt")), [baseline])
        self.assertEqual(baseline.read_bytes(), b"baseline")
        self.assertEqual(self.db.query(Model).count(), 0)

    def test_refresh_failure_preserves_already_committed_upload(self):
        with patch.object(self.db, "refresh", side_effect=RuntimeError("readback unavailable")):
            response = self.upload(self.projects[0])
        self.assertEqual(response.status_code, 500)
        row = self.db.query(Model).one()
        self.assertTrue((self.root / row.filename).is_file())

    def add_legacy_model(self):
        path = self.root / "legacy.pt"
        path.write_bytes(b"legacy trusted model")
        row = Model(project_id=self.projects[0].id, name="legacy", filename="legacy.pt", filepath="models/legacy.pt", file_size=path.stat().st_size, created_by=self.admin.id)
        self.db.add(row)
        self.db.commit()
        return row, path

    def test_legacy_root_filename_remains_readable_and_deletable(self):
        row, path = self.add_legacy_model()
        response = self.client.get(f"/api/models/{row.id}/classes")
        self.assertEqual(response.status_code, 200)
        self.parser.extract_model_classes_task.apply.assert_called_once_with(args=[str(path)])
        self.assertEqual(self.client.get(f"/api/models/{row.id}").json()["filepath"], "models/legacy.pt")
        self.assertEqual(self.client.delete(f"/api/models/{row.id}").status_code, 200)
        self.assertFalse(path.exists())

    def test_cross_project_details_and_classes_require_membership(self):
        row, _ = self.add_legacy_model()
        self.current_user = self.other
        for suffix in ("", "/classes"):
            self.assertEqual(self.client.get(f"/api/models/{row.id}{suffix}").status_code, 403)
        self.parser.extract_model_classes_sync.assert_not_called()
        self.parser.extract_model_classes_task.apply.assert_not_called()

    def test_missing_project_retains_not_found_status(self):
        response = self.upload(types.SimpleNamespace(id=99999))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(list(self.root.iterdir()), [])
        self.parser.extract_model_classes_sync.assert_not_called()


if __name__ == "__main__":
    unittest.main()
