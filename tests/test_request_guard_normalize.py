"""Table-driven Host header normalisation (real ``make_app``)."""
from __future__ import annotations

import asyncio
from typing import Callable

import pytest
from aiohttp import ClientSession

from service import request_guard
from service.request_guard import HOST_REJECT_BODY
from tests.monitor_app_test_util import make_app_server


def _run(headers_for_port: Callable[[int], dict[str, str]], status: int, body: str | None = None) -> None:
    async def run() -> None:
        async with make_app_server() as (ip, port, runner):
            headers = headers_for_port(port)
            async with ClientSession() as session:
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers=headers,
                ) as resp:
                    assert resp.status == status
                    if body is not None:
                        assert await resp.text() == body

    asyncio.run(run())


@pytest.mark.parametrize(
    ("headers_for_port", "status", "body"),
    [
        (lambda p: {"Host": f"LOCALHOST:{p}"}, 200, None),
        (lambda p: {"Host": f"localhost.:{p}"}, 400, HOST_REJECT_BODY),
        (lambda _p: {"Host": "127.0.0.1"}, 400, HOST_REJECT_BODY),
        (
            lambda p: {
                "Host": f"evil.example:{p}",
                "X-Forwarded-Host": f"localhost:{p}",
            },
            400,
            HOST_REJECT_BODY,
        ),
        (lambda p: {"Host": f"[::1]:{p}"}, 200, None),
        (lambda p: {"Host": f"[fe80::1%eth0]:{p}"}, 400, HOST_REJECT_BODY),
    ],
    ids=[
        "case_fold_localhost",
        "trailing_dot_reject",
        "missing_port_on_7020",
        "forwarded_host_ignored",
        "ipv6_loopback",
        "ipv6_zone_reject",
    ],
)
def test_host_normalisation_table(
    headers_for_port: Callable[[int], dict[str, str]],
    status: int,
    body: str | None,
) -> None:
    _run(headers_for_port, status, body)


def test_implicit_port_80_when_bound_port_is_80() -> None:
    async def run() -> None:
        async with make_app_server() as (ip, port, runner):
            request_guard.configure_request_guard(runner.app, bind="127.0.0.1", port=80)
            async with ClientSession() as session:
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers={"Host": "127.0.0.1"},
                ) as resp:
                    assert resp.status == 200

    asyncio.run(run())


def test_missing_host_header_returns_400() -> None:
    async def run() -> None:
        async with make_app_server() as (ip, port, _runner):
            reader, writer = await asyncio.open_connection(ip, port)
            writer.write(
                b"GET /api/session HTTP/1.1\r\nConnection: close\r\n\r\n",
            )
            await writer.drain()
            data = await reader.read(512)
            writer.close()
            await writer.wait_closed()
            assert b"400" in data.split(b"\r\n", 1)[0]

    asyncio.run(run())


def test_duplicate_host_rejected_by_http_parser_before_middleware() -> None:
    """aiohttp/llhttp rejects duplicate Host with 400 before the app middleware runs."""
    async def run() -> None:
        async with make_app_server() as (ip, port, _runner):
            reader, writer = await asyncio.open_connection(ip, port)
            h = f"127.0.0.1:{port}"
            writer.write(
                (
                    f"GET /api/session HTTP/1.1\r\n"
                    f"Host: evil.example:{port}\r\n"
                    f"Host: {h}\r\n"
                    f"Connection: close\r\n\r\n"
                ).encode(),
            )
            await writer.drain()
            data = await reader.read(512)
            writer.close()
            await writer.wait_closed()
            assert b"400" in data.split(b"\r\n", 1)[0]

    asyncio.run(run())
