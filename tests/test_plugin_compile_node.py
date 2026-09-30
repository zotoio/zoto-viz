from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from service import cursor_agent
from service import plugins


def test_compile_typescript_invokes_configured_node_binary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    src = Path(__file__).resolve().parents[1] / "plugins" / "src" / "pulse-ts" / "plugin.yml"
    if not src.is_file():
        pytest.skip("pulse-ts fixture missing")
    if not plugins._PACK_BUNDLE_SCRIPT.is_file():
        pytest.skip("bundle-pack-entry.mjs missing")

    custom_node = "/opt/zoto-tests/custom-node"
    monkeypatch.setattr(cursor_agent, "node_bin", lambda: custom_node)
    seen: list[list[str]] = []

    def capture_run(cmd: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        seen.append(list(cmd))
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="esbuild stub")

    # #185: bundle-pack-entry.mjs runs through plugins._run_pack_script (own session + group kill).
    monkeypatch.setattr(plugins, "_run_pack_script", capture_run)
    doc = plugins.load_file(src)
    with pytest.raises(ValueError):
        plugins.compile_typescript(doc, src)
    assert seen
    assert seen[0][0] == custom_node
    assert "bundle-pack-entry.mjs" in seen[0][1]
