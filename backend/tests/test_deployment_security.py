"""只生成临时 Compose 配置，不执行 Docker 或部署。"""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def environment(service):
    return dict(item.split("=", 1) for item in service["environment"])


class DeploymentSecurityTests(unittest.TestCase):
    def test_base_and_development_redis_private_and_worker_modes_consistent(self):
        base = yaml.safe_load((ROOT / "docker-compose.yml").read_text())["services"]
        dev = yaml.safe_load((ROOT / "docker-compose.dev.yml").read_text())["services"]
        self.assertFalse(base["redis"].get("ports"))
        for name in ("backend", "celery-worker", "rknn-worker"):
            self.assertEqual(environment(base[name])["YOLO_LABEL_ENV"], "${YOLO_LABEL_ENV:-production}")
            self.assertEqual(environment(base[name])["SECRET_KEY"], "${SECRET_KEY:-}")
            self.assertEqual(environment(dev[name])["YOLO_LABEL_ENV"], "development")
            self.assertEqual(environment(base[name])["REDIS_URL"], "redis://redis:6379/0")
        for name in ("celery-worker", "rknn-worker"):
            self.assertIn("python -m app.security_config && exec celery", base[name]["command"])

    def generate(self, key):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            # 加载函数定义但绝不进入 main；所有输出定向到一次性目录。
            script = (ROOT / "manage.sh").read_text().rsplit('main "$@"', 1)[0]
            script += '''
ENV_FILE="$AUDIT_OUTPUT/config.env"
COMPOSE_PROD="$AUDIT_OUTPUT/compose.yml"
FRONTEND_PORT=3000
BACKEND_PORT=8000
DB_PORT=5432
POSTGRES_PASSWORD=test-placeholder-db
ENABLE_GPU=false
generate_prod_config
generate_compose_prod
'''
            env = {**os.environ, "AUDIT_OUTPUT": directory, "SECRET_KEY": key, "YOLO_LABEL_ENV": "development"}
            result = subprocess.run(["bash"], input=script, env=env, cwd=ROOT, capture_output=True, text=True)
            content = (root / "compose.yml").read_text() if (root / "compose.yml").exists() else None
            return result, content

    def test_production_generator_cannot_inherit_development_mode(self):
        key = "production-validation-" + "Ab23ef45" * 6
        result, content = self.generate(key)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(key, result.stdout + result.stderr)
        services = yaml.safe_load(content)["services"]
        self.assertFalse(services["redis"].get("ports"))
        for name in ("backend", "celery-worker", "rknn-worker"):
            values = environment(services[name])
            self.assertEqual(values["YOLO_LABEL_ENV"], "production")
            self.assertEqual(values["SECRET_KEY"], key)
            self.assertEqual(values["REDIS_URL"], "redis://redis:6379/0")

    def test_generator_refuses_unsafe_keys_without_writing_compose(self):
        for key in ("", "short-private-key", "change-this-secret-key-in-production"):
            result, content = self.generate(key)
            self.assertNotEqual(result.returncode, 0)
            self.assertIsNone(content)
            if key:
                self.assertNotIn(key, result.stdout + result.stderr)

    def test_both_offline_entrypoints_reject_bad_keys_before_any_docker_operation(self):
        source = (ROOT / "manage.sh").read_text()
        standalone = source.split("<< 'DEPLOY_SCRIPT'\n", 1)[1].split("\nDEPLOY_SCRIPT", 1)[0]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = root / "docker-called"
            fake_docker = root / "docker"
            fake_docker.write_text('#!/bin/sh\ntouch "$DOCKER_CALL_MARKER"\nexit 99\n')
            fake_docker.chmod(0o700)
            deploy = root / "deploy.sh"
            deploy.write_text(standalone)
            for command in (["bash", str(ROOT / "manage.sh"), "offline", "deploy"], ["bash", str(deploy)]):
                for key in ("", "short-private", "change-this-secret-key-in-production", "CHANGE-THIS-SECRET-KEY-IN-PRODUCTION", " " * 40):
                    env = {**os.environ, "PATH": str(root) + os.pathsep + os.environ["PATH"], "SECRET_KEY": key, "DOCKER_CALL_MARKER": str(marker)}
                    result = subprocess.run(command, env=env, cwd=root, capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(marker.exists(), "unsafe preflight reached Docker")
                    if key.strip():
                        self.assertNotIn(key, result.stdout + result.stderr)

    def test_offline_init_uses_exit_status_instead_of_success_words(self):
        source = (ROOT / "manage.sh").read_text()
        standalone = source.split("<< 'DEPLOY_SCRIPT'\n", 1)[1].split("\nDEPLOY_SCRIPT", 1)[0]
        # 仅运行初始化至总结的原始块；Docker/sleep 为受控函数。
        initialization = standalone.split("# 5. 等待并初始化数据库\n", 1)[1]
        for exit_code, expected_calls in ((1, 5), (0, 1)):
            with self.subTest(exit_code=exit_code):
                with tempfile.TemporaryDirectory() as directory:
                    marker = Path(directory) / "docker-calls"
                    script = """set -e
sleep() { :; }
docker() {
    echo called >> "$DOCKER_CALL_MARKER"
    echo '数据库表创建成功'
    return "$INITIALIZATION_EXIT"
}
""" + initialization
                    env = {**os.environ, "DOCKER_CALL_MARKER": str(marker), "INITIALIZATION_EXIT": str(exit_code)}
                    result = subprocess.run(["bash"], input=script, env=env, cwd=directory, capture_output=True, text=True)
                    self.assertEqual(len(marker.read_text().splitlines()), expected_calls)
                    if exit_code:
                        self.assertNotEqual(result.returncode, 0)
                        self.assertNotIn("数据库初始化完成", result.stdout)
                        self.assertNotIn("部署完成！", result.stdout)
                    else:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertIn("数据库初始化完成", result.stdout)
                        self.assertIn("部署完成！", result.stdout)


if __name__ == "__main__":
    unittest.main()
