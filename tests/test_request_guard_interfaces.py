"""LAN allowlist includes real interface addresses from the OS."""
from __future__ import annotations

import asyncio

import pytest
from aiohttp import ClientSession

from service import request_guard
from service.request_guard import HOST_REJECT_BODY
from tests.monitor_app_test_util import host_header, make_app_server


def test_os_interface_query_stub_allows_non_loopback_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        request_guard,
        "query_os_interface_addresses",
        lambda: ["172.30.0.2", "10.0.0.5", "127.0.0.1"],
    )
    request_guard.reset_interface_lookup_counter()

    async def run() -> None:
        async with make_app_server(bind="0.0.0.0") as (ip, port, _runner):
            async with ClientSession() as session:
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers={"Host": f"172.30.0.2:{port}"},
                ) as ok:
                    assert ok.status == 200
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers={"Host": f"evil.example:{port}"},
                ) as bad:
                    assert bad.status == 400
                    assert await bad.text() == HOST_REJECT_BODY

    asyncio.run(run())
