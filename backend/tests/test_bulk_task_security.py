"""整项目任务权限回归：临时 SQLite、假归档与模拟队列，无 Torch/Redis。"""
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("YOLO_LABEL_ENV", "test")
os.environ.setdefault("SECRET_KEY", "test-only-bulk-security-key-32-characters")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.auth import get_current_user
from app.database import Base, get_db
from app.models import AnnotationType, Image, Model, PreAnnotationTask, Project, ProjectUser, Task, TrainingTask, User, UserRole

# 仅隔离重型任务模块，导入真实路由、真实授权与真实 SQL 查询。
_pre_task_module = types.ModuleType("app.tasks.preannotation")
_pre_task_module.preannotate_project_task = Mock()
_train_task_module = types.ModuleType("app.tasks.training")
_train_task_module.train_model_task = Mock()
_train_task_module.TRAINING_METRICS_KEY_PREFIX = "test:metrics:"
with patch.dict(sys.modules, {"app.tasks.preannotation": _pre_task_module, "app.tasks.training": _train_task_module}):
    from app.routers import preannotation, training


class BulkTaskSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.owner = User(username="owner", email="owner@example.test", hashed_password="unused", role=UserRole.PROJECT_ADMIN)
        self.worker = User(username="worker", email="worker@example.test", hashed_password="unused", role=UserRole.ANNOTATOR)
        self.outsider = User(username="outsider", email="outsider@example.test", hashed_password="unused", role=UserRole.PROJECT_ADMIN)
        self.admin = User(username="admin", email="admin@example.test", hashed_password="unused", role=UserRole.SUPER_ADMIN)
        self.db.add_all([self.owner, self.worker, self.outsider, self.admin])
        self.db.flush()
        self.project = Project(name="private", annotation_type=AnnotationType.DETECTION, creator_id=self.owner.id)
        self.other_project = Project(name="other", annotation_type=AnnotationType.DETECTION, creator_id=self.outsider.id)
        self.db.add_all([self.project, self.other_project])
        self.db.flush()
        self.db.add(Task(project_id=self.project.id, name="assigned", annotator_id=self.worker.id))
        self.db.add(Image(project_id=self.project.id, filename="private.png", filepath=f"images/{self.project.id}/private.png"))
        self.model = self.make_model(self.project.id, "own")
        self.other_model = self.make_model(self.other_project.id, "other")
        self.global_model = self.make_model(None, "legacy global")
        self.pending = PreAnnotationTask(project_id=self.project.id, model_id=self.model.id, task_id="pending-preannotation", selected_classes="[]", created_by=self.owner.id)
        self.archive = self.root / "training.zip"
        self.archive.write_bytes(b"private archive fixture")
        self.train_task = TrainingTask(project_id=self.project.id, task_id="completed-training", base_model="yolo11n.pt", status="completed", output_archive_path="archives/training.zip", created_by=self.owner.id)
        self.db.add_all([self.pending, self.train_task])
        self.db.commit()
        self.current_user = self.owner
        self.app = FastAPI()
        self.app.include_router(preannotation.router)
        self.app.include_router(training.router)
        self.app.dependency_overrides[get_db] = lambda: self.db
        self.app.dependency_overrides[get_current_user] = lambda: self.current_user
        self.client = TestClient(self.app)
        self.patch_task = patch.object(preannotation, "preannotate_project_task")
        self.fake_task = self.patch_task.start()
        self.patch_revoke = patch.object(preannotation.celery_app.control, "revoke")
        self.fake_revoke = self.patch_revoke.start()
        self.patch_archive = patch.object(training, "TRAINING_ARCHIVES_DIR", str(self.root))
        self.patch_archive.start()

    def tearDown(self):
        self.patch_archive.stop()
        self.patch_revoke.stop()
        self.patch_task.stop()
        self.client.close()
        self.db.close()
        self.engine.dispose()
        self.temp.cleanup()

    def make_model(self, project_id, name):
        model = Model(project_id=project_id, name=name, filename=f"{name}.pt", filepath=f"models/{name}.pt", created_by=self.admin.id)
        self.db.add(model)
        self.db.flush()
        return model

    def start_preannotation(self, model=None):
        return self.client.post("/api/preannotation", json={"project_id": self.project.id, "model_id": (model or self.model).id, "selected_classes": ["example"]})

    def test_annotator_cannot_start_cancel_or_download_entire_dataset(self):
        self.current_user = self.worker
        self.assertEqual(self.start_preannotation().status_code, 403)
        self.assertEqual(self.client.delete(f"/api/preannotation/task/{self.pending.task_id}").status_code, 403)
        self.assertEqual(self.client.get(f"/api/training/download-archive/{self.train_task.task_id}").status_code, 403)
        self.assertEqual(self.client.post(f"/api/training/task/{self.train_task.task_id}/revoke").status_code, 403)
        self.fake_task.delay.assert_not_called()
        self.fake_revoke.assert_not_called()
        self.assertEqual(self.db.query(PreAnnotationTask).count(), 1)

    def test_unrelated_project_admin_cannot_manage_project(self):
        self.current_user = self.outsider
        self.assertEqual(self.start_preannotation().status_code, 403)
        self.assertEqual(self.client.delete(f"/api/preannotation/task/{self.pending.task_id}").status_code, 403)
        self.assertEqual(self.client.get(f"/api/training/download-archive/{self.train_task.task_id}").status_code, 403)
        self.fake_task.delay.assert_not_called()
        self.fake_revoke.assert_not_called()

    def test_global_admin_role_does_not_override_annotator_membership(self):
        self.db.add(ProjectUser(project_id=self.project.id, user_id=self.outsider.id, role=UserRole.ANNOTATOR))
        self.db.commit()
        self.current_user = self.outsider
        self.assertEqual(self.start_preannotation().status_code, 403)
        self.assertEqual(self.client.get(f"/api/training/download-archive/{self.train_task.task_id}").status_code, 403)
        self.fake_task.delay.assert_not_called()

    def test_cross_project_and_legacy_global_models_are_rejected_before_queue(self):
        for model in (self.other_model, self.global_model):
            with self.subTest(model=model.name):
                self.assertEqual(self.start_preannotation(model).status_code, 404)
        self.fake_task.delay.assert_not_called()
        self.assertEqual(self.db.query(PreAnnotationTask).count(), 1)

    def test_owner_can_start_and_cancel_bulk_task(self):
        response = self.start_preannotation()
        self.assertEqual(response.status_code, 200, response.text)
        task_id = response.json()["task_id"]
        self.fake_task.delay.assert_called_once_with(task_id=task_id, project_id=self.project.id, model_id=self.model.id, selected_classes=["example"], conf_threshold=0.25)
        self.assertEqual(self.client.delete(f"/api/preannotation/task/{task_id}").status_code, 200)
        self.fake_revoke.assert_called_once_with(task_id, terminate=True)

    def test_project_owner_and_super_admin_can_download_dataset_archive(self):
        for user in (self.owner, self.admin):
            with self.subTest(role=user.role):
                self.current_user = user
                response = self.client.get(f"/api/training/download-archive/{self.train_task.task_id}")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, self.archive.read_bytes())

    def test_demoted_project_creator_cannot_manage_bulk_tasks(self):
        self.owner.role = UserRole.ANNOTATOR
        self.db.commit()
        self.assertEqual(self.start_preannotation().status_code, 403)
        self.assertEqual(self.client.delete(f"/api/preannotation/task/{self.pending.task_id}").status_code, 403)
        self.assertEqual(self.client.get(f"/api/training/download-archive/{self.train_task.task_id}").status_code, 403)
        self.assertEqual(self.client.post(f"/api/training/task/{self.train_task.task_id}/revoke").status_code, 403)
        self.fake_task.delay.assert_not_called()
        self.fake_revoke.assert_not_called()


if __name__ == "__main__":
    unittest.main()
