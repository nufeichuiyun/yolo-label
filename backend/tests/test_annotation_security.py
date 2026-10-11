"""批量标注的类别归属与失败不变性；临时数据库、真实 JWT、无业务服务。"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("YOLO_LABEL_ENV", "test")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.auth import create_access_token
from app.database import Base, get_db
from app.models import Annotation, AnnotationType, Category, Image, Project, Task, TaskImage, User, UserRole
from app.routers import annotations


class AnnotationSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.owner = User(username="owner", email="owner@example.com", hashed_password="unused", role=UserRole.PROJECT_ADMIN)
        self.worker = User(username="worker", email="worker@example.com", hashed_password="unused", role=UserRole.ANNOTATOR)
        self.db.add_all([self.owner, self.worker])
        self.db.flush()
        self.project = Project(name="own", annotation_type=AnnotationType.DETECTION, creator_id=self.owner.id)
        self.other = Project(name="other", annotation_type=AnnotationType.DETECTION, creator_id=self.owner.id)
        self.db.add_all([self.project, self.other])
        self.db.flush()
        self.category = Category(project_id=self.project.id, name="allowed", color="#ff0000")
        self.foreign = Category(project_id=self.other.id, name="private", color="#00ff00")
        self.image = Image(project_id=self.project.id, filename="sample.png", filepath="images/sample.png", is_annotated=True)
        self.task = Task(project_id=self.project.id, name="assigned", annotator_id=self.worker.id)
        self.db.add_all([self.category, self.foreign, self.image, self.task])
        self.db.flush()
        self.db.add(TaskImage(task_id=self.task.id, image_id=self.image.id))
        self.bbox = {"x_center": 0.5, "y_center": 0.5, "width": 0.2, "height": 0.3}
        self.original = Annotation(image_id=self.image.id, category_id=self.category.id, annotator_id=self.worker.id, bbox_data=json.dumps(self.bbox))
        self.db.add(self.original)
        self.db.commit()
        self.original_id = self.original.id
        self.label = self.root / str(self.project.id) / "sample.txt"
        self.label.parent.mkdir()
        self.original_text = "0 0.5 0.5 0.2 0.3\n"
        self.label.write_text(self.original_text)
        self.patch_dir = patch.object(annotations, "ANNOTATION_DIR", str(self.root))
        self.patch_dir.start()
        app = FastAPI()
        app.include_router(annotations.router)
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)
        token = create_access_token({"sub": self.worker.username, "token_version": self.worker.token_version})
        self.headers = {"Authorization": f"Bearer {token}"}

    def tearDown(self):
        self.client.close()
        self.patch_dir.stop()
        self.db.close()
        self.engine.dispose()
        self.temp.cleanup()

    def submit(self, category_ids):
        return self.client.post("/api/annotations", params={"image_id": self.image.id},
                                json=[{"category_id": item, "bbox": self.bbox} for item in category_ids], headers=self.headers)

    def assert_original_preserved(self):
        rows = self.db.query(Annotation).filter(Annotation.image_id == self.image.id).all()
        self.assertEqual([(row.id, row.category_id, json.loads(row.bbox_data)) for row in rows],
                         [(self.original_id, self.category.id, self.bbox)])
        self.assertTrue(self.db.get(Image, self.image.id).is_annotated)
        self.assertEqual(self.label.read_text(), self.original_text)

    def test_foreign_or_missing_category_rejects_entire_batch_before_mutation(self):
        for invalid in (self.foreign.id, 999999):
            for batch in ([invalid], [self.category.id, invalid], [invalid, self.category.id]):
                with self.subTest(batch=batch):
                    response = self.submit(batch)
                    self.assertEqual(response.status_code, 400, response.text)
                    self.assert_original_preserved()

    def test_malformed_category_ids_cannot_coerce_or_partially_replace(self):
        for invalid in (None, True, str(self.category.id), 1.0, [], {}, 0, -1):
            with self.subTest(invalid=invalid):
                self.assertEqual(self.submit([self.category.id, invalid]).status_code, 400)
                self.assert_original_preserved()

    def test_repeated_valid_category_updates_database_and_yolo_consistently(self):
        response = self.submit([self.category.id, self.category.id])
        self.assertEqual(response.status_code, 200, response.text)
        rows = self.db.query(Annotation).filter(Annotation.image_id == self.image.id).all()
        self.assertEqual([row.category_id for row in rows], [self.category.id] * 2)
        self.assertEqual(self.label.read_text(), self.original_text * 2)

    def test_empty_batch_can_clear_own_annotations(self):
        self.assertEqual(self.submit([]).status_code, 200)
        self.assertEqual(self.db.query(Annotation).filter(Annotation.image_id == self.image.id).count(), 0)
        self.assertFalse(self.db.get(Image, self.image.id).is_annotated)
        self.assertEqual(self.label.read_text(), "")

    def test_task_permission_still_precedes_category_validation(self):
        self.task.annotator_id = None
        self.db.commit()
        self.assertEqual(self.submit([self.foreign.id]).status_code, 403)
        self.assert_original_preserved()


if __name__ == "__main__":
    unittest.main()
