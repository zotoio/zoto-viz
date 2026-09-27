"""Unbundled TypeScript entry must increment compile_runs without esbuild."""
from __future__ import annotations

import tempfile
from pathlib import Path

from service import plugins


def test_unbundled_frontend_increments_compile_runs() -> None:
    home = Path(tempfile.mkdtemp())
    fe = home / "frontend"
    fe.mkdir()
    yml = home / "plugin.yml"
    yml.write_text(
        "id: unbundled-compile\nfrontend:\n  entry: frontend/module.js\n  bundle: false\n",
        encoding="utf-8",
    )
    (fe / "module.js").write_text("export {};\n", encoding="utf-8")
    doc = {"id": "unbundled-compile", "frontend": {"entry": "frontend/module.js", "bundle": False}}
    plugins.reset_bundles()
    before = plugins.compile_runs()
    plugins.compile_typescript(doc, yml, None)
    assert plugins.compile_runs() == before + 1
