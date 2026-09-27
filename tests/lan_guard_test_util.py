"""Shared LAN request-guard test fixtures (stub OS interfaces only)."""
from __future__ import annotations

import threading
from typing import NotRequired, TypedDict

import pytest

from service import request_guard

LAN_STUB_IFACE_IP = "172.30.0.2"
LAN_STUB_OTHER_IP = "10.99.99.99"


class LanOsStubState(TypedDict):
    query_calls: int
    gate: NotRequired[threading.Event]
    refresh_started: NotRequired[threading.Event]
    baseline_queries: NotRequired[int]
    fail_refresh: NotRequired[bool]
    extra_ip: NotRequired[str]
    second_query_extra_other: NotRequired[bool]


@pytest.fixture
def stub_lan_os_interfaces(monkeypatch: pytest.MonkeyPatch) -> LanOsStubState:
    gate = threading.Event()
    gate.set()
    state: LanOsStubState = {"query_calls": 0, "gate": gate}

    def fake_query() -> list[str]:
        state["query_calls"] += 1
        if state.get("fail_refresh") and state.get("baseline_queries") is not None:
            if state["query_calls"] > state["baseline_queries"]:
                raise OSError("stubbed OS lookup failure")
        baseline = state.get("baseline_queries")
        if baseline is not None and state["query_calls"] > baseline:
            started = state.get("refresh_started")
            if started is not None:
                started.set()
        g = state.get("gate")
        if g is not None:
            g.wait(timeout=30.0)
        addrs = [LAN_STUB_IFACE_IP, "10.0.0.5", "127.0.0.1"]
        if (
            baseline is not None
            and state["query_calls"] > baseline
            and state.get("second_query_extra_other")
        ):
            addrs.append(LAN_STUB_OTHER_IP)
        extra = state.get("extra_ip")
        if extra:
            addrs.append(extra)
        return addrs

    monkeypatch.setattr(request_guard, "query_os_interface_addresses", fake_query)
    return state
