"""#171 (b): a pack whose graphics code would stop it drawing is blocked at install (UX Pro copy).

The three blocking uniform rules (``glsl-uniform-undeclared``, ``uniform-type-conflict``,
``write-uniform-not-in-manifest``) refuse the install with the block reason ``graphics_code_error``;
the user text keeps the #185 "was blocked" shape with the "Ask its author for a fixed version." tail.
Every other refusal keeps "If you made this pack, run pack lint to see what to fix." The warn-only
uniform rules (``glsl-uniform-unset``, ``uniform-set-undeclared``) install: rule, file and line go to
the service log, the user sees nothing.

Every install row runs the real bundle-pack-entry.mjs (the committed built lint), as the service does.
"""
from __future__ import annotations

import io
import logging
import re
import zipfile
from pathlib import Path

import pytest

from service import pack_block_copy
from service import paths
from service import plugin_install
from service import plugin_local
from service import plugins

ROOT = Path(__file__).resolve().parents[1]
GRAPHICS = "its graphics code has an error that would stop it drawing."
FIX_TAIL = "If you made this pack, run pack lint to see what to fix."
AUTHOR_TAIL = "Ask its author for a fixed version."
_RAW = (
    "glsl-uniform-undeclared", "uniform-type-conflict", "write-uniform-not-in-manifest",
    "glsl-uniform-unset", "uniform-set-undeclared", "uGlow", "uTime", "fragment", ".glsl",
    "plugin.yml", "plugins/", "pack lint",
)

FRESH = (
    "Uniform Probe was blocked because its graphics code has an error that would stop it drawing. "
    "Nothing was installed, and your wall is unchanged. Ask its author for a fixed version."
)
UPGRADE_OLD_KNOWN = (
    "Uniform Probe was blocked because its graphics code has an error that would stop it drawing. "
    "Nothing was installed, and your wall is unchanged. You're still on version 1. Ask its author for a fixed version."
)
UPGRADE_OLD_UNKNOWN = (
    "Uniform Probe was blocked because its graphics code has an error that would stop it drawing. "
    "Nothing was installed, and your wall is unchanged. The version you had is still installed. "
    "Ask its author for a fixed version."
)

SKY_OK = "void main() {\n  fragColor = vec4(uAccent * uBright, uOpacity);\n}\n"
SKY_UNDECLARED = "void main() {\n  float g = uGlow;\n  fragColor = vec4(vec3(g), 1.0);\n}\n"
SKY_UNSET = "uniform float uGlow;\nvoid main() {\n  fragColor = vec4(vec3(uGlow), 1.0);\n}\n"


def _yml(version: int) -> str:
    return (
        "id: uniform-probe\nname: Uniform Probe\n"
        f"version: {version}\nfrontend:\n  entry: frontend/index.ts\n"
    )


def _zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for rel, text in files.items():
            zf.writestr(rel, text)
    return buf.getvalue()


def _pack(version: int, sky: str | None = SKY_OK, frontend: str = "export const ready = true;\n") -> bytes:
    files = {"plugin.yml": _yml(version), "frontend/index.ts": frontend}
    if sky is not None:
        files["sky/fragment.glsl"] = sky
    return _zip(files)


def _needs_node_tree() -> None:
    if not (ROOT / "web" / "node_modules" / "esbuild").exists():
        pytest.skip("web/node_modules not installed")


def _repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    return repo


def _plain(text: str) -> None:
    for raw in _RAW:
        assert raw not in text, (raw, text)
    assert not re.search(r":\d", text), text


@pytest.fixture
def _node(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, _isolate_plugin_local: Path) -> None:
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()


def _runtime() -> Path:
    return paths.plugin_local_runtime_dir(create=True) / "uniform-probe"


def test_copy_table_graphics_reason() -> None:
    """The three pinned strings, from the shared copy table (pack_block_copy)."""
    g = pack_block_copy.GRAPHICS_CODE_ERROR
    assert g == "graphics_code_error"
    assert pack_block_copy.block_message("Uniform Probe", GRAPHICS, tail=pack_block_copy.BLOCK_AUTHOR_TAIL) == FRESH
    assert pack_block_copy.upgrade_block_message(
        "Uniform Probe", GRAPHICS, 1, tail=pack_block_copy.BLOCK_AUTHOR_TAIL, reason=g
    ) == UPGRADE_OLD_KNOWN
    assert pack_block_copy.upgrade_block_message(
        "Uniform Probe", GRAPHICS, None, tail=pack_block_copy.BLOCK_AUTHOR_TAIL, reason=g
    ) == UPGRADE_OLD_UNKNOWN
    # Any other refusal: unchanged #185 upgrade copy.
    assert pack_block_copy.upgrade_block_message("Uniform Probe", "it tries to reach outside its sandbox.", 1) == (
        "Uniform Probe was blocked because it tries to reach outside its sandbox. "
        f"Nothing was updated, so version 1 is still installed. {FIX_TAIL}"
    )


@pytest.mark.usefixtures("_node")
def test_fresh_install_of_a_pack_reading_an_undeclared_uniform_is_blocked(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING)
    out = plugin_local.install_local_zip(_pack(1, sky=SKY_UNDECLARED), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("message") == FRESH, out
    _plain(str(out.get("message")))
    assert not _runtime().exists()
    log = "\n".join(r.getMessage() for r in caplog.records)
    assert re.search(r"pack install lint block: plugins/src/uniform-probe/sky/fragment\.glsl:2 glsl-uniform-undeclared — .*uGlow", log), log


@pytest.mark.usefixtures("_node")
def test_upgrade_to_a_broken_shader_keeps_v1_and_names_it() -> None:
    first = plugin_local.install_local_zip(_pack(1), overwrite=True)
    assert first.get("wrote") is True, first
    out = plugin_local.install_local_zip(_pack(2, sky=SKY_UNDECLARED), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("message") == UPGRADE_OLD_KNOWN, out
    _plain(str(out.get("message")))
    assert "version: 1" in (_runtime() / "plugin.yml").read_text(encoding="utf-8")


@pytest.mark.usefixtures("_node")
def test_upgrade_to_a_broken_shader_when_the_old_version_is_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    first = plugin_local.install_local_zip(_pack(1), overwrite=True)
    assert first.get("wrote") is True, first
    monkeypatch.setattr(plugin_install, "installed_runtime_version", lambda _runtime: None)
    out = plugin_local.install_local_zip(_pack(2, sky=SKY_UNDECLARED), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("message") == UPGRADE_OLD_UNKNOWN, out


@pytest.mark.usefixtures("_node")
def test_a_non_uniform_refusal_keeps_the_run_pack_lint_tail() -> None:
    leak = 'export const db = () => indexedDB.open("x");\n'
    out = plugin_local.install_local_zip(_pack(1, frontend=leak), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("message") == (
        "Uniform Probe was blocked because it tries to reach outside its sandbox. "
        f"Nothing was installed, and your wall is unchanged. {FIX_TAIL}"
    ), out


@pytest.mark.usefixtures("_node")
def test_a_sandbox_escape_plus_a_uniform_block_keeps_the_run_pack_lint_tail() -> None:
    leak = 'export const db = () => indexedDB.open("x");\n'
    out = plugin_local.install_local_zip(_pack(1, sky=SKY_UNDECLARED, frontend=leak), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("message") == (
        "Uniform Probe was blocked because it tries to reach outside its sandbox. "
        "Its graphics code has an error that would stop it drawing. "
        f"Nothing was installed, and your wall is unchanged. {FIX_TAIL}"
    ), out


@pytest.mark.usefixtures("_node")
def test_a_warn_only_uniform_finding_installs_and_is_logged_only(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    out = plugin_local.install_local_zip(_pack(1, sky=SKY_UNSET), overwrite=True)
    assert out.get("wrote") is True, out
    assert _runtime().is_dir()
    # Nothing about the finding reaches the user (the result's fixed agent hint is not about it).
    for value in out.values():
        for raw in ("glsl-uniform-unset", "uGlow", "sky/fragment.glsl", "graphics", "was blocked", "pack lint"):
            assert raw not in str(value), (raw, out)
    log = [r.getMessage() for r in caplog.records]
    hits = [m for m in log if m.startswith("pack install lint warning: ")]
    assert len(hits) == 1, log
    assert re.match(
        r"pack install lint warning: plugins/src/uniform-probe/sky/fragment\.glsl:3 glsl-uniform-unset — .*uGlow", hits[0]
    ), hits
