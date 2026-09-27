"""LAN allowlist OS lookup cost and 30s DHCP refresh throttle (stub ``query_os_interface_addresses``)."""
from __future__ import annotations

import asyncio

from aiohttp import ClientSession

from tests.lan_guard_test_util import (
    LAN_STUB_IFACE_IP,
    LAN_STUB_OTHER_IP,
    LanOsStubState,
    stub_lan_os_interfaces,
)
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
            listen_port=18450,
            clock=clock,
        ) as (ip, port, _runner):
            startup = stub_lan_os_interfaces["query_calls"]
            assert startup == 1, "configure: 1 startup lookup"
            await _many_reject(100, port, ip, "evil.example")
            fresh = stub_lan_os_interfaces["query_calls"] - startup
            assert fresh == 0, "100 unknown hosts within 30s: 0 fresh lookups"
            now = t0 + 29.0
            await _many_reject(1, port, ip, "evil.example")
            assert stub_lan_os_interfaces["query_calls"] == startup, (
                "within 30s: 0 fresh lookups after startup"
            )

    asyncio.run(run())


def test_thousand_accepted_requests_one_os_lookup_at_startup(
    stub_lan_os_interfaces: LanOsStubState,
) -> None:
    async def run() -> None:
        async with make_app_server(
            bind="0.0.0.0",
            insecure_lan=True,
            listen_port=18451,
        ) as (ip, port, _runner):
            assert stub_lan_os_interfaces["query_calls"] == 1
            await _many_ok(1000, port, ip, LAN_STUB_IFACE_IP)

    asyncio.run(run())
    assert stub_lan_os_interfaces["query_calls"] == 1


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
            listen_port=18450,
            clock=clock,
        ) as (ip, port, _runner):
            startup = stub_lan_os_interfaces["query_calls"]
            assert startup >= 1
            await _many_reject(1, port, ip, "evil.example")
            assert stub_lan_os_interfaces["query_calls"] == startup
            now = t0 + 31.0
            await _many_reject(1, port, ip, "evil.example")
            assert stub_lan_os_interfaces["query_calls"] == startup + 1

    asyncio.run(run())


def test_dhcp_refresh_uses_asyncio_to_thread(stub_lan_os_interfaces: LanOsStubState) -> None:
    t0 = 1000.0
    now = t0
    to_thread_calls = 0
    real_to_thread = asyncio.to_thread

    async def tracking_to_thread(func, *args, **kwargs):  # noqa: ANN001
        nonlocal to_thread_calls
        to_thread_calls += 1
        return await real_to_thread(func, *args, **kwargs)

    def clock() -> float:
        return now

    async def run() -> None:
        nonlocal now
        original = asyncio.to_thread
        asyncio.to_thread = tracking_to_thread  # type: ignore[method-assign]
        try:
            async with make_app_server(
                bind="0.0.0.0",
                insecure_lan=True,
                listen_port=18452,
                clock=clock,
            ) as (ip, port, _runner):
                now = t0 + 31.0
                await _many_reject(1, port, ip, "evil.example")
                assert to_thread_calls == 1
        finally:
            asyncio.to_thread = original  # type: ignore[method-assign]

    asyncio.run(run())


async def _one_session(port: int, ip: str, host: str) -> int:
    async with ClientSession() as session:
        async with session.get(
            f"http://{ip}:{port}/api/session",
            headers={"Host": f"{host}:{port}"},
        ) as resp:
            return resp.status


def test_dhcp_refresh_single_flight_fifty_concurrent_lookups(
    stub_lan_os_interfaces: LanOsStubState,
) -> None:
    t0 = 1000.0
    now = t0
    gate = stub_lan_os_interfaces["gate"]
    assert gate is not None

    def clock() -> float:
        return now

    async def run() -> None:
        nonlocal now
        async with make_app_server(
            bind="0.0.0.0",
            insecure_lan=True,
            listen_port=18453,
            clock=clock,
        ) as (ip, port, _runner):
            startup = stub_lan_os_interfaces["query_calls"]
            assert startup == 1
            now = t0 + 31.0
            gate.clear()
            tasks = [
                asyncio.create_task(_one_session(port, ip, LAN_STUB_OTHER_IP))
                for _ in range(50)
            ]
            await asyncio.sleep(0.05)
            gate.set()
            statuses = await asyncio.gather(*tasks)
            assert all(s == 200 for s in statuses)
            assert stub_lan_os_interfaces["query_calls"] == startup + 1

    asyncio.run(run())


def test_dhcp_refresh_failure_keeps_last_good_set_and_retries(
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
            listen_port=18454,
            clock=clock,
        ) as (ip, port, _runner):
            startup = stub_lan_os_interfaces["query_calls"]
            assert startup == 1
            now = t0 + 31.0
            stub_lan_os_interfaces["fail_refresh"] = True
            tasks = [
                asyncio.create_task(_one_session(port, ip, "evil.example"))
                for _ in range(50)
            ]
            statuses = await asyncio.gather(*tasks)
            assert all(s == 400 for s in statuses)
            assert stub_lan_os_interfaces["query_calls"] == startup + 1
            ok = await _one_session(port, ip, LAN_STUB_IFACE_IP)
            assert ok == 200
            stub_lan_os_interfaces["fail_refresh"] = False
            now = t0 + 62.0
            assert await _one_session(port, ip, LAN_STUB_OTHER_IP) == 200
            assert stub_lan_os_interfaces["query_calls"] == startup + 2

    asyncio.run(run())
