from __future__ import annotations

import pytest

from service import live
from service import paths


@pytest.fixture(autouse=True)
def _isolate_temper(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "agent_dir", lambda: tmp_path / "agent")
    (tmp_path / "agent").mkdir()
    live.reset_for_tests()


def test_temperature_curve_and_prefix() -> None:
    assert live.ollama_temperature(0) == 0.1
    assert live.ollama_temperature(22) == 0.4
    assert live.ollama_temperature(100) == 1.45
    assert live.sky_temperature(22) == 0.85
    assert live.sky_temperature(100) == 1.65
    assert live.temper_band(0) == "hush"
    assert live.temper_band(22) == "hush"
    assert live.temper_band(36) == "even"
    assert live.temper_band(88) == "feral"
    live.set_temper(36)
    assert "clearly different" in live.prefix()
    assert "physics" in live.prefix()
    live.set_temper(62)
    assert "physics" in live.prefix()
    live.set_temper(88)
    assert "unhinged" in live.prefix()
    assert "physics" in live.prefix()
    live.set_temper(8)
    assert "terse" in live.prefix()


def test_weather_and_patch_seq() -> None:
    live.set_weather("storm")
    snap = live.snapshot()
    assert snap["weather"] == "storm"
    assert snap["p"] == 0.94
    assert snap["seq"] == 0
    live.queue_patch({"theme": "ember", "temper": 70})
    nxt = live.snapshot()
    assert nxt["seq"] == 1
    assert nxt["patch"]["theme"] == "ember"
    assert nxt["temper"] == 70
    assert nxt["band"] == "keen"


def test_sanitize_drops_junk() -> None:
    p = live.sanitize_patch({
        "theme": "matrix",
        "mode": "plugin:command",
        "exec": "rm -rf",
        "temper": 9_001,
        "weather": "nope",
        "show": {"lan": False, "bogus": True},
        "plugins": {"command": {"prompt": "harbour", "cities": "lan"}},
    })
    assert p["theme"] == "matrix"
    assert p["mode"] == "plugin:command"
    assert p["temper"] == 100
    assert p["weather"] == "drift"
    assert p["show"] == {"lan": False}
    assert p["plugins"]["command"]["prompt"] == "harbour"
    assert "exec" not in p
