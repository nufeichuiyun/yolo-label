"""本地 stdio 转接器：让桌面客户端从私有文件读取令牌，无需写入 MCP 公共配置。"""
import argparse
import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.server import Server
from mcp.server.stdio import stdio_server


async def run(config, client_name):
    @asynccontextmanager
    async def lifespan(server):
        async with httpx.AsyncClient(headers={'Authorization': 'Bearer ' + config['tokens'][client_name]}, timeout=120) as http:
            async with streamable_http_client(config['url'], http_client=http) as (read, write, _):
                async with ClientSession(read, write) as upstream:
                    await upstream.initialize()
                    yield upstream

    server = Server('yolo-label', lifespan=lifespan)

    @server.list_tools()
    async def list_tools():
        return (await server.request_context.lifespan_context.list_tools()).tools

    @server.call_tool()
    async def call_tool(name, arguments):
        return await server.request_context.lifespan_context.call_tool(name, arguments)

    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--client', required=True)
    args = parser.parse_args()
    asyncio.run(run(json.loads(args.config.read_text(encoding='utf-8-sig')), args.client))
