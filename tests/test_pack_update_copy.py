"""#111: UX Pro's sentences for the four remaining "v1" lines, from the one copy table.

web/scripts/pack-install-lint-setup-copy.json holds them (``updates`` and ``install_unchecked``); the service
renders them (service/pack_install_lint.py) and the web reads the same file
(web/src/plugins/pack-install-copy-table.ts). These rows pin the exact strings on the service's real paths,
that the web retry copy has no words of its own, and that no copy says "v<n>".
"""
from __future__ import annotations

import io
import json
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

import pytest

from service import paths
from service import plugin_local
from service import plugin_zip as pz
from service import plugins
from service.plugin_install import (
    InstallStartFailedError,
    install_zip_to_runtime,
    recover_interrupted_swaps,
)

ROOT = Path(__file__).resolve().parents[1]
TABLE = ROOT / "web" / "scripts" / "pack-install-lint-setup-copy.json"
RETRY_COPY_TS = ROOT / "web" / "src" / "plugins" / "pack-install-retry-copy.ts"
COPY_TABLE_TS = ROOT / "web" / "src" / "plugins" / "pack-install-copy-table.ts"
PID = "upgrade-probe"
#: The fixture pack's own name (test data, not copy: it happens to end in "v1").
NAME = "Upgrade probe v1"
FIXTURE = ROOT / "plugins/sdk/pack-bundle-fixtures" / PID

STILL_1 = "You're still on version 1."
STILL_UNKNOWN = "The version you had is still installed."


@pytest.fixture(autouse=True)
def _fresh_block_caches(_isolate_plugin_local: Path):
    """No remembered zip blocks between rows: the fixture zips are byte-identical across rows."""
    from service.pack_runtime import _clear_zip_block_cache
    from service.pack_zip_blocks import reset_zip_blocks_for_tests

    reset_zip_blocks_for_tests()
    _clear_zip_block_cache()
    plugins.reset_scan_memo()
    yield
    reset_zip_blocks_for_tests()
    _clear_zip_block_cache()


def _repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    plugins.reset_bundles()


def _pack(tmp_path: Path, n: int) -> bytes:
    src = tmp_path / f"v{n}"
    shutil.copytree(FIXTURE, src)
    yml = src / "plugin.yml"
    yml.write_text(yml.read_text(encoding="utf-8").replace("version: 1", f"version: {n}"), encoding="utf-8")
    (src / "frontend" / "sdk" / "marker.ts").write_text(f'export const marker = "upgrade-v{n}";\n', encoding="utf-8")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for path in src.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(src).as_posix())
    return buf.getvalue()


def _install_v1(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    _repo(tmp_path, monkeypatch)
    plugin_local.install_local_zip(_pack(tmp_path, 1), overwrite=True)
    runtime = paths.plugin_local_runtime_dir(create=True) / PID
    assert (runtime / "plugin.yml").is_file(), "v1 installed"
    plugins.scan()
    return runtime


def _fail_start(*_a: object, **_k: object) -> None:
    raise RuntimeError("compile exploded")


def _forget_old_version(monkeypatch: pytest.MonkeyPatch, *modules: str) -> None:
    for mod in modules:
        monkeypatch.setattr(f"{mod}.installed_runtime_version", lambda _runtime: None)


KNOWN_UNKNOWN = [pytest.param(True, id="old-version-known"), pytest.param(False, id="old-version-unknown")]


@pytest.mark.parametrize("known", KNOWN_UNKNOWN)
def test_couldnt_start_says_it_wasnt_updated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, known: bool
) -> None:
    """1. The new version couldn't start: "<Name> version <new> couldn't start, so it wasn't updated." + the pair."""
    _install_v1(tmp_path, monkeypatch)
    if not known:
        _forget_old_version(monkeypatch, "service.plugin_install")
    monkeypatch.setattr("service.plugin_install._start_runtime", _fail_start)
    with pytest.raises(InstallStartFailedError) as exc:
        plugin_local.install_local_zip(_pack(tmp_path, 2), overwrite=True)
    want = f"{NAME} version 2 couldn't start, so it wasn't updated. " + (STILL_1 if known else STILL_UNKNOWN)
    assert str(exc.value) == want


@pytest.mark.parametrize("known", KNOWN_UNKNOWN)
def test_interrupted_update_says_nothing_changed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, known: bool
) -> None:
    """2. An update that didn't finish (killed between the renames), recovered on the next start:
    "The update to <Name> didn't finish, so nothing changed." + the pair."""
    runtime = _install_v1(tmp_path, monkeypatch)
    dest = paths.plugin_local_dir() / f"{PID}.zip"
    doc = plugins.validate_doc(pz.inspect_zip(dest).plugin)

    def killed() -> None:
        raise RuntimeError("simulated kill between renames")

    fd, tmp = tempfile.mkstemp(suffix=".zip")
    os.write(fd, _pack(tmp_path, 2))
    os.close(fd)
    try:
        monkeypatch.setattr("service.plugin_install._after_first_rename", killed)
        with pytest.raises(RuntimeError, match="simulated kill"):
            install_zip_to_runtime(
                Path(tmp), dest, runtime, doc, rel=str(dest), sha256=pz.plugin_sha256(Path(tmp)), upgrade=True
            )
    finally:
        Path(tmp).unlink(missing_ok=True)
    if not known:
        _forget_old_version(monkeypatch, "service.plugin_install")
    msgs = recover_interrupted_swaps(runtime.parent)
    want = f"The update to {NAME} didn't finish, so nothing changed. " + (STILL_1 if known else STILL_UNKNOWN)
    assert msgs == [want]


@pytest.mark.parametrize("known", KNOWN_UNKNOWN)
def test_retry_still_couldnt_start(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, known: bool) -> None:
    """3. Retry of a blocked zip, and the new version still couldn't start:
    "<Name> version <new> still couldn't start." + the pair (and installedVersion for the web fallback)."""
    _install_v1(tmp_path, monkeypatch)
    v2 = _pack(tmp_path, 2)
    monkeypatch.setattr("service.plugin_install._start_runtime", _fail_start)
    with pytest.raises(InstallStartFailedError):
        plugin_local.install_local_zip(v2, overwrite=True)
    dest = paths.plugin_local_dir() / f"{PID}.zip"
    dest.write_bytes(v2)
    if not known:
        _forget_old_version(monkeypatch, "service.plugin_local")
    info = plugin_local.retry_blocked_zip_install(pz.plugin_sha256(dest), activate=False)
    want = f"{NAME} version 2 still couldn't start. " + (STILL_1 if known else STILL_UNKNOWN)
    assert info.get("retryResult") == "start_failed", info
    assert info.get("message") == want, info
    assert info.get("installedVersion") == ("1" if known else ""), info


def test_fresh_install_unchecked_is_the_185_sentence_without_a_fix(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """4. A fresh install whose check couldn't run. Every missing-tool cause on this path (node can't
    start, lint setup) is already a PackInstallLintSetupError with #185's fix sentence; what's left here
    is an OSError reading the staged pack, a different cause, so the #185 first sentence alone. Never a
    "still on" ending (there is no old version)."""
    _repo(tmp_path, monkeypatch)

    def unreadable(*_a: object, **_k: object) -> None:
        raise OSError("staged entry unreadable")

    monkeypatch.setattr(plugins, "verify_pack_bundle_home", unreadable)
    # #200: the install answers the sentence (no longer raises); tests/test_pack_install_unchecked.py
    # pins the rest of that answer.
    info = plugin_local.install_local_zip(_pack(tmp_path, 1), overwrite=True)
    want = f"Couldn't safety-check {NAME}, so it wasn't installed."
    assert info.get("ok") is False and info.get("reasonCode") == "install_unchecked", info
    assert info.get("message") == want, info
    table = json.loads(TABLE.read_text(encoding="utf-8"))
    first = table["install"].replace("{name}", NAME).split(" {fix}")[0]
    assert want == first, "word for word the #185 install sentence, without its fix"
    assert "still" not in want.lower()


def _fragments(template: str) -> list[str]:
    return [f.strip() for f in re.split(r"\{\w+\}", template) if len(f.strip()) >= 12]


def test_retry_copy_is_sourced_from_the_table() -> None:
    """pack-install-retry-copy.ts takes its sentence from the table (through pack-install-copy-table.ts),
    and no web or service source keeps the words of an ``updates`` sentence of its own."""
    retry_src = RETRY_COPY_TS.read_text(encoding="utf-8")
    assert re.search(r'from "\./pack-install-copy-table"', retry_src), "retry copy imports the table module"
    assert re.search(r'packUpdateCopy\("retry_couldnt_start"', retry_src), "retry copy renders the table's sentence"
    assert re.search(
        r'from "\.\./\.\./scripts/pack-install-lint-setup-copy\.json"', COPY_TABLE_TS.read_text(encoding="utf-8")
    ), "the table module reads the one table file"
    table = json.loads(TABLE.read_text(encoding="utf-8"))
    fragments = [f for t in table["updates"].values() for f in _fragments(t)]
    assert len(fragments) >= 4, fragments
    sources = [
        *(p for p in (ROOT / "web" / "src").rglob("*.ts") if not p.name.endswith(".test.ts")),
        *(ROOT / "service").glob("*.py"),
    ]
    hits = [(p.relative_to(ROOT).as_posix(), f) for p in sources for f in fragments if f in p.read_text(encoding="utf-8")]
    assert not hits, f"update copy outside {TABLE.relative_to(ROOT)}: {hits}"


def test_no_v_number_in_the_copy() -> None:
    """Always "version <n>", never "v<n>": the table and the web retry copy."""
    hits = [
        (p.relative_to(ROOT).as_posix(), n, line.strip())
        for p in (TABLE, RETRY_COPY_TS, COPY_TABLE_TS)
        for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1)
        if re.search(r"\bv\d", line)
    ]
    assert hits == [], hits
