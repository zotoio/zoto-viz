"""#253: a pack whose code doesn't build while it's being checked isn't a block (UX Pro 2026-10-01).

The check ran and the pack just didn't build (an esbuild error), so the user text never says "blocked",
never suggests pack lint and never carries the raw build error (its staging paths, line:col):

    fresh install: "<Name> couldn't be built, so it wasn't installed."
    update:        "The new version of <Name> couldn't be built, so it wasn't updated. You're still on
                    version <old>." ("The version you had is still installed." when it isn't known)

Every payload / catalog row carries reasonCode ``pack_build_failed`` (never #240's ``pack_blocked``), on
the local install path and the plugin-scan path. The raw build error goes to the service log only.
Case 1 of #253 (a graphics-code block keeps #171 (b)'s copy on an update) is already on main; the last
row guards it on the plugin-scan path. Every row runs the real bundle-pack-entry.mjs, as the service does.
"""
from __future__ import annotations

import io
import logging
import re
import zipfile
from pathlib import Path

import pytest

from service import paths
from service import plugin_install
from service import plugin_local
from service import plugins

ROOT = Path(__file__).resolve().parents[1]
PID = "build-probe"
NAME = "Build Probe"
BUILD_FAILED_CODE = "pack_build_failed"
BROKEN = "export const = ;\n"  # esbuild: Expected identifier but found "="
FRESH = "Build Probe couldn't be built, so it wasn't installed."
UPDATE_OLD_KNOWN = "The new version of Build Probe couldn't be built, so it wasn't updated. You're still on version 1."
UPDATE_OLD_UNKNOWN = (
    "The new version of Build Probe couldn't be built, so it wasn't updated. The version you had is still installed."
)
_RAW = ("blocked", "pack lint", "Build failed", "ERROR", "Expected identifier", ".staging", "frontend/", ".ts")

# Case 1 guard (#171 (b)): an undeclared uniform in the sky shader, on an update found by the plugin scan.
SKY_UNDECLARED = "void main() {\n  float g = uGlow;\n  fragColor = vec4(vec3(g), 1.0);\n}\n"
GRAPHICS_UPDATE = (
    "Build Probe was blocked because its graphics code has an error that would stop it drawing. "
    "Nothing was installed, and your wall is unchanged. You're still on version 1. Ask its author for a fixed version."
)


def _pack(version: int, frontend: str = "export const ready = true;\n", sky: str | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "plugin.yml", f"id: {PID}\nname: {NAME}\nversion: {version}\nfrontend:\n  entry: frontend/index.ts\n"
        )
        zf.writestr("frontend/index.ts", frontend)
        if sky is not None:
            zf.writestr("sky/fragment.glsl", sky)
    return buf.getvalue()


def _plain(text: str) -> None:
    for raw in _RAW:
        assert raw not in text, (raw, text)
    assert not re.search(r":\d", text), text


@pytest.fixture(autouse=True)
def _node(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, _isolate_plugin_local: Path):
    if not (ROOT / "web" / "node_modules" / "esbuild").exists():
        pytest.skip("web/node_modules not installed")
    from service.pack_runtime import _clear_zip_block_cache
    from service.pack_zip_blocks import reset_zip_blocks_for_tests

    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    plugins.reset_bundles()
    reset_zip_blocks_for_tests()
    _clear_zip_block_cache()
    plugins.reset_scan_memo()
    yield
    reset_zip_blocks_for_tests()
    _clear_zip_block_cache()


def _runtime_yml() -> str:
    return (paths.plugin_local_runtime_dir(create=True) / PID / "plugin.yml").read_text(encoding="utf-8")


def _install_v1() -> None:
    first = plugin_local.install_local_zip(_pack(1), overwrite=True)
    assert first.get("wrote") is True, first
    plugins.scan()


def _scan_rows() -> list[dict[str, str]]:
    plugins.reset_scan_memo()
    return [e for e in plugins.scan()["errors"] if PID in str(e.get("zip") or e.get("file") or "")]


def test_a_fresh_install_that_does_not_build_says_so_and_is_not_a_block(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING):
        out = plugin_local.install_local_zip(_pack(1, frontend=BROKEN), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("message") == FRESH, out
    assert out.get("reasonCode") == BUILD_FAILED_CODE, out
    assert out.get("error") == "pack_install_blocked", out
    _plain(str(out.get("message")))
    assert "Expected identifier" in caplog.text, "the raw build error is in the log"


def test_an_update_that_does_not_build_keeps_v1_and_names_it() -> None:
    _install_v1()
    out = plugin_local.install_local_zip(_pack(2, frontend=BROKEN), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("message") == UPDATE_OLD_KNOWN, out
    assert out.get("reasonCode") == BUILD_FAILED_CODE, out
    assert out.get("upgrade_blocked") == "true", out
    _plain(str(out.get("message")))
    assert "version: 1" in _runtime_yml(), "v1 is still installed"


def test_an_update_that_does_not_build_when_the_old_version_is_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_v1()
    monkeypatch.setattr(plugin_install, "installed_runtime_version", lambda _runtime: None)
    out = plugin_local.install_local_zip(_pack(2, frontend=BROKEN), overwrite=True)
    assert out.get("message") == UPDATE_OLD_UNKNOWN, out
    assert out.get("reasonCode") == BUILD_FAILED_CODE, out


def test_the_plugin_scan_rows_for_a_pack_that_does_not_build() -> None:
    drop = paths.plugin_local_dir(create=True) / f"{PID}.zip"
    drop.write_bytes(_pack(1, frontend=BROKEN))
    rows = _scan_rows()
    assert len(rows) == 1, rows
    assert rows[0].get("message") == FRESH, rows
    assert rows[0].get("reasonCode") == BUILD_FAILED_CODE, rows
    _plain(str(rows[0].get("message")))
    assert rows[0].get("error") == "pack_install_blocked", rows

    drop.unlink()
    _install_v1()
    drop.write_bytes(_pack(2, frontend=BROKEN))
    rows = _scan_rows()
    assert len(rows) == 1, rows
    assert rows[0].get("message") == UPDATE_OLD_KNOWN, rows
    assert rows[0].get("reasonCode") == BUILD_FAILED_CODE, rows
    assert rows[0].get("error") == "pack_install_blocked", rows
    assert "version: 1" in _runtime_yml(), "v1 is still installed"


def test_a_graphics_block_on_a_scanned_update_keeps_the_171b_copy() -> None:
    """#253 case 1 guard (already on main): the plugin scan's update keeps #171 (b)'s graphics copy."""
    _install_v1()
    (paths.plugin_local_dir(create=True) / f"{PID}.zip").write_bytes(_pack(2, sky=SKY_UNDECLARED))
    rows = _scan_rows()
    assert len(rows) == 1, rows
    assert rows[0].get("message") == GRAPHICS_UPDATE, rows
    assert rows[0].get("reasonCode") == "pack_blocked", rows
