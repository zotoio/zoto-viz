"""#186: a temp copy of what bundle-pack-entry.mjs needs, for the install-lint rows.

The service runs ``plugins._PACK_BUNDLE_SCRIPT``; pointing it at the copy's script makes the
in-process install lint really use the copy's files (the built lint, its stamp, esbuild, plugins/sdk).
No tsx anywhere in the copy.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINT_SCRIPTS = ("bundle-pack-entry.mjs", "pack-install-lint-stamp.mjs", "pack-install-lint.built.mjs")
BUILT_LINT = "pack-install-lint.built.mjs"


def script_tree(
    tmp_path: Path,
    *,
    built: bool | str = True,
    esbuild: bool = True,
    sdk_copy: bool = False,
    name: str = "tree",
) -> Path:
    """Return the copy's ``web/scripts/bundle-pack-entry.mjs``.

    ``built``: True copies the committed built lint, False leaves it out, a string replaces it.
    ``sdk_copy`` copies plugins/sdk (so a row can edit it) instead of linking it.
    """
    tree = tmp_path / name
    scripts = tree / "web" / "scripts"
    scripts.mkdir(parents=True)
    (tree / "web" / "node_modules").mkdir()
    (tree / "plugins").mkdir()
    for f in LINT_SCRIPTS:
        if f == BUILT_LINT and built is not True:
            continue
        shutil.copy2(ROOT / "web" / "scripts" / f, scripts / f)
    if isinstance(built, str):
        (scripts / BUILT_LINT).write_text(built, encoding="utf-8")
    shutil.copy2(ROOT / "web" / "package.json", tree / "web" / "package.json")
    if esbuild:
        os.symlink((ROOT / "web" / "node_modules" / "esbuild").resolve(), tree / "web" / "node_modules" / "esbuild")
    if sdk_copy:
        shutil.copytree(ROOT / "plugins" / "sdk", tree / "plugins" / "sdk", symlinks=True)
    else:
        os.symlink(ROOT / "plugins" / "sdk", tree / "plugins" / "sdk")
    assert not any(tree.rglob("tsx")), "no tsx in the copy"
    return scripts / "bundle-pack-entry.mjs"
