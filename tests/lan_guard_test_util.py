"""Shared LAN request-guard test fixtures (stub OS interfaces only)."""
from __future__ import annotations

from typing import TypedDict

import pytest

from service import request_guard

LAN_STUB_IFACE_IP = "172.30.0.2"
LAN_STUB_OTHER_IP = "10.99.99.99"


class LanOsStubState(TypedDict):
    query_calls: int


@pytest.fixture
def stub_lan_os_interfaces(monkeypatch: pytest.MonkeyPatch) -> LanOsStubState:
    state: LanOsStubState = {"query_calls": 0}

    def fake_query() -> list[str]:
        state["query_calls"] += 1
        return [LAN_STUB_IFACE_IP, "10.0.0.5", "127.0.0.1"]

    monkeypatch.setattr(request_guard, "query_os_interface_addresses", fake_query)
    return state
