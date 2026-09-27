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
    allowed = build_allowed_hosts("127.0.0.1", PORT)
    assert "192.168.1.5:7020" not in allowed, (
        "127.0.0.1 bind must not allow LAN key 192.168.1.5:7020"
    )
    assert sorted(allowed) == THREE_LOOPBACK


def test_build_allowed_hosts_bind_ipv6_loopback_is_exactly_three_loopback_keys() -> None:
    allowed = build_allowed_hosts("::1", PORT)
    assert "192.168.1.5:7020" not in allowed, (
        "::1 bind must not allow LAN key 192.168.1.5:7020"
    )
    assert sorted(allowed) == THREE_LOOPBACK


def test_build_allowed_hosts_bind_127_0_0_2_includes_that_loopback_key() -> None:
    allowed = build_allowed_hosts("127.0.0.2", PORT)
    assert "127.0.0.2:7020" in allowed, "127.0.0.2 bind must allow Host key 127.0.0.2:7020"
    assert "192.168.1.5:7020" not in allowed, (
        "127.0.0.2 bind must not allow LAN key 192.168.1.5:7020"
    )
    assert sorted(allowed) == sorted(THREE_LOOPBACK + ["127.0.0.2:7020"])


def test_build_allowed_hosts_bind_wildcard_includes_stub_lan_interface_keys() -> None:
    allowed = build_allowed_hosts("0.0.0.0", PORT)
    assert "192.168.1.5:7020" in allowed, (
        "0.0.0.0 wildcard bind must allow LAN key 192.168.1.5:7020"
    )
    assert sorted(allowed) == WILDCARD_STUB_LAN


def test_build_allowed_hosts_bind_ipv6_unspecified_wildcard_includes_stub_lan() -> None:
    allowed = build_allowed_hosts("::", PORT)
    assert "192.168.1.5:7020" in allowed, (
        ":: wildcard bind must allow LAN key 192.168.1.5:7020"
    )
    assert sorted(allowed) == WILDCARD_STUB_LAN


def test_build_allowed_hosts_wildcard_brackets_global_ipv6_and_accepts_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stub = ["127.0.0.1", "192.168.1.5", "172.17.0.1", "2001:db8::5", "fe80::1"]
    monkeypatch.setattr(request_guard, "query_os_interface_addresses", lambda: list(stub))

    async def run_http() -> None:
        async with make_app_server(bind="::", insecure_lan=True) as (_ip, port, _runner):
            async with ClientSession() as session:
                async with session.get(
                    f"http://127.0.0.1:{port}/api/session",
                    headers={"Host": f"[2001:db8::5]:{port}"},
                ) as resp:
                    assert resp.status == 200, (
                        "wildcard bind must accept bracketed global IPv6 Host with HTTP 200"
                    )

    asyncio.run(run_http())

    allowed = build_allowed_hosts("::", PORT)
    assert "[2001:db8::5]:7020" in allowed
    assert "2001:db8::5:7020" not in allowed
    assert "fe80::1:7020" not in allowed
    assert "[fe80::1]:7020" not in allowed


def test_build_allowed_hosts_bind_specific_lan_includes_only_that_address() -> None:
    allowed = build_allowed_hosts("192.168.1.5", PORT)
    assert "192.168.1.5:7020" in allowed
    assert "172.17.0.1:7020" not in allowed, (
        "192.168.1.5 bind must not allow other LAN key 172.17.0.1:7020"
    )
    assert sorted(allowed) == sorted(THREE_LOOPBACK + ["192.168.1.5:7020"])
