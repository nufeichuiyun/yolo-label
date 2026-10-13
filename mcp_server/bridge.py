"""MCP 业务桥接：只调用已授权的 HTTP API，不直接访问数据库或执行命令。"""
import asyncio
import csv
import hashlib
import io
import json
import sqlite3
import time
import uuid
import zipfile
from contextlib import contextmanager
from pathlib import Path

import httpx


class Bridge:
    def __init__(self, config, transport=None):
        self.config = config
        self.root = Path(config['data_dir'])
        self.root.mkdir(parents=True, exist_ok=True)
        self.transport = transport
        self.token = None
        self.token_until = 0
        self.lock = asyncio.Lock()
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS requests (key TEXT PRIMARY KEY, payload TEXT, result TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS audit (time REAL, client TEXT, tool TEXT, status TEXT, target TEXT)')

    @contextmanager
    def db(self):
        connection = sqlite3.connect(self.root / 'operations.sqlite3', timeout=10)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def audit(self, client, tool, status, target=''):
        with self.db() as db:
            db.execute('INSERT INTO audit VALUES (?,?,?,?,?)', (time.time(), client, tool, status, str(target)))

    def client(self):
        return httpx.AsyncClient(base_url=self.config['api_url'], timeout=30, transport=self.transport, follow_redirects=False)

    async def login(self, client):
        if not self.token or time.time() > self.token_until:
            r = await client.post('/api/auth/login', json={
                'username': self.config['username'], 'password': self.config['password']})
            if r.status_code != 200:
                raise ValueError('MCP 服务账号登录失败，请检查账号状态与配置')
            self.token = r.json()['access_token']
            self.token_until = time.time() + 3600
        return {'Authorization': f'Bearer {self.token}'}

    async def request(self, method, path, **kwargs):
        async with self.client() as client:
            headers = await self.login(client)
            response = await client.request(method, path, headers=headers, **kwargs)
            # 只重试明确未通过认证的请求；不重试超时或 5xx 写请求。
            if response.status_code == 401:
                self.token = None
                response = await client.request(method, path, headers=await self.login(client), **kwargs)
            if response.status_code >= 400:
                raise ValueError(f'业务接口拒绝请求（HTTP {response.status_code}），请检查权限、数据和任务状态')
            return response.json()

    async def image_review(self, project_id, image_id, view, max_size, crop):
        from image_review import render_review

        await self.request('GET', f'/api/projects/{project_id}')
        info = await self.request('GET', f'/api/images/{image_id}')
        if info['project_id'] != project_id:
            raise ValueError('图片不属于指定项目')
        categories = await self.request('GET', f'/api/categories/project/{project_id}')
        annotations = await self.request('GET', f'/api/annotations/image/{image_id}')
        # 流式限制解压后的响应体；不接受调用方路径或 URL，也不缓存私有图片。
        limit = 40_000_000
        async with self.client() as client:
            for attempt in range(2):
                async with client.stream('GET', f'/api/images/{image_id}/content', headers=await self.login(client)) as response:
                    if response.status_code == 401 and attempt == 0:
                        self.token = None
                        continue
                    if response.status_code != 200:
                        raise ValueError(f'图片读取失败（HTTP {response.status_code}）')
                    data = bytearray()
                    async for block in response.aiter_bytes(chunk_size=65536):
                        if len(data) + len(block) > limit:
                            raise ValueError('图片文件超过 40 MB，请先压缩或切片')
                        data.extend(block)
                    break
        return await asyncio.to_thread(render_review, bytes(data), info, categories, annotations, view, max_size, crop)

    async def task(self, task_id):
        task_id = str(uuid.UUID(task_id))
        return await self.request('GET', f'/api/training/task/{task_id}')

    async def start(self, request_id, payload):
        key = str(uuid.UUID(request_id))
        canonical = json.dumps(payload, sort_keys=True)
        async with self.lock:
            # 重试仍然检查当前权限，不允许已撤销成员权限读取旧结果。
            await self.request('GET', f"/api/projects/{payload['project_id']}")
            with self.db() as db:
                old = db.execute('SELECT payload,result FROM requests WHERE key=?', (key,)).fetchone()
                if old:
                    if old[0] != canonical:
                        raise ValueError('同一个 request_id 不能用于不同训练参数')
                    if old[1] is None:
                        raise ValueError('上次提交结果未知，先查询训练列表；不要换 request_id 自动重试')
                    return json.loads(old[1])
            tasks = await self.request('GET', f"/api/training/project/{payload['project_id']}")
            if any(t['status'] in ('pending', 'running') for t in tasks):
                raise ValueError('项目已有待执行或运行中的训练')
            with self.db() as db:
                db.execute('INSERT INTO requests VALUES (?,?,NULL)', (key, canonical))
            result = await self.request('POST', '/api/training', json=payload)
            with self.db() as db:
                db.execute('UPDATE requests SET result=? WHERE key=?', (json.dumps(result), key))
            return result

    async def artifact(self, task_id, kind):
        task = await self.task(task_id)
        if kind not in ('model', 'archive'):
            raise ValueError('kind 必须是 model 或 archive')
        if task['status'] != 'completed':
            raise ValueError('训练尚未完成')
        suffix = '.pt' if kind == 'model' else '.zip'
        output = self.root / f'{task["task_id"]}-{kind}{suffix}'
        # 每次下载仍走业务接口，不能借缓存绕过最新权限。
        part = self.root / f'{uuid.uuid4()}.part'
        endpoint = 'download' if kind == 'model' else 'download-archive'
        digest = hashlib.sha256()
        size = 0
        try:
            async with self.client() as client:
                async with client.stream('GET', f'/api/training/{endpoint}/{task["task_id"]}', headers=await self.login(client), timeout=120) as r:
                    if r.status_code != 200:
                        raise ValueError(f'产物下载失败（HTTP {r.status_code}）')
                    with part.open('wb') as f:
                        async for block in r.aiter_bytes():
                            size += len(block)
                            if size > self.config.get('max_artifact_bytes', 2147483648):
                                raise ValueError('产物超过服务配置的下载大小上限')
                            digest.update(block)
                            f.write(block)
            part.replace(output)
        finally:
            part.unlink(missing_ok=True)
        return {'task_id': task['task_id'], 'kind': kind, 'bytes': size, 'sha256': digest.hexdigest(),
                'filename': output.name, 'download_path': f'/artifacts/{task["task_id"]}/{kind}'}, output

    async def report(self, task_id):
        task = await self.task(task_id)
        if task['status'] != 'completed':
            return {'task': task, 'epochs': [], 'note': '训练未完成，仅返回当前状态和实时指标'}
        _, path = await self.artifact(task_id, 'archive')
        with zipfile.ZipFile(path) as z:
            files = [i for i in z.infolist() if i.filename.endswith('/training_results/results.csv')]
            if len(files) != 1 or files[0].file_size > 5_000_000:
                raise ValueError('训练包缺少唯一的 results.csv 或文件过大')
            rows = list(csv.DictReader(io.StringIO(z.read(files[0]).decode('utf-8-sig'))))
            rows = [{k.strip(): v.strip() for k, v in row.items()} for row in rows]
        return {'task': task, 'epoch_count': len(rows), 'epochs': rows[-100:],
                'note': '最多返回最近 100 轮；不同数据划分的指标不宜直接比较。'}
