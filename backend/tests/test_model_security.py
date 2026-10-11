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
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import get_current_user
from app.database import Base, get_db
from app.models import AnnotationType, Model, Project, ProjectUser, User, UserRole
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
        self.assertEqual(response.json()["classes"], [])
        self.parser.extract_model_classes_task.apply.assert_not_called()
        self.parser.extract_model_classes_sync.assert_not_called()
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

    def read_classes_without_side_effects(self, row, query=""):
        statements = []
        def capture_sql(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement.strip().split()[0].upper())
        fake_ultralytics = types.ModuleType("ultralytics")
        fake_ultralytics.YOLO = Mock(side_effect=AssertionError("GET cannot load a model"))
        original_cache = row.class_names
        event.listen(self.engine, "before_cursor_execute", capture_sql)
        try:
            with patch.dict(sys.modules, {"ultralytics": fake_ultralytics}), patch.object(self.db, "commit") as commit:
                response = self.client.get(f"/api/models/{row.id}/classes{query}")
                commit.assert_not_called()
        finally:
            event.remove(self.engine, "before_cursor_execute", capture_sql)
        fake_ultralytics.YOLO.assert_not_called()
        self.parser.extract_model_classes_sync.assert_not_called()
        self.parser.extract_model_classes_task.apply.assert_not_called()
        self.assertTrue(all(statement == "SELECT" for statement in statements), statements)
        self.assertEqual(row.class_names, original_cache)
        self.assertFalse(self.db.dirty)
        return response

    def make_member(self):
        self.other.role = UserRole.ANNOTATOR
        self.db.add(ProjectUser(project_id=self.projects[0].id, user_id=self.other.id, role=UserRole.ANNOTATOR))
        self.db.commit()
        self.current_user = self.other

    def test_member_reads_persisted_classes_without_loading_model(self):
        row, path = self.add_legacy_model()
        row.class_names = '["猫", "dog"]'
        self.db.commit()
        self.make_member()
        # 即使权重已不存在，元数据读取仍应正常工作。
        path.unlink()
        for query in ("", "?force_reparse=false"):
            response = self.read_classes_without_side_effects(row, query)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"classes": ["猫", "dog"]})

    def test_missing_or_malformed_metadata_never_falls_back_to_loading(self):
        row, _ = self.add_legacy_model()
        self.make_member()
        for value in (None, "", "not-json", "null", "{}", '"cat"', "[]", '["cat", 3]', '["cat", null]', '[""]', '["   "]'):
            with self.subTest(metadata=value):
                row.class_names = value
                self.db.commit()
                response = self.read_classes_without_side_effects(row)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["classes"], [])
                self.assertIn("重新上传", response.json()["message"])

    def test_force_reparse_rejected_even_for_super_admin(self):
        row, _ = self.add_legacy_model()
        self.make_member()
        for user in (self.other, self.admin):
            self.current_user = user
            for value in (None, '["cat"]'):
                row.class_names = value
                self.db.commit()
                response = self.read_classes_without_side_effects(row, "?force_reparse=true")
                self.assertEqual(response.status_code, 400)
                self.assertIn("重新上传", response.json()["detail"])
        response = self.read_classes_without_side_effects(row, "?force_reparse=invalid")
        self.assertEqual(response.status_code, 422)

    def test_cross_project_force_reparse_cannot_bypass_membership(self):
        row, _ = self.add_legacy_model()
        self.current_user = self.other
        for query in ("", "?force_reparse=false", "?force_reparse=true"):
            response = self.read_classes_without_side_effects(row, query)
            self.assertEqual(response.status_code, 403)

    def test_missing_project_retains_not_found_status(self):
        response = self.upload(types.SimpleNamespace(id=99999))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(list(self.root.iterdir()), [])
        self.parser.extract_model_classes_sync.assert_not_called()


if __name__ == "__main__":
    unittest.main()
