"""``build_allowed_hosts`` bind matrix: loopback, ``::1``, wildcard, specific LAN (stubbed OS)."""
from __future__ import annotations

import pytest

from service import request_guard
from service.request_guard import build_allowed_hosts

STUB_IFACE_ADDRS = ["127.0.0.1", "192.168.1.5", "172.17.0.1"]
PORT = 7020
THREE_LOOPBACK = sorted(["127.0.0.1:7020", "[::1]:7020", "localhost:7020"])


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
    assert allowed == sorted(
        THREE_LOOPBACK + ["192.168.1.5:7020", "172.17.0.1:7020"],
    )


def test_build_allowed_hosts_bind_specific_lan_includes_only_that_address() -> None:
    allowed = sorted(build_allowed_hosts("192.168.1.5", PORT))
    assert allowed == sorted(THREE_LOOPBACK + ["192.168.1.5:7020"])
    assert "172.17.0.1:7020" not in allowed
