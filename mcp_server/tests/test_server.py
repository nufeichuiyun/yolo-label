import asyncio
import base64
import io
import json
import os
import sys
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path

import httpx
from PIL import Image
from starlette.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge import Bridge
from server import create_app

TOKEN = 'test-only-mcp-token-' + 'x' * 32
TASK = '00000000-0000-4000-8000-000000000001'


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.calls = []
        self.task = {'task_id': TASK, 'project_id': 3, 'status': 'completed'}
        self.config = dict(data_dir=self.temp.name, api_url='http://backend', username='fixture', password='fixture',
                           tokens={'codex': TOKEN}, allowed_hosts=['testserver'])
        self.denied = False
        self.timeout = False
        self.image_project = 3
        picture = io.BytesIO()
        Image.new('RGB', (800, 600), 'white').save(picture, format='PNG')
        self.picture = picture.getvalue()
        self.annotations = [{'id': 7, 'category_id': 2, 'bbox_data': json.dumps(
            {'x_center': .5, 'y_center': .5, 'width': .5, 'height': .5})}]
        self.transport = httpx.MockTransport(self.backend)
        self.client = TestClient(create_app(self.config, self.transport))
        self.client.__enter__()
        self.headers = {'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/json, text/event-stream'}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def backend(self, request):
        path = request.url.path
        self.calls.append((request.method, path))
        if path == '/api/auth/login':
            return httpx.Response(200, json={'access_token': 'private-backend-token'})
        if self.denied or '/99' in path:
            return httpx.Response(403, json={'detail': 'private info must not leak'})
        if path == '/api/projects':
            return httpx.Response(200, json={'items': [{'id': 3}], 'total': 1})
        if path == '/api/projects/3':
            return httpx.Response(200, json={'id': 3})
        if path == '/api/images/project/3':
            return httpx.Response(200, json={'total': 1, 'items': [{'id': 8, 'project_id': 3, 'filename': 'fixture.png', 'filepath': '/private/path', 'annotation_count': 1}]})
        if path == '/api/images/8':
            return httpx.Response(200, json={'id': 8, 'project_id': self.image_project, 'filename': 'fixture.png', 'width': 800, 'height': 600})
        if path == '/api/images/8/content':
            return httpx.Response(200, content=self.picture)
        if path == '/api/categories/project/3':
            return httpx.Response(200, json=[{'id': 2, 'name': '破损'}])
        if path == '/api/annotations/image/8':
            return httpx.Response(200, json=self.annotations)
        if path == '/api/training/project/3':
            return httpx.Response(200, json=[])
        if path == '/api/training':
            if self.timeout:
                raise httpx.ReadTimeout('fixture timeout')
            return httpx.Response(200, json=self.task)
        if path == f'/api/training/task/{TASK}':
            return httpx.Response(200, json=self.task)
        if path.startswith('/api/training/download-archive/'):
            data = io.BytesIO()
            with zipfile.ZipFile(data, 'w') as z:
                z.writestr('fixture/training_results/results.csv', 'epoch, metrics/mAP50(B)\n1, 0.25\n')
            return httpx.Response(200, content=data.getvalue())
        if path.startswith('/api/training/download/'):
            return httpx.Response(200, content=b'fixture model')
        return httpx.Response(404)

    def rpc(self, name, args):
        r = self.client.post('/mcp', headers=self.headers, json={
            'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': name, 'arguments': args}})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['result']

    def test_protocol_discovery_and_structured_result(self):
        r = self.client.post('/mcp', headers=self.headers, json={'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'})
        names = {t['name'] for t in r.json()['result']['tools']}
        self.assertEqual(len(names), 11)
        self.assertIn('start_training', names)
        self.assertEqual(self.rpc('list_projects', {})['structuredContent']['total'], 1)

    def test_unauthorized_origin_and_host_denied(self):
        self.assertEqual(self.client.get('/mcp').status_code, 401)
        self.assertEqual(self.client.get('/artifacts/x/model').status_code, 401)
        self.assertEqual(self.client.get('/mcp', headers={**self.headers, 'Origin': 'http://evil.test'}).status_code, 403)
        self.assertEqual(self.client.get('/mcp', headers={**self.headers, 'Host': 'evil.test'}).status_code, 403)
        self.assertEqual(self.calls, [])

    def test_permissions_and_parameter_validation(self):
        result = self.rpc('project_summary', {'project_id': 99})
        self.assertTrue(result['isError'])
        self.assertNotIn('private info', json.dumps(result))
        before = len(self.calls)
        self.assertTrue(self.rpc('start_training', {'project_id': 3, 'request_id': str(uuid.uuid4()), 'epochs': 0})['isError'])
        self.assertEqual(len(self.calls), before)
        self.assertTrue(self.rpc('training_status', {'task_id': '../../auth/login'})['isError'])

    def test_retry_and_restart_do_not_enqueue_again(self):
        request_id = str(uuid.uuid4())
        args = {'project_id': 3, 'request_id': request_id}
        self.assertFalse(self.rpc('start_training', args).get('isError', False))
        self.assertFalse(self.rpc('start_training', args).get('isError', False))
        payload = dict(project_id=3, base_model=None, epochs=3, imgsz=640, batch=4, train_split=0.8, convert_to_rknn=False)
        result = asyncio.run(Bridge(self.config, self.transport).start(request_id, payload))
        self.assertEqual(result['task_id'], TASK)
        self.assertEqual(self.calls.count(('POST', '/api/training')), 1)
        self.assertTrue(self.rpc('start_training', {**args, 'epochs': 4})['isError'])
        self.denied = True
        self.assertTrue(self.rpc('start_training', args)['isError'])

    def test_unknown_submission_is_not_retried(self):
        self.timeout = True
        args = {'project_id': 3, 'request_id': str(uuid.uuid4())}
        self.assertTrue(self.rpc('start_training', args)['isError'])
        self.assertTrue(self.rpc('start_training', args)['isError'])
        self.assertEqual(self.calls.count(('POST', '/api/training')), 1)

    def test_artifact_report_and_audit_exclude_secrets(self):
        info = self.rpc('get_artifact', {'task_id': TASK})['structuredContent']
        self.assertEqual(info['bytes'], 13)
        self.assertEqual(self.client.get(info['download_path'], headers=self.headers).content, b'fixture model')
        report = self.rpc('training_report', {'task_id': TASK})['structuredContent']
        self.assertEqual(report['epochs'][0]['metrics/mAP50(B)'], '0.25')
        with Bridge(self.config, self.transport).db() as db:
            rows = db.execute('SELECT * FROM audit').fetchall()
        self.assertTrue(any(row[1] == 'codex' and row[2] == 'get_artifact' for row in rows))
        self.assertNotIn(TOKEN, repr(rows))
        self.assertNotIn('private-backend-token', repr(rows))
        self.denied = True
        self.assertTrue(self.rpc('get_artifact', {'task_id': TASK})['isError'])

    def test_images_native_blocks_and_private_path_removed(self):
        listing = self.rpc('list_images', {'project_id': 3})
        self.assertNotIn('/private/path', json.dumps(listing))
        result = self.rpc('inspect_image', {'project_id': 3, 'image_id': 8, 'max_size': 400})
        self.assertFalse(result.get('isError'), result)
        self.assertEqual([c['type'] for c in result['content']], ['text', 'image', 'image'])
        info = result['structuredContent']
        self.assertEqual(info['annotations'][0]['category_name'], '破损')
        self.assertEqual(info['annotations'][0]['pixel_bounds'], [200, 150, 600, 450])
        self.assertEqual(info['preview_size'], [400, 300])
        frames = [Image.open(io.BytesIO(base64.b64decode(c['data']))) for c in result['content'][1:]]
        self.assertEqual(frames[0].getpixel((100, 100)), (255, 255, 255))
        self.assertNotEqual(frames[1].getpixel((100, 100)), (255, 255, 255))
        crop = self.rpc('inspect_image', {'project_id': 3, 'image_id': 8, 'view': 'overlay', 'crop': [100, 100, 700, 500], 'max_size': 300})
        self.assertEqual(crop['structuredContent']['preview_size'], [300, 200])
        frame = Image.open(io.BytesIO(base64.b64decode(crop['content'][1]['data'])))
        self.assertNotEqual(frame.getpixel((50, 80)), (255, 255, 255))
        self.assertEqual(frame.getpixel((80, 80)), (255, 255, 255))

    def test_image_permission_and_validation_before_bytes(self):
        args = {'project_id': 3, 'image_id': 8}
        self.image_project = 4
        self.assertTrue(self.rpc('inspect_image', args)['isError'])
        self.assertNotIn(('GET', '/api/images/8/content'), self.calls)
        self.image_project = 3
        self.denied = True
        self.assertTrue(self.rpc('inspect_image', args)['isError'])
        self.assertNotIn(('GET', '/api/images/8/content'), self.calls)
        self.denied = False
        self.assertTrue(self.rpc('inspect_image', {**args, 'max_size': 99999})['isError'])
        self.assertNotIn(('GET', '/api/images/8/content'), self.calls)
        self.assertTrue(self.rpc('inspect_image', {**args, 'crop': [0, 0, 900, 500]})['isError'])
        self.assertTrue(self.rpc('inspect_image', {**args, 'crop': [0, 0, 100]})['isError'])
        self.assertFalse(self.rpc('inspect_image', args).get('isError'))
        self.denied = True
        self.assertTrue(self.rpc('inspect_image', args)['isError'])

    def test_malformed_geometry_is_reported_without_changing_annotations(self):
        self.annotations = [
            {'id': 1, 'category_id': 2, 'bbox_data': '{broken'},
            {'id': 2, 'category_id': 99, 'bbox_data': '{"x_center":0.99,"y_center":0.5,"width":0.5,"height":0.1}'},
            {'id': 3, 'category_id': 2, 'bbox_data': '{"x_center":NaN,"y_center":0.5,"width":0.1,"height":0.1}'},
            {'id': 4, 'category_id': 2, 'bbox_data': '{"points":[[0.1,0.1],[0.4,0.1],[0.3,0.5]]}'}]
        before = json.dumps(self.annotations)
        result = self.rpc('inspect_image', {'project_id': 3, 'image_id': 8})
        self.assertFalse(result.get('isError'), result)
        rows = result['structuredContent']['annotations']
        self.assertTrue(all(row['issues'] for row in rows[:3]))
        self.assertEqual(rows[3]['type'], 'polygon')
        self.assertEqual(rows[3]['issues'], [])
        self.assertEqual(before, json.dumps(self.annotations))
        self.assertTrue(all(method == 'GET' or path == '/api/auth/login' for method, path in self.calls))

    def test_image_decode_limits_and_exif_orientation(self):
        from unittest.mock import patch
        args = {'project_id': 3, 'image_id': 8}
        self.picture = b'not an image'
        self.assertTrue(self.rpc('inspect_image', args)['isError'])
        picture = io.BytesIO()
        exif = Image.Exif()
        exif[274] = 6
        Image.new('RGB', (800, 600)).save(picture, format='JPEG', exif=exif)
        self.picture = picture.getvalue()
        result = self.rpc('inspect_image', args)
        self.assertEqual(result['structuredContent']['display_size'], [600, 800])
        self.assertEqual(result['structuredContent']['exif_orientation'], 6)
        frame = Image.open(io.BytesIO(base64.b64decode(result['content'][1]['data'])))
        self.assertFalse(frame.getexif())
        with patch('image_review.MAX_PIXELS', 10):
            self.assertTrue(self.rpc('inspect_image', args)['isError'])
        self.picture = b'X' * 40_000_001
        self.assertTrue(self.rpc('inspect_image', args)['isError'])

    def test_backend_connection_ignores_unrelated_system_proxy(self):
        from unittest.mock import patch
        proxy = 'http://127.0.0.1:1'
        with patch.dict(os.environ, {'HTTP_PROXY': proxy, 'HTTPS_PROXY': proxy, 'ALL_PROXY': proxy, 'NO_PROXY': '',
                                     'http_proxy': proxy, 'https_proxy': proxy, 'all_proxy': proxy, 'no_proxy': ''}):
            result = self.rpc('list_projects', {})
        self.assertFalse(result.get('isError'), result)
        self.assertEqual(result['structuredContent']['total'], 1)
