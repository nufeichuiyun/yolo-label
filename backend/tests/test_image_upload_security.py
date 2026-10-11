"""图片上传覆盖/清理边界；仅使用内存 SQLite、生成图片和临时文件。"""
import io
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import test_image_security as fixtures
from PIL import Image as PILImage
from app.models import Image, Task, TaskImage
from app.routers import images


class ImageUploadSecurityTests(unittest.TestCase):
    setUp = fixtures.ImageSecurityTests.setUp
    tearDown = fixtures.ImageSecurityTests.tearDown
    add_image = fixtures.ImageSecurityTests.add_image
    headers = fixtures.ImageSecurityTests.headers
    get_content = fixtures.ImageSecurityTests.get_content

    @staticmethod
    def png(color='red'):
        data = io.BytesIO()
        PILImage.new('RGB', (2, 2), color).save(data, format='PNG')
        return data.getvalue()

    def upload(self, files, user=None):
        return self.client.post(
            f'/api/images/upload/{self.project.id}',
            headers=self.headers(user or self.worker),
            files=[('files', (name, content, 'image/png')) for name, content in files],
        )

    def test_annotator_cannot_overwrite_unassigned_image_with_same_filename(self):
        target = self.project_dir / self.hidden.filename
        baseline = target.read_bytes()
        self.assertEqual(self.get_content(self.hidden, self.worker).status_code, 403)
        response = self.upload([(self.hidden.filename, self.png())])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['success_count'], 1)
        item = response.json()['images'][0]
        self.assertNotEqual(item['filename'], self.hidden.filename)
        self.assertTrue(item['filename'].endswith('_' + self.hidden.filename))
        self.assertEqual(item['filepath'], f"images/{self.project.id}/{item['filename']}")
        self.assertEqual(target.read_bytes(), baseline)
        self.assertEqual(self.get_content(self.hidden, self.worker).status_code, 403)
        self.assertEqual(self.db.query(Image).filter(Image.filepath == self.hidden.filepath).count(), 1)

    def test_duplicate_client_names_and_same_stem_extensions_have_distinct_labels(self):
        response = self.upload([('same.png', self.png()), ('same.png', self.png('green')),
                                ('same.jpg', self.png('yellow'))])
        self.assertEqual(response.status_code, 200)
        items = response.json()['images']
        self.assertEqual(len(items), 3)
        self.assertEqual(len({item['filepath'] for item in items}), 3)
        # These are the exact keys used by annotation files, training and export.
        self.assertEqual(len({Path(item['filename']).stem for item in items}), 3)
        self.assertEqual((self.root / items[0]['filepath']).read_bytes(), self.png())
        self.assertEqual((self.root / items[1]['filepath']).read_bytes(), self.png('green'))

    def test_uuid_collision_never_overwrites_or_removes_existing_file(self):
        target = self.project_dir / 'fixed_same.png'
        target.write_bytes(b'existing image must survive')
        with patch.object(images, 'uuid4', return_value=types.SimpleNamespace(hex='fixed')):
            response = self.upload([('same.png', self.png())])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['success_count'], 0)
        self.assertEqual(response.json()['failed_count'], 1)
        self.assertEqual(target.read_bytes(), b'existing image must survive')
        self.assertEqual(self.db.query(Image).count(), 2)

    def test_collision_in_same_batch_does_not_delete_first_success(self):
        with patch.object(images, 'uuid4', return_value=types.SimpleNamespace(hex='fixed')):
            response = self.upload([('same.png', self.png()), ('same.png', self.png('green'))])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['success_count'], 1)
        self.assertEqual(response.json()['failed_count'], 1)
        self.assertEqual((self.project_dir / 'fixed_same.png').read_bytes(), self.png())
        self.assertEqual(self.db.query(Image).count(), 3)

    def test_partial_copy_failure_cleans_only_its_new_file(self):
        initial_files = set(self.project_dir.iterdir())
        original_copy = images.shutil.copyfileobj
        calls = 0
        def partial_copy(source, destination):
            nonlocal calls
            calls += 1
            if calls == 1:
                destination.write(b'partial')
                raise OSError('simulated disk error')
            original_copy(source, destination)
        with patch.object(images.shutil, 'copyfileobj', side_effect=partial_copy):
            response = self.upload([('bad.png', self.png()), ('good.png', self.png('green'))])
        self.assertEqual(response.json()['success_count'], 1)
        self.assertEqual(response.json()['failed_count'], 1)
        new_files = set(self.project_dir.iterdir()) - initial_files
        self.assertEqual(len(new_files), 1)
        self.assertEqual(next(iter(new_files)).read_bytes(), self.png('green'))

    def test_commit_failure_rolls_back_images_and_task_assignments_and_cleans_files(self):
        self.project.images_per_task = 1
        self.db.commit()
        initial_files = {path: path.read_bytes() for path in self.project_dir.iterdir()}
        initial_tasks = self.db.query(Task).count()
        initial_links = self.db.query(TaskImage).count()
        with patch.object(self.db, 'commit', side_effect=RuntimeError('database unavailable')):
            response = self.upload([('new.png', self.png()), ('other.png', self.png())])
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.db.query(Image).count(), 2)
        self.assertEqual(self.db.query(Task).count(), initial_tasks)
        self.assertEqual(self.db.query(TaskImage).count(), initial_links)
        self.assertEqual({path: path.read_bytes() for path in self.project_dir.iterdir()}, initial_files)

    def test_database_add_failure_cleans_new_file(self):
        initial_files = set(self.project_dir.iterdir())
        with patch.object(self.db, 'add', side_effect=RuntimeError('database add failed')):
            response = self.upload([('new.png', self.png())])
        self.assertEqual(response.status_code, 500)
        self.assertEqual(set(self.project_dir.iterdir()), initial_files)
        self.assertEqual(self.db.query(Image).count(), 2)

    def test_readback_failure_does_not_remove_committed_image(self):
        refresh = self.db.refresh
        def fail_image_refresh(obj, *args, **kwargs):
            if isinstance(obj, Image):
                raise RuntimeError('readback unavailable')
            return refresh(obj, *args, **kwargs)
        with patch.object(self.db, 'refresh', side_effect=fail_image_refresh):
            response = self.upload([('new.png', self.png())])
        self.assertEqual(response.status_code, 500)
        row = self.db.query(Image).filter(Image.id.notin_([self.visible.id, self.hidden.id])).one()
        self.assertEqual((self.root / row.filepath).read_bytes(), self.png())

    def test_long_unicode_names_keep_extension_and_fit_filesystem(self):
        response = self.upload([('图' * 80 + '.PNG', self.png())])
        self.assertEqual(response.json()['success_count'], 1)
        name = response.json()['images'][0]['filename']
        self.assertLessEqual(len(name.encode('utf-8')), 255)
        self.assertTrue(name.endswith('.PNG'))
        self.assertIn('图', name)
        self.assertEqual((self.project_dir / name).read_bytes(), self.png())

    def test_empty_upload_cleans_its_file_without_touching_existing_image(self):
        initial_files = {path: path.read_bytes() for path in self.project_dir.iterdir()}
        response = self.upload([(self.hidden.filename, b'')])
        self.assertEqual(response.json()['success_count'], 0)
        self.assertEqual({path: path.read_bytes() for path in self.project_dir.iterdir()}, initial_files)


if __name__ == '__main__':
    unittest.main()
