"""LAN allowlist OS lookup cost and 30s DHCP refresh throttle (stub ``query_os_interface_addresses``)."""
from __future__ import annotations

import asyncio

from aiohttp import ClientSession

from tests.lan_guard_test_util import LAN_STUB_IFACE_IP, LanOsStubState, stub_lan_os_interfaces
from tests.monitor_app_test_util import make_app_server


async def _many_ok(n: int, port: int, ip: str, host: str) -> None:
    async with ClientSession() as session:
        for _ in range(n):
            async with session.get(
                f"http://{ip}:{port}/api/session",
                headers={"Host": f"{host}:{port}"},
            ) as resp:
                assert resp.status == 200


async def _many_reject(n: int, port: int, ip: str, host: str) -> None:
    async with ClientSession() as session:
        for _ in range(n):
            async with session.get(
                f"http://{ip}:{port}/api/session",
                headers={"Host": f"{host}:{port}"},
            ) as resp:
                assert resp.status == 400


def test_hundred_unknown_hosts_zero_fresh_lookups_within_30s_after_one_startup_lookup(
    stub_lan_os_interfaces: LanOsStubState,
) -> None:
    async def run() -> None:
        async with make_app_server(bind="0.0.0.0", insecure_lan=True) as (ip, port, _runner):
            startup = stub_lan_os_interfaces["query_calls"]
            assert startup == 1, "configure: 1 startup lookup"
            await _many_reject(100, port, ip, "evil.example")
            fresh = stub_lan_os_interfaces["query_calls"] - startup
            assert fresh == 0, "100 unknown hosts within 30s: 0 fresh lookups"

    asyncio.run(run())


def test_thousand_accepted_requests_one_os_lookup_at_startup(
    stub_lan_os_interfaces: LanOsStubState,
) -> None:
    async def run() -> None:
        async with make_app_server(bind="0.0.0.0", insecure_lan=True) as (ip, port, _runner):
            assert stub_lan_os_interfaces["query_calls"] == 1
            await _many_ok(1000, port, ip, LAN_STUB_IFACE_IP)

    asyncio.run(run())
    assert stub_lan_os_interfaces["query_calls"] == 1


def test_dhcp_miss_within_30s_does_not_refresh_os_interfaces(
    stub_lan_os_interfaces: LanOsStubState,
) -> None:
    t0 = 1000.0
    now = t0

    def clock() -> float:
        return now

    async def run() -> None:
        nonlocal now
        async with make_app_server(
            bind="0.0.0.0",
            insecure_lan=True,
            clock=clock,
        ) as (ip, port, _runner):
            assert stub_lan_os_interfaces["query_calls"] == 1
            startup = stub_lan_os_interfaces["query_calls"]
            assert startup == 1, "configure: 1 startup lookup"
            await _many_reject(100, port, ip, "evil.example")
            assert stub_lan_os_interfaces["query_calls"] == startup
            now = t0 + 29.0
            await _many_reject(1, port, ip, "evil.example")
            assert stub_lan_os_interfaces["query_calls"] == startup, (
                "within 30s: 0 fresh lookups after startup"
            )

    asyncio.run(run())


def test_dhcp_miss_after_30s_refreshes_os_interfaces_once(
    stub_lan_os_interfaces: LanOsStubState,
) -> None:
    t0 = 1000.0
    now = t0

    def clock() -> float:
        return now

    async def run() -> None:
        nonlocal now
        async with make_app_server(
            bind="0.0.0.0",
            insecure_lan=True,
            clock=clock,
        ) as (ip, port, _runner):
            assert stub_lan_os_interfaces["query_calls"] == 1
            await _many_reject(1, port, ip, "evil.example")
            assert stub_lan_os_interfaces["query_calls"] == 1
            now = t0 + 31.0
            await _many_reject(1, port, ip, "evil.example")
            assert stub_lan_os_interfaces["query_calls"] == 2

    asyncio.run(run())
