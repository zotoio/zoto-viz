"""Request guard allowlist cost and DHCP refresh (real ``make_app``)."""
from __future__ import annotations

import asyncio

from aiohttp import ClientSession

from service import request_guard
from tests.monitor_app_test_util import host_header, make_app_server


async def _many_ok(n: int, port: int, ip: str) -> None:
    async with ClientSession() as session:
        for _ in range(n):
            async with session.get(
                f"http://{ip}:{port}/api/session",
                headers=host_header(port),
            ) as resp:
                assert resp.status == 200


def test_thousand_accepted_requests_one_interface_lookup_at_startup() -> None:
    async def run() -> None:
        async with make_app_server() as (ip, port, _runner):
            assert request_guard.interface_lookup_count() == 1
            await _many_ok(1000, port, ip)

    asyncio.run(run())
    assert request_guard.interface_lookup_count() == 1


def test_dhcp_miss_refreshes_interfaces_at_most_once_per_30s() -> None:
    t = 1000.0
    request_guard.reset_interface_lookup_counter()

    async def run() -> None:
        async with make_app_server() as (ip, port, runner):
            runner.app["request_guard_clock"] = lambda: t
            assert request_guard.interface_lookup_count() == 1
            async with ClientSession() as session:
                for _ in range(100):
                    async with session.get(
                        f"http://{ip}:{port}/api/session",
                        headers={"Host": f"evil.example:{port}"},
                    ) as resp:
                        assert resp.status == 400
            assert request_guard.interface_lookup_count() == 2

    asyncio.run(run())


def test_dhcp_new_interface_accepted_on_next_request_after_refresh(monkeypatch) -> None:
    calls = 0

    def fake_local(port: int) -> set[str]:
        nonlocal calls
        calls += 1
        request_guard._interface_lookup_calls += 1  # noqa: SLF001
        keys = {
            request_guard._canonical_key("127.0.0.1", port),
            request_guard._canonical_key("localhost", port),
            request_guard._canonical_key("::1", port),
        }
        if calls >= 2:
            keys.add(request_guard._canonical_key("192.168.77.7", port))
        return keys

    monkeypatch.setattr(request_guard, "local_interface_hosts", fake_local)
    request_guard.reset_interface_lookup_counter()

    async def run() -> None:
        async with make_app_server() as (ip, port, runner):
            assert request_guard.interface_lookup_count() == 1
            new_host = f"192.168.77.7:{port}"
            async with ClientSession() as session:
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers={"Host": new_host},
                ) as resp:
                    assert resp.status == 200

    asyncio.run(run())
    assert request_guard.interface_lookup_count() == 2
