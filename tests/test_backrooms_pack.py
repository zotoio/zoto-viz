"""Shipped Backrooms pack: catalog row, idle fixture, consented sky."""
from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace

from service import plugins


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src" / "backrooms"


def _req(pid: str):
    return SimpleNamespace(match_info={"id": pid}, rel_url=SimpleNamespace(query={}))


def test_backrooms_catalog_and_sky(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(ROOT))
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")

    result = plugins.scan(ROOT / "plugins")
    assert not [e for e in result["errors"] if "backrooms" in str(e.get("file", ""))], result["errors"]
    row = next(p for p in result["plugins"] if p["id"] == "backrooms")
    assert row.get("origin") == "src"
    assert row["has_sky_shader"] is True
    assert (SRC / "sky" / "fragment.glsl").is_file()
    assert row.get("viz", {}).get("idle") == {"fixture": "host"}

    plugins.grant_consent(row, "authored")
    fresh = plugins.scan(ROOT / "plugins")["plugins"]
    bro = next(p for p in fresh if p["id"] == "backrooms")
    assert bro["sky_available"] is True
    assert "sky_error" not in bro or not bro.get("sky_error")

    ok = plugins.api_sky(_req("backrooms"))
    assert ok.status == 200
    assert "zotoVizSlots" in ok.text
    assert "bool walled(" in ok.text
    assert row.get("viz", {}).get("maxBuffers") == 2


def test_backrooms_present_pack_vitest() -> None:
    web = ROOT / "web"
    subprocess.run(
        [
            "pnpm",
            "exec",
            "vitest",
            "run",
            "--config",
            "../plugins/src/backrooms/vitest.config.ts",
        ],
        cwd=web,
        check=True,
    )
