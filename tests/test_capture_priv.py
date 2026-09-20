from __future__ import annotations

from service import monitor


def test_wrap_privileged_skips_sudo_without_cached_creds(monkeypatch) -> None:
    monkeypatch.setattr(monitor.os, "geteuid", lambda: 1000)
    monkeypatch.setattr(monitor.zotoviz, "group_active", lambda _name: False)
    monkeypatch.setattr(monitor.zotoviz, "sudo_n_ok", lambda: False)
    assert monitor.wrap_privileged(["tshark", "-i", "eth0"]) == ["tshark", "-i", "eth0"]


def test_wrap_privileged_uses_sudo_n_when_cached(monkeypatch) -> None:
    monkeypatch.setattr(monitor.os, "geteuid", lambda: 1000)
    monkeypatch.setattr(monitor.zotoviz, "group_active", lambda _name: False)
    monkeypatch.setattr(monitor.zotoviz, "group_member", lambda _name: True)
    monkeypatch.setattr(monitor.zotoviz, "sudo_n_ok", lambda: True)
    monkeypatch.setattr(monitor.shutil, "which", lambda name: f"/usr/bin/{name}" if name == "sudo" else None)
    cmd = monitor.wrap_privileged(["tshark"])
    assert cmd[:2] == ["/usr/bin/sudo", "-n"]
    assert cmd[-1] == "tshark"
