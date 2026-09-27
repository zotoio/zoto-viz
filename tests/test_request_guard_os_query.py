"""Unit tests for ``query_os_interface_addresses`` and ``local_interface_hosts`` filters."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from service import request_guard
from service.request_guard import build_allowed_hosts

_CANNED_ADDR_JSON = json.dumps(
    [
        {
            "addr_info": [
                {"family": "inet", "local": "10.0.0.5"},
                {"family": "inet6", "local": "fd00::5"},
                {"family": "inet6", "local": "fe80::1"},
                {"family": "inet", "local": "169.254.1.1"},
                {"family": "link", "local": "00:11:22:33:44:55"},
                {"family": "inet6"},
            ],
        },
    ],
)


def test_query_os_interface_addresses_parses_canned_ip_json(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run(*_a, **_kw):  # noqa: ANN002
        return MagicMock(returncode=0, stdout=_CANNED_ADDR_JSON)

    monkeypatch.setattr(request_guard.subprocess, "run", fake_run)
    addrs = request_guard.query_os_interface_addresses()
    assert len(addrs) == 4
    assert sorted(addrs) == sorted(["10.0.0.5", "fd00::5", "fe80::1", "169.254.1.1"])
    assert "00:11:22:33:44:55" not in addrs


def test_query_os_interface_addresses_nonzero_returncode_is_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_run(*_a, **_kw):  # noqa: ANN002
        return MagicMock(
            returncode=1,
            stdout='[{"addr_info":[{"family":"inet","local":"203.0.113.1"}]}]',
        )

    monkeypatch.setattr(request_guard.subprocess, "run", fake_run)
    assert request_guard.query_os_interface_addresses() == []


def test_query_os_interface_addresses_skips_addr_info_without_local(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = json.dumps(
        [
            {
                "addr_info": [
                    {"family": "inet", "local": "10.1.1.1"},
                    {"family": "inet6"},
                ],
            },
        ],
    )

    def fake_run(*_a, **_kw):  # noqa: ANN002
        return MagicMock(returncode=0, stdout=payload)

    monkeypatch.setattr(request_guard.subprocess, "run", fake_run)
    assert request_guard.query_os_interface_addresses() == ["10.1.1.1"]


def test_local_interface_hosts_filters_stubbed_os_addresses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        request_guard,
        "query_os_interface_addresses",
        lambda: [
            "0.0.0.0",
            "::",
            "fe80::1",
            "169.254.1.1",
            "127.0.0.2",
            "10.0.0.5",
            "10.0.0.5",
        ],
    )
    hosts = sorted(request_guard.local_interface_hosts(7020, include_os=True))
    assert [h for h in hosts if "169.254." in h] == []
    assert [h for h in hosts if "[fe80" in h] == []
    assert [h for h in hosts if h.startswith("0.0.0.0:")] == []
    assert hosts == sorted(
        ["localhost:7020", "127.0.0.1:7020", "[::1]:7020", "10.0.0.5:7020"],
    )


def test_build_allowed_hosts_loopback_bind_skips_os_lan_addresses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        request_guard,
        "query_os_interface_addresses",
        lambda: ["10.0.0.5", "203.0.113.1"],
    )
    allowed = build_allowed_hosts("127.0.0.1", 7020)
    assert sorted(allowed) == sorted(
        ["127.0.0.1:7020", "[::1]:7020", "localhost:7020"],
    )


def test_build_allowed_hosts_wildcard_bind_includes_os_lan_addresses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        request_guard,
        "query_os_interface_addresses",
        lambda: ["10.0.0.5", "203.0.113.1"],
    )
    allowed = build_allowed_hosts("0.0.0.0", 7020)
    assert "10.0.0.5:7020" in allowed
    assert "203.0.113.1:7020" in allowed
    assert "127.0.0.1:7020" in allowed
