"""LAN allowlist OS lookup cost and 30s DHCP refresh throttle (stub ``query_os_interface_addresses``)."""
from __future__ import annotations

import asyncio
import json
import threading

import pytest
from aiohttp import ClientSession, web

from service import request_guard

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


def test_wildcard_bind_performs_startup_os_interface_lookup(
    stub_lan_os_interfaces: LanOsStubState,
) -> None:
    async def run() -> None:
        async with make_app_server(
            bind="0.0.0.0",
            insecure_lan=True,
            listen_port=0,
        ) as (_ip, port, _runner):
            assert port > 0
            assert stub_lan_os_interfaces["query_calls"] >= 1, (
                "configure: at least one startup lookup"
            )

    asyncio.run(run())


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
            listen_port=0,
            clock=clock,
        ) as (ip, port, _runner):
            startup = stub_lan_os_interfaces["query_calls"]
            stub_lan_os_interfaces["baseline_queries"] = startup
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
    startup = 0

    async def run() -> None:
        nonlocal startup
        async with make_app_server(
            bind="0.0.0.0",
            insecure_lan=True,
            listen_port=0,
        ) as (ip, port, _runner):
            startup = stub_lan_os_interfaces["query_calls"]
            assert startup >= 1
            await _many_ok(1000, port, ip, LAN_STUB_IFACE_IP)

    asyncio.run(run())
    assert stub_lan_os_interfaces["query_calls"] == startup


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
            listen_port=0,
            clock=clock,
        ) as (ip, port, _runner):
            startup = stub_lan_os_interfaces["query_calls"]
            assert startup >= 1
            stub_lan_os_interfaces["baseline_queries"] = startup
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
                listen_port=0,
                clock=clock,
            ) as (ip, port, _runner):
                stub_lan_os_interfaces["baseline_queries"] = stub_lan_os_interfaces[
                    "query_calls"
                ]
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


def test_configure_request_guard_stamps_last_lookup_and_refresh_lock(
    stub_lan_os_interfaces: LanOsStubState,
) -> None:
    t0 = 1000.0
    app = web.Application()
    app["request_guard_clock"] = lambda: t0
    request_guard.configure_request_guard(app, bind="0.0.0.0", port=7020)
    assert app.get("request_guard_last_if_lookup") == t0
    assert app.get("request_guard_refresh_lock") is not None
    assert stub_lan_os_interfaces["query_calls"] == 1
    allowed = app.get("request_guard_allowed_hosts") or frozenset()
    assert f"{LAN_STUB_IFACE_IP}:7020" in allowed


def test_dhcp_refresh_single_flight_fifty_concurrent_lookups(
    stub_lan_os_interfaces: LanOsStubState,
) -> None:
    t0 = 1000.0
    now = t0
    gate = stub_lan_os_interfaces["gate"]
    assert gate is not None
    stub_lan_os_interfaces["second_query_extra_other"] = True
    refresh_started = threading.Event()
    stub_lan_os_interfaces["refresh_started"] = refresh_started

    def clock() -> float:
        return now

    async def run() -> None:
        nonlocal now
        async with make_app_server(
            bind="0.0.0.0",
            insecure_lan=True,
            listen_port=0,
            clock=clock,
        ) as (ip, port, _runner):
            startup = stub_lan_os_interfaces["query_calls"]
            assert startup >= 1
            stub_lan_os_interfaces["baseline_queries"] = startup
            now = t0 + 31.0
            gate.clear()
            tasks = [
                asyncio.create_task(_one_session(port, ip, LAN_STUB_OTHER_IP))
                for _ in range(50)
            ]
            await asyncio.to_thread(refresh_started.wait, 30.0)
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
    stub_lan_os_interfaces["second_query_extra_other"] = True

    def clock() -> float:
        return now

    async def run() -> None:
        nonlocal now
        async with make_app_server(
            bind="0.0.0.0",
            insecure_lan=True,
            listen_port=0,
            clock=clock,
        ) as (ip, port, _runner):
            startup = stub_lan_os_interfaces["query_calls"]
            assert startup >= 1
            stub_lan_os_interfaces["baseline_queries"] = startup
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
            other_status = await _one_session(port, ip, LAN_STUB_OTHER_IP)
            assert stub_lan_os_interfaces["query_calls"] == startup + 2
            assert other_status == 200

    asyncio.run(run())


def test_refresh_task_slot_cleared_after_shared_refresh(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    canned = json.dumps([{"addr_info": [{"family": "inet", "local": "10.0.0.5"}]}])

    def fake_run(*_a, **_kw):  # noqa: ANN002
        from unittest.mock import MagicMock

        return MagicMock(returncode=0, stdout=canned)

    monkeypatch.setattr(request_guard.subprocess, "run", fake_run)

    async def run() -> None:
        app = web.Application()
        app["request_guard_clock"] = lambda: 1000.0
        request_guard.configure_request_guard(app, bind="0.0.0.0", port=7020)
        app["request_guard_last_if_lookup"] = 0.0
        await request_guard._await_shared_refresh(app)
        cleared = app.get("request_guard_refresh_task") is None
        assert cleared, "request_guard_refresh_task slot not cleared after shared refresh"

    asyncio.run(run())
