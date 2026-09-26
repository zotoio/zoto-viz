"""Shared LAN request-guard test fixtures (stub OS interfaces only)."""
from __future__ import annotations

import pytest

from service import request_guard

LAN_STUB_IFACE_IP = "172.30.0.2"
LAN_STUB_OTHER_IP = "10.99.99.99"


@pytest.fixture
def stub_lan_os_interfaces(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        request_guard,
        "query_os_interface_addresses",
        lambda: [LAN_STUB_IFACE_IP, "10.0.0.5", "127.0.0.1"],
    )
    request_guard.reset_interface_lookup_counter()
