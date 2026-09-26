"""Shipped Rocket Car Soccer pack: schema scan and consented sky smoke."""
from __future__ import annotations

from pathlib import Path

from service import plugins


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src" / "rocket-car-soccer"


def test_rocket_car_soccer_catalog_and_sky(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(ROOT))
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")

    result = plugins.scan(ROOT / "plugins")
    assert not [
        e for e in result["errors"] if "rocket-car-soccer" in str(e.get("file", ""))
    ], result["errors"]
    row = next(p for p in result["plugins"] if p["id"] == "rocket-car-soccer")
    assert row.get("origin") == "src"
    assert row["has_sky_shader"] is True
    assert (SRC / "sky" / "fragment.glsl").is_file()
    assert row.get("viz", {}).get("idle") == {"fixture": "host"}
    assert row.get("viz", {}).get("maxBuffers") == 3
