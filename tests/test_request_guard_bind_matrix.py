"""``build_allowed_hosts`` bind matrix: loopback, ``::1``, wildcard, specific LAN (stubbed OS)."""
from __future__ import annotations

import asyncio

import pytest
from aiohttp import ClientSession

from service import request_guard
from service.request_guard import build_allowed_hosts
from tests.monitor_app_test_util import make_app_server

STUB_IFACE_ADDRS = ["127.0.0.1", "192.168.1.5", "172.17.0.1"]
PORT = 7020
THREE_LOOPBACK = sorted(["127.0.0.1:7020", "[::1]:7020", "localhost:7020"])
WILDCARD_STUB_LAN = sorted(THREE_LOOPBACK + ["192.168.1.5:7020", "172.17.0.1:7020"])


@pytest.fixture(autouse=True)
def _stub_os_ifaces(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        request_guard,
        "query_os_interface_addresses",
        lambda: list(STUB_IFACE_ADDRS),
    )


def test_build_allowed_hosts_bind_127_0_0_1_is_exactly_three_loopback_keys() -> None:
    assert sorted(build_allowed_hosts("127.0.0.1", PORT)) == THREE_LOOPBACK


def test_build_allowed_hosts_bind_ipv6_loopback_is_exactly_three_loopback_keys() -> None:
    assert sorted(build_allowed_hosts("::1", PORT)) == THREE_LOOPBACK


def test_build_allowed_hosts_bind_127_0_0_2_is_exactly_three_loopback_keys() -> None:
    assert sorted(build_allowed_hosts("127.0.0.2", PORT)) == THREE_LOOPBACK


def test_build_allowed_hosts_bind_wildcard_includes_stub_lan_interface_keys() -> None:
    allowed = sorted(build_allowed_hosts("0.0.0.0", PORT))
    assert allowed == WILDCARD_STUB_LAN


def test_build_allowed_hosts_bind_ipv6_unspecified_wildcard_includes_stub_lan() -> None:
    assert sorted(build_allowed_hosts("::", PORT)) == WILDCARD_STUB_LAN


def test_build_allowed_hosts_wildcard_brackets_global_ipv6_and_accepts_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub = ["127.0.0.1", "192.168.1.5", "172.17.0.1", "2001:db8::5", "fe80::1"]
    monkeypatch.setattr(request_guard, "query_os_interface_addresses", lambda: list(stub))
    allowed = build_allowed_hosts("::", PORT)
    assert "[2001:db8::5]:7020" in allowed
    assert "2001:db8::5:7020" not in allowed
    assert "fe80::1:7020" not in allowed
    assert "[fe80::1]:7020" not in allowed

    async def run() -> None:
        async with make_app_server(bind="::", insecure_lan=True) as (_ip, port, _runner):
            async with ClientSession() as session:
                async with session.get(
                    f"http://127.0.0.1:{port}/api/session",
                    headers={"Host": f"[2001:db8::5]:{port}"},
                ) as resp:
                    assert resp.status == 200

    asyncio.run(run())


def test_build_allowed_hosts_bind_specific_lan_includes_only_that_address() -> None:
    allowed = sorted(build_allowed_hosts("192.168.1.5", PORT))
    assert allowed == sorted(THREE_LOOPBACK + ["192.168.1.5:7020"])
    assert "172.17.0.1:7020" not in allowed
