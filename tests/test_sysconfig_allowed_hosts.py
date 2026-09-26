"""sys-config allowed_hosts parsing and main() listen wiring."""
from __future__ import annotations

from service import access, sysconfig
from service.request_guard import validate_allowed_host_entry


def test_allowed_hosts_config_parsing_and_validation() -> None:
    cfg = {
        "bind": "127.0.0.1",
        "port": 7020,
        "allowed_hosts": ["lan.example:8080", "192.168.1.1", "[::1]:7020"],
    }
    opts = sysconfig.listen_opts(cfg)
    assert opts["allowed_hosts"] == [
        validate_allowed_host_entry("lan.example:8080"),
        validate_allowed_host_entry("192.168.1.1"),
        validate_allowed_host_entry("[::1]:7020"),
    ]
    resolved = sysconfig.resolve_listen(cfg, bind="0.0.0.0", insecure_lan=True)
    assert resolved["bind"] == "0.0.0.0"
    assert resolved["allowed_hosts"] == opts["allowed_hosts"]
    assert resolved["insecure_lan"] is True


def test_invalid_allowed_hosts_entry_raises() -> None:
    try:
        validate_allowed_host_entry("bad;host")
    except ValueError as exc:
        assert "invalid allowed_hosts" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_main_passes_resolved_allowed_hosts_to_make_app(monkeypatch) -> None:
    captured: list[list[str]] = []

    from aiohttp import web

    def fake_make_app(*_a, allowed_hosts=None, **_kw):  # noqa: ANN001
        captured.append(list(allowed_hosts or []))
        return web.Application()

    class _Radio:
        watch = {"ssids": [], "other": False, "dwell": 1, "rotate": True}

    class _State:
        ifaces = {"lo": ["127.0.0.1"]}
        wlan = set()
        radio = _Radio()

        def load(self) -> None:
            return None

    monkeypatch.setattr(sysconfig, "ensure", lambda: {"allowed_hosts": ["extra.local:7020"]})
    monkeypatch.setattr("service.monitor.make_app", fake_make_app)
    run_app_calls: list[dict] = []

    def capture_run_app(_app, **kwargs):  # noqa: ANN001
        run_app_calls.append(dict(kwargs))
        raise SystemExit(0)

    monkeypatch.setattr("service.monitor.web.run_app", capture_run_app)
    monkeypatch.setattr("service.monitor.State", lambda *_a, **_k: _State())
    from service import monitor

    monkeypatch.setattr(
        monitor.zotoviz,
        "default_iface",
        lambda: ("lo", "127.0.0.1", "127.0.0.0/8", "127.0.0.1"),
    )
    monkeypatch.setattr("service.plugins.seed", lambda: None)
    monkeypatch.setattr("service.plugin_migration.migrate_home_plugins", lambda: {})
    monkeypatch.setattr(
        "service.idle.ScreensaverHold",
        lambda: type("H", (), {"start": lambda s: [], "stop": lambda s: None})(),
    )
    import sys

    monkeypatch.setattr(sys, "argv", ["monitor", "--bind", "127.0.0.1", "--port", "7020"])
    try:
        monitor.main()
    except SystemExit:
        pass
    assert captured == [["extra.local:7020"]]
    assert run_app_calls
    assert run_app_calls[0]["access_log"] is None
    assert run_app_calls[0]["shutdown_timeout"] == 3


def test_allowed_hosts_round_trips_through_dump_and_load(tmp_path) -> None:
    from pathlib import Path

    cfg = {
        "bind": "0.0.0.0",
        "port": 7020,
        "insecure_lan": True,
        "allowed_hosts": ["viz.example.lan"],
    }
    path = Path(tmp_path) / "sys-config.yml"
    path.write_text(sysconfig.dump(cfg), encoding="utf-8")
    roundtrip = sysconfig.load(path)
    assert roundtrip["allowed_hosts"] == ["viz.example.lan"]
