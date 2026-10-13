import asyncio
import io
import json
import sys
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path

import httpx
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
        self.assertEqual(len(names), 9)
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
