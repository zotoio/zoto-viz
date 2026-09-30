"""Guard: every shipped TypeScript pack is in the catalog, or the run says why not.

Without ``web/node_modules`` esbuild is missing and ``scan()`` drops every TS pack without a word
(production side: #169). This row turns that into a loud failure naming the fix.

Revert proof: hide the esbuild package and make the bundle subprocess fail the way it does
without ``node_modules``; the row goes red with the message.
"""
from __future__ import annotations

from pathlib import Path

import subprocess

import pytest

from service import plugins

SRC = plugins.REPO / "plugins" / "src"
ESBUILD_PKG = plugins.REPO / "web" / "node_modules" / "esbuild"
FIX = "TS packs dropped: esbuild unavailable, run pnpm install --frozen-lockfile in web/"


def _shipped_ts_pack_ids() -> set[str]:
    ids: set[str] = set()
    for yml in SRC.glob("*/plugin.yml"):
        fe = yml.parent / "frontend"
        if fe.is_dir() and any(fe.rglob("*.ts")):
            ids.add(yml.parent.name)
    return ids


def _missing_ts_packs() -> tuple[list[str], bool]:
    plugins.reset_bundles()
    try:
        rows = plugins.scan()["plugins"]
    finally:
        plugins.reset_bundles()
    listed = {str(r.get("id") or "") for r in rows}
    return sorted(_shipped_ts_pack_ids() - listed), ESBUILD_PKG.is_dir()


def assert_ts_packs_listed() -> None:
    missing, have_esbuild = _missing_ts_packs()
    if missing and not have_esbuild:
        pytest.fail(f"{FIX} ({len(missing)} missing: {', '.join(missing[:8])}…)")
    assert not missing, f"TS packs missing from scan() with esbuild present: {missing}"


def test_shipped_ts_packs_exist() -> None:
    assert len(_shipped_ts_pack_ids()) >= 20


def test_every_shipped_ts_pack_is_in_the_catalog() -> None:
    assert_ts_packs_listed()


def test_revert_missing_esbuild_fails_loudly(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(globals(), "ESBUILD_PKG", tmp_path / "no-esbuild")

    def no_esbuild(*_a: object, **_k: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess([], 1, "", "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'esbuild'")

    monkeypatch.setattr(plugins.subprocess, "run", no_esbuild)
    with pytest.raises(pytest.fail.Exception, match="esbuild unavailable, run pnpm install"):
        assert_ts_packs_listed()
