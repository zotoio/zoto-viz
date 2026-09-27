"""Monitor state fields that feed viz frame v2 (TCP gauges, packet rates, IPv6 fold)."""
from __future__ import annotations

import pytest

from service import monitor as mon


def _stub_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(mon, "list_interfaces", lambda only=None: {"eth0": ["10.0.0.0/24"]})
    monkeypatch.setattr(mon.zotoviz, "run", lambda *a, **k: "[]")
    monkeypatch.setattr(mon.rf, "read_bt_self", lambda: ("", ""))
    monkeypatch.setattr(mon.rf, "read_wifi_link", lambda iface: ("", "", 0))


def _state(monkeypatch: pytest.MonkeyPatch) -> mon.State:
    _stub_network(monkeypatch)
    return mon.State("eth0", "10.0.0.1", "10.0.0.0/24", "10.0.0.254")


def _tcp_row(
    t: float,
    src: str,
    dst: str,
    *,
    flags: str = "",
    sport: str = "40000",
    dport: str = "443",
    size: int = 120,
    eth_src: str = "aa:bb:cc:dd:ee:01",
    eth_dst: str = "aa:bb:cc:dd:ee:02",
) -> list[str]:
    row = [""] * 36
    row[0] = str(t)
    row[1] = str(size)
    row[2] = eth_src
    row[3] = eth_dst
    row[4] = src
    row[5] = dst
    row[8] = "6"
    row[9] = sport
    row[10] = dport
    row[17] = "TCP"
    row[18] = "eth0"
    row[35] = flags
    return row


def test_tcp_syn_and_reset_flag_parsing() -> None:
    assert mon._tcp_syn("0x02") is True
    assert mon._tcp_syn("0x12") is False  # SYN-ACK
    assert mon._tcp_syn("syn") is True
    assert mon._tcp_syn("syn, ack") is False
    assert mon._tcp_reset("0x04") is True
    assert mon._tcp_reset("rst") is True
    assert mon._tcp_reset("0x02") is False


def test_tcp_syn_and_rst_update_conn_and_fail_buckets(monkeypatch: pytest.MonkeyPatch) -> None:
    state = _state(monkeypatch)
    t = 1_000.0
    client, server = "10.0.0.2", "8.8.8.8"
    state.packet(_tcp_row(t, client, server, flags="0x02"))
    state.packet(_tcp_row(t + 0.1, client, server, flags="0x04"))
    sec = int(t)
    assert state._conn_attempt_buckets[client][sec] == 1
    assert state._conn_attempt_buckets[server][sec] == 1
    assert state._fail_buckets[client][sec] == 1
    assert server not in state._fail_buckets


def test_snapshot_conn_fail_ratio_from_buckets(monkeypatch: pytest.MonkeyPatch) -> None:
    state = _state(monkeypatch)
    t = 2_000.0
    client = "10.0.0.2"
    state.packet(_tcp_row(t, client, "1.1.1.1", flags="0x02"))
    state.packet(_tcp_row(t + 0.05, client, "1.1.1.1", flags="0x02"))
    state.packet(_tcp_row(t + 0.1, client, "1.1.1.1", flags="0x04"))
    snap = state.snapshot(t + 0.2)
    dev = next(d for d in snap["devices"] if d["ip"] == client)
    assert dev["conn_fail"] == pytest.approx(0.5)
    assert snap["host"]["vizFrame"] == {"links": True, "linksMax": 64}


def test_tick_computes_rate_pkt_per_direction(monkeypatch: pytest.MonkeyPatch) -> None:
    state = _state(monkeypatch)
    a, b = "10.0.0.10", "10.0.0.20"
    base = 3_000.0
    for i in range(4):
        state.packet(_tcp_row(base + i * 0.01, a, b, sport="5000", dport="443"))
    for i in range(2):
        state.packet(_tcp_row(base + 0.1 + i * 0.01, b, a, sport="443", dport="5000"))
    state.tick(base + 0.2)
    key = f"{a}|{b}"
    fl = state.flows[key]
    assert fl["rate_pkt_ab"] == pytest.approx(4 / mon.RATE_WINDOW_S)
    assert fl["rate_pkt_ba"] == pytest.approx(2 / mon.RATE_WINDOW_S)


def test_fold_v6_merges_devices_and_conn_buckets(monkeypatch: pytest.MonkeyPatch) -> None:
    state = _state(monkeypatch)
    mac = "aa:bb:cc:dd:ee:ff"
    v4 = "10.0.0.50"
    v6 = "fe80::a8bb:ccff:fedd:eeff"
    state.device(v4, mac)
    state.devices[v6] = {
        "ip": v6,
        "mac": mac,
        "vendor": "",
        "hostnames": [],
        "aliases": [],
        "sources": [],
        "ports": [],
        "ifaces": [],
        "first_seen": 0.0,
        "last_seen": 1.0,
        "bytes_in": 10,
        "bytes_out": 20,
        "packets": 3,
        "role": "lan",
    }
    state._conn_attempt_buckets[v6][100] = 4
    state._fail_buckets[v6][100] = 1
    state.fold_v6()
    assert v6 not in state.devices
    assert state.alias_to_ip[v6] == v4
    assert v6 in state.devices[v4]["aliases"]
    assert state._conn_attempt_buckets[v4][100] == 4
    assert state._fail_buckets[v4][100] == 1
    merged = state.devices[v4]
    assert merged["bytes_in"] == 10
    assert merged["bytes_out"] == 20
    assert merged["packets"] == 3
