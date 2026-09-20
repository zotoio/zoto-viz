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
    reload = live.sanitize_patch({"reloadPlugins": True, "exec": "nope"})
    assert reload["reloadPlugins"] is True
    assert "exec" not in reload
    assert live.sanitize_patch({"reloadPlugins": False}) == {}
    assert live.sanitize_patch({"reloadClient": True})["reloadClient"] is True
    assert live.sanitize_patch({"reloadClient": False}) == {}
    chat = live.sanitize_patch({"chat": {"on": True, "textSize": 18, "exec": "nope"}})
    assert chat["chat"] == {"on": True, "textSize": 18}
    assert p["temper"] == 100
    assert p["weather"] == "drift"
    assert p["show"] == {"lan": False}
    assert p["plugins"]["command"]["prompt"] == "harbour"
    assert "exec" not in p
    chat = live.sanitize_patch({"chat": {"on": True, "textSize": 14, "nope": 1}})["chat"]
    assert chat == {"on": True, "textSize": 14}
    migrated = live.sanitize_patch({"feed": {"source": "transcript", "on": True}})
    assert migrated["feed"]["source"] == "traffic"
    assert migrated["chat"]["on"] is True
    full = {f"k{i}": True for i in range(30)}
    full.update({"gravity": 1.5, "swirl": 0.4, "mosaic": "4", "hero": "left", "stringAmt": 0.8})
    anim = live.sanitize_patch({"anim": full})["anim"]
    assert live.sanitize_patch({"anim": {"backdrop": "earth"}})["anim"]["backdrop"] == "earth"
    assert live.sanitize_patch({"anim": {"backdrop": "amazon"}})["anim"]["backdrop"] == "amazon"
    assert live.sanitize_patch({"anim": {"backdrop": "fungi"}})["anim"]["backdrop"] == "fungi"
    assert anim["gravity"] == 1.5
    assert anim["mosaic"] == "4"
    assert anim["hero"] == "left"
    assert anim["stringAmt"] == 0.8
    wall = live.sanitize_patch({"anim": {
        "mosaic": "4",
        "mosaicMaxId": "plugin:talkers",
        "mosaicTiles": ["plugin:talkers", "plugin:topology", "plugin:talkers"],
        "mosaicSharedTheme": True,
        "mosaicUniqueSkies": True,
        "mosaicSkies": {"plugin:talkers": "fire", "plugin:topology": "ocean", "bad": "zzz"},
        "graphFabric": "crystals",
        "graphSpace": "space",
        "mosaicTree": {
            "type": "split", "dir": "h", "ratio": 0.9,
            "a": {"type": "leaf", "id": "plugin:talkers"},
            "b": {"type": "leaf", "id": "plugin:topology"},
        },
    }})["anim"]
    assert wall["mosaicMaxId"] == "plugin:talkers"
    assert wall["mosaicTiles"] == ["plugin:talkers", "plugin:topology"]
    assert wall["mosaicSharedTheme"] is True
    assert wall["mosaicUniqueSkies"] is True
    assert wall["mosaicSkies"] == {"plugin:talkers": "fire", "plugin:topology": "ocean"}
    assert wall["graphFabric"] == "crystals"
    assert wall["graphSpace"] == "space"
    assert wall["mosaicTree"]["ratio"] == 0.88
    devices = live.sanitize_patch({"camera": "auto", "mic": "off", "theme": "ember"})
    assert devices["theme"] == "ember"
    assert "camera" not in devices
    assert "mic" not in devices
    look = live.sanitize_patch({"agent": {"shader": "vec3 color(vec3 d, float t) { return uAccent; }", "clear": False}, "shuffle": True})
    assert look["shuffle"] is True
    assert "color" in look["agent"]["shader"]
    dice = live.sanitize_patch({"dice": {"on": True, "periodMin": 12, "include": {"theme": False, "nope": True}, "labelsMax": 32, "mosaicMax": "8", "handoff": True}})["dice"]
    assert dice["include"] == {"theme": False}
    assert dice["on"] is True
    assert dice["periodMin"] == 12
    assert dice["labelsMax"] == 32
    assert dice["mosaicMax"] == "8"
    assert dice["handoff"] is False
