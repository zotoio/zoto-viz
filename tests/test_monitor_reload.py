from __future__ import annotations

from pathlib import Path

from service import monitor_reload as mr


def test_is_monitor_cmd_does_not_match_reload_module() -> None:
    assert mr.is_monitor_cmd("python -m service.monitor --bind 127.0.0.1")
    assert mr.is_monitor_cmd("/home/a/.venv/bin/python -m service.monitor --port 7020")
    assert mr.is_monitor_cmd("python3 service/monitor.py")
    assert not mr.is_monitor_cmd("python -m service.monitor_reload --hook")
    assert not mr.is_monitor_cmd("vitest run")


def test_is_stale_any_old_process() -> None:
    assert mr.is_stale(100.0, [50.0])
    assert not mr.is_stale(100.0, [150.0])
    assert mr.is_stale(100.0, [150.0, 40.0])
    assert not mr.is_stale(100.0, [])
    assert not mr.is_stale(0.0, [50.0])


def test_newest_backend_mtime(tmp_path: Path) -> None:
    (tmp_path / "service").mkdir()
    py = tmp_path / "service" / "live.py"
    py.write_text("x = 1\n", encoding="utf-8")
    cache = tmp_path / "service" / "__pycache__" / "live.cpython-312.pyc"
    cache.parent.mkdir()
    cache.write_bytes(b"nope")
    m = mr.newest_backend_mtime(tmp_path)
    assert m == py.stat().st_mtime
    root = tmp_path / "zoto-viz"
    root.write_text("print(1)\n", encoding="utf-8")
    assert mr.newest_backend_mtime(tmp_path) == root.stat().st_mtime


def test_hook_envelope_silent_when_fresh() -> None:
    assert mr.hook_envelope({"action": "noop", "reason": "fresh"}) == {}
    assert mr.hook_envelope({"action": "skipped"}) == {}
    msg = mr.hook_envelope({"action": "systemd", "ok": True, "ready": True})
    assert "Restarted" in msg["additional_context"]
    assert "systemd" in msg["additional_context"]
    fail = mr.hook_envelope({"action": "dev.sh", "ok": False, "error": "boom"})
    assert "failed" in fail["additional_context"]


def test_restart_skipped_by_env(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv(mr.SKIP_ENV, "1")
    monkeypatch.setattr(mr, "iter_monitor_pids", lambda exclude=None: [1])
    monkeypatch.setattr(mr, "proc_start", lambda pid: 1.0)
    monkeypatch.setattr(mr, "newest_backend_mtime", lambda root: 99.0)
    monkeypatch.setattr(mr, "systemd_active", lambda unit=mr.UNIT: False)
    info = mr.restart(tmp_path)
    assert info["action"] == "skipped"


def test_restart_uses_systemd_when_stale(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv(mr.SKIP_ENV, raising=False)
    monkeypatch.setattr(mr, "iter_monitor_pids", lambda exclude=None: [9])
    monkeypatch.setattr(mr, "proc_start", lambda pid: 1.0)
    monkeypatch.setattr(mr, "newest_backend_mtime", lambda root: 99.0)
    monkeypatch.setattr(mr, "systemd_active", lambda unit=mr.UNIT: True)
    monkeypatch.setattr(mr, "wait_port", lambda port, timeout=12.0: True)
    calls: list[list[str]] = []

    def fake_run(cmd, **kwargs):
        calls.append(list(cmd))
        class R:
            returncode = 0
            stderr = ""
            stdout = ""
        return R()

    monkeypatch.setattr(mr.subprocess, "run", fake_run)
    info = mr.restart(tmp_path)
    assert info["action"] == "systemd"
    assert info["ok"] is True
    assert calls[0][:3] == ["systemctl", "--user", "restart"]
