from __future__ import annotations

from service import sys as hostsys


def test_parse_tcp_hex_v4() -> None:
    assert hostsys.parse_tcp_hex("0100007F:0050") == ("127.0.0.1", 80)
    assert hostsys.parse_tcp_hex("not-hex") is None


def test_fmt_bytes() -> None:
    assert hostsys._fmt_bytes(512) == "512 B"
    assert "MB" in hostsys._fmt_bytes(5 * 1024 * 1024)


def test_read_meminfo_and_psi() -> None:
    info = hostsys.read_meminfo()
    assert info.get("MemTotal", 0) > 0
    psi = hostsys.read_psi("cpu")
    assert "some_avg10" in psi or not psi  # missing pressure is ok on odd kernels


def test_read_thermal_shape() -> None:
    t = hostsys.read_thermal()
    assert "pkg_c" in t and "rapl_w" in t and isinstance(t["zones"], list)


def test_sampler_views() -> None:
    s = hostsys.Sampler()
    first = s.views(1.0)
    second = s.views(2.0)
    assert set(first) == set(hostsys.SYS_VIEWS)
    for name, view in second.items():
        assert view["hub"]
        ips = {d["ip"] for d in view["devices"]}
        assert view["hub"] in ips
        assert view["self"] == view["hub"]
        assert isinstance(view["flows"], list), name


def test_bridge_merges_subsystems() -> None:
    s = hostsys.Sampler()
    view = s.views(2.0)["bridge"]
    ips = {d["ip"] for d in view["devices"]}
    assert view["hub"] == "bridge:host"
    assert "bridge:host" in ips
    assert "bridge:cpu" in ips
    assert "bridge:memory" in ips
    assert "thermal" in view
    assert any(f["protos"] == ["cpu"] or "cpu" in (f.get("protos") or []) for f in view["flows"])


def test_decorate_cpu_adds_thermal() -> None:
    s = hostsys.Sampler()
    view = {
        "hub": "cpu:host",
        "self": "cpu:host",
        "devices": [
            {"ip": "cpu:host", "aliases": ["8 cores"]},
            {"ip": "cpu:0", "aliases": []},
        ],
        "flows": [],
    }
    out = s.decorate_cpu(view)
    assert "thermal" in out
    assert "temp" in out["devices"][0] or out["thermal"]["pkg_c"] == 0
    assert out["devices"][1].get("temp") == out["thermal"].get("pkg_c")
