"""Shipped Rocket Car Soccer pack: schema scan, consented sky smoke, pack vitest."""
from __future__ import annotations

import subprocess
from pathlib import Path

from service import plugins


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src" / "rocket-car-soccer"
VITEST = ROOT / "web" / "node_modules" / ".bin" / "vitest"
VITEST_CONFIG = SRC / "vitest.config.cjs"


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
    assert row.get("viz", {}).get("maxBuffers") == 8
    assert row.get("viz", {}).get("hostMeshSlot") == 3


def test_rocket_car_soccer_pack_vitest() -> None:
    if not VITEST.is_file():
        return
    subprocess.run(
        [str(VITEST), "run", "--config", str(VITEST_CONFIG)],
        cwd=ROOT,
        check=True,
        timeout=120,
    )
