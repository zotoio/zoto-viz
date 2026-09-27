"""Wildcard bind must fail closed: only loopback + configured allowed_hosts."""
from __future__ import annotations

import asyncio
import json

import pytest
from aiohttp import ClientSession

from service.request_guard import HOST_REJECT_BODY, build_allowed_hosts
from tests.monitor_app_test_util import make_app_server


async def _get_status(ip: str, port: int, host: str) -> tuple[int, str]:
    async with ClientSession() as session:
        async with session.get(
            f"http://{ip}:{port}/api/session",
            headers={"Host": host},
        ) as resp:
            return resp.status, await resp.text()


@pytest.mark.parametrize(
    "bind",
    ["0.0.0.0", "::"],
)
def test_wildcard_bind_rejects_unlisted_hosts(bind: str) -> None:
    allowed = ["viz.example.lan"]

    async def run() -> None:
        async with make_app_server(
            bind=bind,
            insecure_lan=True,
            allowed_hosts=allowed,
        ) as (ip, port, _runner):
            port_s = str(port)
            bad_hosts = [
                f"evil.example:{port}",
                f"192.0.2.10:{port}",
                f"0.0.0.0:{port}",
                f"[::]:{port}",
            ]
            for h in bad_hosts:
                status, body = await _get_status(ip, port, h)
                assert status == 400
                assert body == HOST_REJECT_BODY
            good_hosts = [
                f"127.0.0.1:{port}",
                f"localhost:{port}",
                f"[::1]:{port}",
                f"viz.example.lan:{port}",
            ]
            for h in good_hosts:
                status, body = await _get_status(ip, port, h)
                assert status == 200
                data = json.loads(body)
                assert "csrf" in data

    asyncio.run(run())


def test_build_allowed_hosts_wildcard_bind_excludes_bind_address() -> None:
    port = 7020
    for bind in ("0.0.0.0", "::"):
        allowed = build_allowed_hosts(bind, port, ["viz.example.lan"])
        assert f"127.0.0.1:{port}" in allowed
        assert f"localhost:{port}" in allowed
        assert f"[::1]:{port}" in allowed
        assert f"viz.example.lan:{port}" in allowed
        assert f"evil.example:{port}" not in allowed
        assert f"0.0.0.0:{port}" not in allowed
        assert f"[::]:{port}" not in allowed
