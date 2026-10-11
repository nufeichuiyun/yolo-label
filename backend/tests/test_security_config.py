"""认证配置失败关闭与首次管理员初始化回归；不接触真实服务。"""
import contextlib
import io
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.security_config import DEVELOPMENT_SECRET, get_secret_key, get_initial_admin_password


class SecurityConfigTests(unittest.TestCase):
    def test_default_and_production_reject_missing_short_and_placeholder_keys(self):
        for mode in (None, "production"):
            for key in (None, "", "   ", "short", DEVELOPMENT_SECRET, "your-secret-key-change-in-production"):
                with self.subTest(mode=mode, key_type="missing" if key is None else "provided"):
                    env = {} if mode is None else {"YOLO_LABEL_ENV": mode}
                    if key is not None:
                        env["SECRET_KEY"] = key
                    with self.assertRaises(RuntimeError) as error:
                        get_secret_key(env)
                    if key and key.strip():
                        self.assertNotIn(key, str(error.exception))

    def test_existing_long_key_is_preserved_exactly(self):
        key = "legacy-installation-" + "aB19_" * 12
        self.assertEqual(get_secret_key({"SECRET_KEY": key}), key)

    def test_only_explicit_development_or_test_can_use_default(self):
        for mode in ("development", "test"):
            self.assertEqual(get_secret_key({"YOLO_LABEL_ENV": mode}), DEVELOPMENT_SECRET)
        for mode in ("", "dev", "testing", "prodution"):
            with self.assertRaises(RuntimeError):
                get_secret_key({"YOLO_LABEL_ENV": mode})

    def test_rknn_preflight_needs_only_standard_library_and_redacts_errors(self):
        root = Path(__file__).resolve().parents[1]
        env = {**os.environ, "PYTHONPATH": str(root), "YOLO_LABEL_ENV": "production", "SECRET_KEY": "invalid-private-value"}
        result = subprocess.run([sys.executable, "-S", "-m", "app.security_config"], cwd=root, env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(env["SECRET_KEY"], result.stdout + result.stderr)
        env["SECRET_KEY"] = "existing-random-secret-" + "4fdcb078" * 6
        result = subprocess.run([sys.executable, "-S", "-m", "app.security_config"], cwd=root, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_admin_default_is_random_in_production_only(self):
        first, generated = get_initial_admin_password({})
        second, _ = get_initial_admin_password({})
        self.assertTrue(generated)
        self.assertGreaterEqual(len(first), 24)
        self.assertNotEqual(first, second)
        self.assertEqual(get_initial_admin_password({"YOLO_LABEL_ENV": "test"}), ("admin123", False))
        with self.assertRaises(RuntimeError):
            get_initial_admin_password({"ADMIN_PASSWORD": "admin123"})


class AdminInitializationTests(unittest.TestCase):
    def setUp(self):
        os.environ.setdefault("DATABASE_URL", "sqlite://")
        import init_db
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        self.module = init_db
        self.engine = create_engine("sqlite://")
        init_db.Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.patches = [
            patch.object(init_db, "SessionLocal", self.sessions),
            patch.object(init_db, "__file__", str(self.root / "init_db.py")),
            patch.dict(os.environ, {"YOLO_LABEL_ENV": "production", "SECRET_KEY": "random-installation-key-" + "Ab72_" * 8, "ADMIN_PASSWORD": ""}),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.engine.dispose()
        self.temp.cleanup()

    def test_generated_password_private_file_not_log_and_existing_admin_unchanged(self):
        import bcrypt
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.module.create_admin()
        secret_file = self.root / ".initial_admin_password"
        password = secret_file.read_text().strip()
        self.assertEqual(stat.S_IMODE(secret_file.stat().st_mode), 0o600)
        self.assertNotIn(password, output.getvalue())
        with self.sessions() as db:
            admin = db.query(self.module.User).filter_by(username="admin").one()
            old_hash = admin.hashed_password
            self.assertTrue(bcrypt.checkpw(password.encode(), old_hash.encode()))
            self.assertEqual(admin.role, self.module.UserRole.SUPER_ADMIN)
        with patch.dict(os.environ, {"SECRET_KEY": "", "ADMIN_PASSWORD": "admin123"}):
            with contextlib.redirect_stdout(io.StringIO()):
                self.module.create_admin()
        with self.sessions() as db:
            self.assertEqual(db.query(self.module.User).one().hashed_password, old_hash)
        self.assertEqual(secret_file.read_text().strip(), password)

    def test_unclaimed_password_file_is_never_overwritten(self):
        secret_file = self.root / ".initial_admin_password"
        secret_file.write_text("existing-unclaimed-password")
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
            self.module.create_admin()
        self.assertEqual(secret_file.read_text(), "existing-unclaimed-password")
        with self.sessions() as db:
            self.assertEqual(db.query(self.module.User).count(), 0)

    def test_known_default_admin_password_fails_without_creating_account(self):
        with patch.dict(os.environ, {"ADMIN_PASSWORD": "admin123"}):
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
                self.module.create_admin()
        with self.sessions() as db:
            self.assertEqual(db.query(self.module.User).count(), 0)


if __name__ == "__main__":
    unittest.main()
