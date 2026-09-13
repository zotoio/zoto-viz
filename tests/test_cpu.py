from __future__ import annotations

import os
from pathlib import Path

from service import cpu


def test_ints_stops_on_junk() -> None:
    assert cpu._ints("cpu  10 20 30 40 50") == [10, 20, 30, 40, 50]
    assert cpu._ints("cpu  1 2 x") == [1, 2]


def test_parse_pid_stat_self() -> None:
    raw = Path("/proc/self/stat").read_text()
    parsed = cpu._parse_pid_stat(raw)
    assert parsed is not None
    assert parsed[0] == os.getpid()
    assert cpu._parse_pid_stat("not-a-stat") is None
    assert cpu._parse_pid_stat("1 (x") is None


def test_read_stat_and_loadavg() -> None:
    agg, cores = cpu.read_stat()
    assert agg[1] >= 1
    assert cores
    assert isinstance(cpu.read_loadavg(), str)


def test_kernel_and_flow() -> None:
    assert cpu._kernel(1) in (True, False)
    flow = cpu._flow("cpu:1", "cpu:0", 12.5, 2.0, 1.0)
    assert flow["a"] == "cpu:0"
    assert flow["b"] == "cpu:1"
    assert flow["rate"] == 12.5


def test_sampler_two_snapshots() -> None:
    s = cpu.Sampler()
    first = s.snapshot(1.0)
    second = s.snapshot(2.0)
    assert first["hub"] == "cpu:host"
    ips = {d["ip"] for d in second["devices"]}
    assert "cpu:host" in ips
    assert any(ip.startswith("cpu:") for ip in ips)
    assert second["flows"]
