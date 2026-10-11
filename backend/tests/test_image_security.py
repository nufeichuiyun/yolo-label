"""图片内容与整项目导出权限回归；只用临时数据库和图片，不连接业务服务。"""
import ast
import io
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("YOLO_LABEL_ENV", "test")
os.environ.setdefault("SECRET_KEY", "test-only-image-security-key-32-characters")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image as PILImage
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.auth import create_access_token
from app.database import Base, get_db
from app.models import AnnotationType, Image, Project, ProjectUser, Task, TaskImage, User, UserRole
from app.routers import images, export


class ImageSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.admin = User(username="admin", email="admin@example.test", hashed_password="unused", role=UserRole.SUPER_ADMIN)
        self.owner = User(username="owner", email="owner@example.test", hashed_password="unused", role=UserRole.PROJECT_ADMIN)
        self.worker = User(username="worker", email="worker@example.test", hashed_password="unused", role=UserRole.ANNOTATOR)
        self.outsider = User(username="outsider", email="outsider@example.test", hashed_password="unused", role=UserRole.PROJECT_ADMIN)
        self.db.add_all([self.admin, self.owner, self.worker, self.outsider])
        self.db.flush()
        self.project = Project(name="private", annotation_type=AnnotationType.DETECTION, creator_id=self.owner.id)
        self.db.add(self.project)
        self.db.flush()
        self.project_dir = self.root / "images" / str(self.project.id)
        self.project_dir.mkdir(parents=True)
        self.visible = self.add_image("中文 空格%25.png")
        self.hidden = self.add_image("other-task.png")
        task = Task(project_id=self.project.id, name="assigned", annotator_id=self.worker.id, status="assigned")
        self.db.add(task)
        self.db.flush()
        self.db.add(TaskImage(task_id=task.id, image_id=self.visible.id))
        self.db.commit()
        self.app = FastAPI()
        self.app.include_router(images.router)
        self.app.include_router(export.router)
        self.app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(self.app)
        self.patch_images = patch.object(images, "UPLOAD_DIR", str(self.root))
        self.patch_export = patch.object(export, "UPLOAD_DIR", str(self.root))
        self.patch_images.start()
        self.patch_export.start()

    def add_image(self, name):
        file = self.project_dir / name
        PILImage.new("RGB", (2, 2), "blue").save(file)
        image = Image(project_id=self.project.id, filename=name,
                      filepath=f"images/{self.project.id}/{name}", width=2, height=2, file_size=file.stat().st_size)
        self.db.add(image)
        self.db.flush()
        return image

    def tearDown(self):
        self.patch_export.stop()
        self.patch_images.stop()
        self.client.close()
        self.db.close()
        self.engine.dispose()
        self.temp.cleanup()

    def headers(self, user):
        token = create_access_token({"sub": user.username, "token_version": user.token_version})
        return {"Authorization": f"Bearer {token}"}

    def get_content(self, image, user):
        return self.client.get(f"/api/images/{image.id}/content", headers=self.headers(user))

    def test_anonymous_and_query_token_cannot_read_images(self):
        url = f"/api/images/{self.visible.id}/content"
        self.assertEqual(self.client.get(url).status_code, 401)
        token = create_access_token({"sub": self.admin.username, "token_version": 0})
        self.assertEqual(self.client.get(url, params={"token": token}).status_code, 401)
        self.assertEqual(self.client.get(url, headers={"Authorization": "Bearer invalid"}).status_code, 401)

    def test_allowed_image_uses_private_headers_and_handles_unicode_filename(self):
        expected = (self.project_dir / self.visible.filename).read_bytes()
        for user in (self.owner, self.admin, self.worker):
            with self.subTest(role=user.role):
                response = self.get_content(self.visible, user)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, expected)
                self.assertEqual(response.headers["content-type"], "image/png")
                self.assertEqual(response.headers["cache-control"], "private, no-store")
                self.assertEqual(response.headers["x-content-type-options"], "nosniff")

    def test_cross_project_and_other_task_cannot_read_content_or_metadata(self):
        for user, image in ((self.outsider, self.visible), (self.worker, self.hidden)):
            for suffix in ("", "/content"):
                with self.subTest(role=user.role, suffix=suffix):
                    response = self.client.get(f"/api/images/{image.id}{suffix}", headers=self.headers(user))
                    self.assertEqual(response.status_code, 403)

    def test_project_membership_alone_does_not_expand_annotator_images(self):
        self.db.add(ProjectUser(project_id=self.project.id, user_id=self.worker.id, role=UserRole.ANNOTATOR))
        self.db.commit()
        self.assertEqual(self.get_content(self.hidden, self.worker).status_code, 403)
        self.assertEqual(self.get_content(self.visible, self.worker).status_code, 200)

    def test_revoked_assignment_is_checked_on_each_request(self):
        self.assertEqual(self.get_content(self.visible, self.worker).status_code, 200)
        task = self.db.query(Task).first()
        task.annotator_id = None
        self.db.commit()
        self.assertEqual(self.get_content(self.visible, self.worker).status_code, 403)

    def test_token_version_revocation_is_enforced_for_content(self):
        headers = self.headers(self.owner)
        self.owner.token_version += 1
        self.db.commit()
        response = self.client.get(f"/api/images/{self.visible.id}/content", headers=headers)
        self.assertEqual(response.status_code, 401)

    def test_missing_path_and_cross_project_path_do_not_leak_files(self):
        original = self.visible.filepath
        outside = self.root / "private.png"
        outside.write_bytes(b"private data")
        other = self.root / "images" / "999" / "other.png"
        other.parent.mkdir(parents=True)
        other.write_bytes(b"another project")
        for path in ("private.png", str(outside), "../outside.png", "images/999/other.png", "images/1/missing.png"):
            with self.subTest(path=path):
                self.visible.filepath = path
                self.db.commit()
                self.assertEqual(self.get_content(self.visible, self.owner).status_code, 404)
        self.visible.filepath = original
        self.db.commit()
        self.assertEqual(self.client.get("/api/images/99999/content", headers=self.headers(self.admin)).status_code, 404)

    def test_symlink_cannot_escape_the_project_directory(self):
        outside = self.root / "private.png"
        outside.write_bytes(b"private data")
        link = self.project_dir / "link.png"
        link.symlink_to(outside)
        self.visible.filepath = f"images/{self.project.id}/link.png"
        self.db.commit()
        self.assertEqual(self.get_content(self.visible, self.owner).status_code, 404)

    def test_bulk_export_cannot_bypass_image_task_permissions(self):
        for kind in ("yolo", "full"):
            url = f"/api/export/project/{self.project.id}/{kind}"
            for user in (self.worker, self.outsider):
                with self.subTest(kind=kind, user=user.username):
                    self.assertEqual(self.client.get(url, headers=self.headers(user)).status_code, 403)
            self.assertEqual(self.client.get(url).status_code, 401)

    def test_owner_can_still_export_full_project(self):
        created = []
        original_temp = tempfile.NamedTemporaryFile
        def in_scratch(*args, **kwargs):
            kwargs["dir"] = self.root
            file = original_temp(*args, **kwargs)
            created.append(file.name)
            return file
        with patch.object(export.tempfile, "NamedTemporaryFile", side_effect=in_scratch):
            response = self.client.get(f"/api/export/project/{self.project.id}/full", headers=self.headers(self.owner))
        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertTrue(any(path.endswith(self.visible.filename) for path in archive.namelist()))
            self.assertTrue(any(path.endswith(self.hidden.filename) for path in archive.namelist()))
        for filename in created:
            Path(filename).unlink(missing_ok=True)

    def test_entrypoint_has_no_unprotected_static_upload_mount(self):
        # 内容路由使用真实 HTTP/数据库测试；这里同时防止主应用重新挂上匿名静态入口。
        source = Path(__file__).resolve().parents[1] / "main.py"
        tree = ast.parse(source.read_text())
        mounts = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                  and isinstance(node.func, ast.Attribute) and node.func.attr == "mount"]
        self.assertFalse(any(node.args and isinstance(node.args[0], ast.Constant)
                             and node.args[0].value == "/uploads" for node in mounts))


if __name__ == "__main__":
    unittest.main()
