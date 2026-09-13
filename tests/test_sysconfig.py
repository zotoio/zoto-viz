from __future__ import annotations

import json
from pathlib import Path

from service import paths, sysconfig


def _run_map(cmds: dict[tuple[str, ...], str]):
    def run(cmd: list[str]) -> str:
        return cmds.get(tuple(cmd), "")
    return run


def test_sys_config_file_name() -> None:
    assert paths.sys_config_file().name == "sys-config.yml"
    assert sysconfig.sys_config_file().name == "sys-config.yml"


def test_load_missing_and_junk(tmp_path: Path) -> None:
    missing = tmp_path / "nope.yml"
    assert sysconfig.load(missing) == {}
    junk = tmp_path / "bad.yml"
    junk.write_text("[]\n", encoding="utf-8")
    assert sysconfig.load(junk) == {}
    junk.write_text("{", encoding="utf-8")
    assert sysconfig.load(junk) == {}


def test_save_roundtrip_mode(tmp_path: Path) -> None:
    path = tmp_path / "sys-config.yml"
    cfg = {
        "root": "/opt/zoto-viz",
        "hostname": "laptop",
        "iface": "wlan0",
        "monitor_iface": "wlan1",
        "ssids": ["Home", "Guest", "Home"],
    }
    sysconfig.save(cfg, path)
    assert path.stat().st_mode & 0o777 == 0o600
    got = sysconfig.load(path)
    assert got["root"] == "/opt/zoto-viz"
    assert got["ssids"] == ["Home", "Guest"]
    assert "Do not commit" in path.read_text(encoding="utf-8")


def test_detect_prefers_usb_monitor_and_watch_file(tmp_path: Path, monkeypatch) -> None:
    cfg_dir = tmp_path / "cfg"
    cfg_dir.mkdir()
    (cfg_dir / "wifi-watch.json").write_text(
        json.dumps({"ssids": ["HomeNet", "Guest"]}), encoding="utf-8"
    )
    monkeypatch.setattr(paths, "config_dir", lambda: cfg_dir)
    run = _run_map({
        ("ip", "-j", "route", "show", "default"): '[{"dev": "wlan0"}]',
        ("nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device", "status"): (
            "wlan0:wifi:connected\nwlx00aabbccddee:wifi:disconnected\neth0:ethernet:connected\n"
        ),
        ("iw", "dev", "wlan0", "link"): "SSID: HomeNet\n",
    })
    got = sysconfig.detect(run=run)
    assert got["iface"] == "wlan0"
    assert got["monitor_iface"] == "wlx00aabbccddee"
    assert got["ssids"] == ["HomeNet", "Guest"]
    assert got["root"] == str(sysconfig.REPO)
    assert got["hostname"]


def test_detect_ethernet_default_falls_back_to_wifi(monkeypatch) -> None:
    monkeypatch.setattr(sysconfig, "_watch_ssids", lambda: [])
    monkeypatch.setattr(sysconfig, "_plan_ssids", lambda: [])
    run = _run_map({
        ("ip", "-j", "route", "show", "default"): '[{"dev": "eth0"}]',
        ("nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device", "status"): "wlp1s0:wifi:connected\n",
        ("iw", "dev"): "Interface wlp1s0\n",
        ("iw", "dev", "wlp1s0", "link"): "Connected to aa:bb\nSSID: Cafe\n",
    })
    got = sysconfig.detect(run=run)
    assert got["iface"] == "wlp1s0"
    assert got["ssids"] == ["Cafe"]
    assert got["monitor_iface"] == ""


def test_detect_iw_dev_and_plan_ssids(tmp_path: Path, monkeypatch) -> None:
    cfg_dir = tmp_path / "cfg"
    cfg_dir.mkdir()
    (cfg_dir / "wifi-hop.plan").write_text(
        "# freq width centre dwell ssids\n2412 20 2412 60 Home,Guest\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(paths, "config_dir", lambda: cfg_dir)
    run = _run_map({
        ("ip", "-j", "route", "show", "default"): "not-json",
        ("nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device", "status"): "",
        ("iw", "dev"): "phy#0\n\tInterface wlan0\nInterface wlan1\n",
        ("iw", "dev", "wlan0", "link"): "",
        ("iw", "dev", "wlan0", "info"): "ssid Cafe\n",
        ("nmcli", "-t", "-f", "IN-USE,SSID", "dev", "wifi"): "",
    })
    got = sysconfig.detect(run=run)
    assert got["iface"] == "wlan0"
    assert got["monitor_iface"] == "wlan1"
    assert got["ssids"][0] == "Cafe"
    assert "Home" in got["ssids"] and "Guest" in got["ssids"]


def test_nmcli_star_ssid(monkeypatch) -> None:
    monkeypatch.setattr(sysconfig, "_watch_ssids", lambda: [])
    monkeypatch.setattr(sysconfig, "_plan_ssids", lambda: [])
    run = _run_map({
        ("ip", "-j", "route", "show", "default"): "[]",
        ("nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device", "status"): "wlan0:wifi:connected\nwlan0:wifi:connected\neth0\n",
        ("iw", "dev", "wlan0", "link"): "",
        ("iw", "dev", "wlan0", "info"): "",
        ("nmcli", "-t", "-f", "IN-USE,SSID", "dev", "wifi"): "* :Cafe\n",
    })
    got = sysconfig.detect(run=run)
    assert got["ssids"] == ["Cafe"]


def test_ensure_keeps_existing(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(paths, "config_dir", lambda: tmp_path / "cfg")
    (tmp_path / "cfg").mkdir()
    path = tmp_path / "sys-config.yml"
    sysconfig.save(
        {"root": "/keep", "hostname": "old", "iface": "wlan0", "monitor_iface": "wlan1", "ssids": ["Home"]},
        path,
    )
    cfg = sysconfig.ensure(
        path,
        run=_run_map({
            ("ip", "-j", "route", "show", "default"): '[{"dev": "wlan1"}]',
            ("nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device", "status"): "wlan1:wifi:connected\n",
            ("iw", "dev", "wlan0", "link"): "SSID: Other\n",
        }),
    )
    assert cfg["root"] == "/keep"
    assert cfg["iface"] == "wlan0"
    assert cfg["ssids"] == ["Home"]
    assert cfg["monitor_iface"] == "wlan1"
    assert cfg["hostname"] == "old"


def test_ensure_fills_blank_file(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(paths, "config_dir", lambda: tmp_path / "cfg")
    (tmp_path / "cfg").mkdir()
    path = tmp_path / "sys-config.yml"
    cfg = sysconfig.ensure(
        path,
        run=_run_map({
            ("ip", "-j", "route", "show", "default"): '[{"dev": "wlan0"}]',
            ("nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device", "status"): "wlan0:wifi:connected\nwlan1:wifi:disconnected\n",
            ("iw", "dev", "wlan0", "link"): "SSID: Home\n",
        }),
    )
    assert path.is_file()
    assert cfg["iface"] == "wlan0"
    assert cfg["monitor_iface"] == "wlan1"
    assert cfg["ssids"] == ["Home"]


def test_apply_watch_default(tmp_path: Path) -> None:
    yml = tmp_path / "air-ssid.yml"
    yml.write_text(
        "id: air-ssid\n"
        "config:\n"
        "  - key: gateway\n"
        "    default: ours\n"
        "  - key: watch\n"
        "    label: watch SSIDs\n"
        "    default: Home\n"
        "  - key: other\n"
        "    default: false\n",
        encoding="utf-8",
    )
    assert sysconfig.apply_watch_default(yml, ["HomeNet", "Guest"])
    text = yml.read_text(encoding="utf-8")
    assert "    default: HomeNet, Guest\n" in text
    assert "    default: ours\n" in text
    assert "    default: false\n" in text
    assert not sysconfig.apply_watch_default(yml, ["HomeNet", "Guest"])
    assert not sysconfig.apply_watch_default(yml, [])
    assert not sysconfig.apply_watch_default(tmp_path / "missing.yml", ["Home"])
    bare = tmp_path / "bare.yml"
    bare.write_text("config:\n  - key: watch\n    label: watch SSIDs\n  - key: other\n    default: false\n", encoding="utf-8")
    assert not sysconfig.apply_watch_default(bare, ["Home"])


def test_write_systemd_override(tmp_path: Path) -> None:
    drop = tmp_path / "override.conf"
    assert sysconfig.write_systemd_override({"root": ""}, drop) is None
    got = sysconfig.write_systemd_override({"root": "/opt/zoto-viz"}, drop)
    assert got == drop
    text = drop.read_text(encoding="utf-8")
    assert "ZOTO_VIZ_ROOT=/opt/zoto-viz" in text
    assert "do not copy" in text


def test_watch_file_not_dict_and_short_plan(tmp_path: Path, monkeypatch) -> None:
    cfg_dir = tmp_path / "cfg"
    cfg_dir.mkdir()
    (cfg_dir / "wifi-watch.json").write_text("[]", encoding="utf-8")
    (cfg_dir / "wifi-hop.plan").write_text("2412 20 2412 60\n", encoding="utf-8")
    monkeypatch.setattr(paths, "config_dir", lambda: cfg_dir)
    assert sysconfig._watch_ssids() == []
    assert sysconfig._plan_ssids() == []
    assert sysconfig._present(True) is True
    assert sysconfig._ssids(None) == []
    cfg = sysconfig.merge({}, {"ssids": "A, B", "root": "/x", "hostname": "h", "iface": "wlan0", "monitor_iface": ""})
    assert cfg["ssids"] == ["A", "B"]
    lines = sysconfig.describe(cfg)
    assert "A, B" in lines[-1]
    empty = sysconfig.describe({"ssids": []})
    assert "(none yet)" in empty[-1]


def test_write_systemd_skips_without_unit(tmp_path: Path, monkeypatch) -> None:
    drop = tmp_path / "zoto-viz-monitor.service.d" / "override.conf"
    monkeypatch.setattr(sysconfig, "systemd_dropin", lambda: drop)
    assert sysconfig.write_systemd_override({"root": "/opt/zoto-viz"}) is None
    assert not drop.exists()


def test_run_nonzero_and_oserror(monkeypatch) -> None:
    import subprocess as sp

    class Proc:
        returncode = 1
        stdout = "nope"

    monkeypatch.setattr(sysconfig.subprocess, "run", lambda *a, **k: Proc())
    assert sysconfig._run(["false"]) == ""

    def boom(*_a, **_k):
        raise OSError("missing")

    monkeypatch.setattr(sysconfig.subprocess, "run", boom)
    assert sysconfig._run(["ip"]) == ""

    def expire(*_a, **_k):
        raise sp.TimeoutExpired(cmd="ip", timeout=1)

    monkeypatch.setattr(sysconfig.subprocess, "run", expire)
    assert sysconfig._run(["ip"]) == ""


def test_load_watch_seeds_from_sysconfig(tmp_path: Path, monkeypatch) -> None:
    from service import rf

    sysf = tmp_path / "sys-config.yml"
    sysconfig.save(
        {"root": "/x", "hostname": "h", "iface": "wlan0", "monitor_iface": "", "ssids": ["HomeNet"]},
        sysf,
    )
    monkeypatch.setattr(sysconfig, "sys_config_file", lambda: sysf)
    watch = tmp_path / "wifi-watch.json"
    radio = rf.Radio()
    radio.load_watch(watch)
    assert radio.watch["ssids"] == ["HomeNet"]
    assert json.loads(watch.read_text(encoding="utf-8"))["ssids"] == ["HomeNet"]


def test_default_iface_skips_non_dict() -> None:
    assert sysconfig._default_iface(_run_map({("ip", "-j", "route", "show", "default"): '["x"]'})) == ""
    assert sysconfig._associated_ssid(
        _run_map({("nmcli", "-t", "-f", "IN-USE,SSID", "dev", "wifi"): "*:Cafe\\:WiFi\n"}),
        "",
    ) == "Cafe:WiFi"
