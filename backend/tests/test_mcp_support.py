import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_bulk_task_security as fixtures
from app.routers import stats
from app.services.dataset_quality import invalid_geometry, summarize
from app.services.training_cancellation import check_cancelled


class DatasetQualityTests(unittest.TestCase):
    def test_geometry_and_negative_samples(self):
        good = json.dumps(dict(x_center=.5, y_center=.5, width=.2, height=.2))
        for raw in ('{}', 'null', '{', json.dumps(dict(x_center=.99, y_center=.5, width=.2, height=.2)), good.replace('0.5', 'NaN')):
            self.assertTrue(invalid_geometry(raw, 'detection'), raw)
        self.assertFalse(invalid_geometry(good, 'detection'))
        self.assertTrue(invalid_geometry('{"points":[[0,0],[1,1]]}', 'segmentation'))
        result = summarize([SimpleNamespace(id=1, name='sample')],
            [SimpleNamespace(id=1, is_annotated=True), SimpleNamespace(id=2, is_annotated=False)],
            [SimpleNamespace(id=1, image_id=1, category_id=1, bbox_data=good)], 'detection')
        self.assertEqual(result['empty_images'], 1)
        self.assertEqual(result['categories'][0]['instances'], 1)
        self.assertEqual(result['invalid_annotations'], 0)

    def test_project_scope_and_annotator_denied(self):
        f = fixtures.BulkTaskSecurityTests()
        f.setUp()
        try:
            f.app.include_router(stats.router)
            url = f'/api/stats/project/{f.project.id}/quality'
            self.assertEqual(f.client.get(url).status_code, 200)
            for user in (f.worker, f.outsider):
                f.current_user = user
                self.assertEqual(f.client.get(url).status_code, 403)
        finally:
            f.tearDown()

    def test_cancellation_uses_persisted_state(self):
        f = fixtures.BulkTaskSecurityTests()
        f.setUp()
        try:
            with patch('app.services.training_cancellation.SessionLocal') as session:
                session.return_value.__enter__.return_value = f.db
                check_cancelled(f.train_task.task_id)
                f.train_task.status = 'failed'
                f.train_task.error_message = '用户中断'
                f.db.commit()
                with self.assertRaisesRegex(RuntimeError, '用户中断'):
                    check_cancelled(f.train_task.task_id)
                f.train_task.error_message = '后端启动时清扫'
                f.db.commit()
                check_cancelled(f.train_task.task_id)
        finally:
            f.tearDown()
