"""Shipped Ant Colony pack: boundary, catalog, sky, and pack-local vitest."""
from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace

from service import plugins


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src" / "ant-colony"
PACK_TEST = SRC / "frontend" / "index.test.ts"


def _req(pid: str):
    return SimpleNamespace(match_info={"id": pid}, rel_url=SimpleNamespace(query={}))


def test_ant_colony_catalog_and_sky(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(ROOT))
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")

    result = plugins.scan(ROOT / "plugins")
    assert not [e for e in result["errors"] if "ant-colony" in str(e.get("file", ""))], result["errors"]
    row = next(p for p in result["plugins"] if p["id"] == "ant-colony")
    assert row.get("origin") == "src"
    assert row["has_sky_shader"] is True
    assert (SRC / "sky" / "fragment.glsl").is_file()
    assert row.get("viz", {}).get("idle") == {"fixture": "host"}

    plugins.grant_consent(row, "authored")
    fresh = plugins.scan(ROOT / "plugins")["plugins"]
    ac = next(p for p in fresh if p["id"] == "ant-colony")
    assert ac["sky_available"] is True

    ok = plugins.api_sky(_req("ant-colony"))
    assert ok.status == 200
    assert "zotoVizSlots" in ok.text
    assert "labelInk" in ok.text


def test_ant_colony_pack_vitest() -> None:
    assert PACK_TEST.is_file()
    web = ROOT / "web"
    config = SRC / "vitest.config.cjs"
    proc = subprocess.run(
        ["pnpm", "exec", "vitest", "run", "--config", str(config)],
        cwd=web,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
