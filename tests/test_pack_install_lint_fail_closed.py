"""#185: the pack install lint fails closed (service side).

bundle-pack-entry.mjs refuses an install with exit 3 and a ``pack-install-lint-setup-error`` line
when the install lint can't run or gives no verdict. The service maps that (and its own timeout)
to PackInstallLintSetupError with the user-facing wording, keeps a real lint block's existing
"was blocked" message, and accepts only exit 0 whose LAST stderr line is exactly
``{"type":"pack-install-lint-pass","nonce":<the service's per-run nonce>,"pack":<id>}``.
Unbundled (``frontend.bundle: false``) and no-frontend packs go through the same gate
(``bundle-pack-entry.mjs --lint-only``).

The install rows run the real bundle-pack-entry.mjs. #186: the lint runs in that process from the
prebuilt web/scripts/pack-install-lint.built.mjs (no tsx, no runner); the setup-refusal rows point
the service at a temp copy of the scripts without the built lint, so it really can't be loaded.
test_pack_install_lint_prebuilt.py has the #186 rows that replace #185's runner rows.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import shutil
import subprocess
import time
import zipfile
from pathlib import Path

import pytest

from service import paths
from service import plugin_local
from service import plugins
from tests.pack_install_lint_tree_util import script_tree
from service.pack_install_lint import (
    EXIT_LINT_SETUP,
    NONCE_ENV,
    REASON_INSTALL_CHECK_UNAVAILABLE,
    PackInstallLintSetupError,
    format_install_lint_setup_message,
    format_install_lint_setup_upgrade_message,
)

ROOT = Path(__file__).resolve().parents[1]
PULSE = ROOT / "plugins" / "src" / "pulse-ts" / "plugin.yml"
# #186: UX Pro split the fix by setup reason (the source is web/scripts/pack-install-lint-setup-copy.json;
# these are literal pins). A missing or stale built lint says `pnpm run prepare`; everything else
# (esbuild unresolvable, the service's own timeout, no pass verdict, …) keeps #185's `pnpm install`.
FIX_INSTALL = "Run `pnpm install` in `web/` and try again."
FIX_PREPARE = "Run `pnpm run prepare` in `web/` and try again."
SETUP_TAIL_INSTALL = f", so it wasn't installed. {FIX_INSTALL}"
SETUP_TAIL_PREPARE = f", so it wasn't installed. {FIX_PREPARE}"
_BLOCK_JSON = json.dumps(
    {
        "type": "pack-install-lint-block",
        "message": "it tries to reach outside its sandbox.",
        "details": ["plugins/src/pulse-ts/frontend/leak.ts:1 sandbox-escape — indexedDB"],
    }
)
_RULE_IDS = (
    "sandbox-escape", "host-transport-escape", "inline-zoto-declare", "pack-zoto-binding", "host-import",
    "cross-pack-import", "side-effect-import", "unverified-import-call", "get-config-in-on-frame",
    "host-imports-pack-src",
)


# #185 UX: user text never carries a repo / README path, a file path, an import specifier or a rule id.
_NOT_IN_USER_TEXT = ("plugins/", "README", ".ts", ".mjs", *_RULE_IDS)
_FIX_TAIL = "If you made this pack, run pack lint to see what to fix."


def _assert_plain_block_text(text: str) -> None:
    """#185 UX: "<Name> was blocked because <sentence> …" in plain words; raw findings stay in the log."""
    for token in _NOT_IN_USER_TEXT:
        assert token not in text, (token, text)
    assert "parent" not in text and "`" not in text and "../" not in text, text
    assert not re.search(r":\d", text), text


def _blocked(name: str, sentence: str) -> str:
    return f"{name} was blocked because {sentence} Nothing was installed, and your wall is unchanged. {_FIX_TAIL}"


def _upgrade_blocked(name: str, sentence: str, old: object) -> str:
    return f"{name} was blocked because {sentence} Nothing was updated, so version {old} is still installed. {_FIX_TAIL}"


KOI_BLOCK = _blocked("Koi Pond", "it tries to reach outside its sandbox.")
# koi-pond/frontend/index.test.ts guard on FRONT: after #187, and on main (d276d5df, a `parent.` finding).
KOI_187_GUARD = "expect(FRONT).not.toMatch(/\\bparent\\s*\\.\\s*document\\b/);"
KOI_MAIN_GUARD = 'expect(FRONT).not.toContain("parent.document");'


def _stub_bundle(monkeypatch: pytest.MonkeyPatch, code: int, stderr: object, stdout: str = "export {};\n") -> None:
    """Replace the bundle-pack-entry.mjs run; ``stderr`` may be a callable(env) (it sees the nonce)."""

    def run(argv: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        err = stderr(env) if callable(stderr) else stderr
        return subprocess.CompletedProcess(argv, code, stdout=stdout if code == 0 else "", stderr=err)

    monkeypatch.setattr(plugins, "_run_pack_script", run)


def _pass_line(nonce: str, pack: str = "pulse-ts") -> str:
    return json.dumps({"type": "pack-install-lint-pass", "nonce": nonce, "pack": pack})


def _pulse_doc() -> dict:
    if not PULSE.is_file():
        pytest.skip("pulse-ts fixture missing")
    return plugins.load_file(PULSE)


def test_setup_message_wording() -> None:
    """Each reason's own sentence (fresh install and upgrade); no reason / an unknown one: pnpm install."""
    for reason in ("lint_prebuilt_missing", "lint_prebuilt_stale"):
        assert format_install_lint_setup_message("Star Sines", reason) == (
            "Couldn't safety-check Star Sines, so it wasn't installed. Run `pnpm run prepare` in `web/` and try again."
        ), reason
        assert format_install_lint_setup_upgrade_message("Star Sines", 3, reason) == (
            "Couldn't safety-check the new version of Star Sines, so it wasn't updated. "
            "You're still on v3. Run `pnpm run prepare` in `web/` and try again."
        ), reason
        assert str(PackInstallLintSetupError("Star Sines", reason)) == f"Couldn't safety-check Star Sines{SETUP_TAIL_PREPARE}"
    for reason in ("esbuild_unresolvable", "lint_threw", "no_pass_verdict", "", "not_a_reason"):
        assert format_install_lint_setup_message("Star Sines", reason) == (
            "Couldn't safety-check Star Sines, so it wasn't installed. Run `pnpm install` in `web/` and try again."
        ), reason
        assert format_install_lint_setup_upgrade_message("Star Sines", 3, reason) == (
            "Couldn't safety-check the new version of Star Sines, so it wasn't updated. "
            "You're still on v3. Run `pnpm install` in `web/` and try again."
        ), reason
    assert format_install_lint_setup_message("Star Sines") == f"Couldn't safety-check Star Sines{SETUP_TAIL_INSTALL}"
    assert format_install_lint_setup_message("") == f"Couldn't safety-check Plugin{SETUP_TAIL_INSTALL}"
    assert format_install_lint_setup_upgrade_message("Star Sines", None, "lint_prebuilt_stale") == (
        "Couldn't safety-check the new version of Star Sines, so it wasn't updated. "
        "You're still on the version you had. Run `pnpm run prepare` in `web/` and try again."
    )


def test_compile_maps_lint_setup_exit_to_setup_error(monkeypatch: pytest.MonkeyPatch) -> None:
    doc = _pulse_doc()
    setup = json.dumps({"type": "pack-install-lint-setup-error", "message": "x", "detail": "built lint not importable"})
    _stub_bundle(monkeypatch, EXIT_LINT_SETUP, f"Couldn't safety-check Pulse TS\n{setup}\n")
    plugins.reset_bundles()
    with pytest.raises(PackInstallLintSetupError) as e:
        plugins.compile_typescript(doc, PULSE, update_cache=False, install_lint=True)
    assert str(e.value) == f"Couldn't safety-check Pulse TS{SETUP_TAIL_INSTALL}", "no reason code: pnpm install"
    assert "was blocked" not in str(e.value)


def test_compile_refuses_install_lint_bundle_without_pass_verdict(monkeypatch: pytest.MonkeyPatch) -> None:
    doc = _pulse_doc()
    _stub_bundle(monkeypatch, 0, "")
    plugins.reset_bundles()
    with pytest.raises(PackInstallLintSetupError, match="Couldn't safety-check Pulse TS"):
        plugins.compile_typescript(doc, PULSE, update_cache=False, install_lint=True)


def test_compile_accepts_install_lint_bundle_with_pass_verdict(monkeypatch: pytest.MonkeyPatch) -> None:
    doc = _pulse_doc()
    _stub_bundle(monkeypatch, 0, lambda env: f"lint warning line\n{_pass_line(env[NONCE_ENV], str(doc['id']))}\n")
    plugins.reset_bundles()
    out = plugins.compile_typescript(doc, PULSE, update_cache=False, install_lint=True)
    assert out["bytes"] > 0


@pytest.mark.parametrize(
    "stderr",
    [
        pytest.param(lambda env: '{"type":"pack-install-lint-pass"}\n', id="bare-pass-line"),
        pytest.param(lambda env: _pass_line("not-the-nonce") + "\n", id="wrong-nonce"),
        pytest.param(lambda env: _pass_line(env[NONCE_ENV], "other-pack") + "\n", id="other-pack"),
        pytest.param(lambda env: _pass_line(env[NONCE_ENV]) + "\nmore output\n", id="pass-not-last"),
        pytest.param(
            lambda env: json.dumps({"type": "pack-install-lint-pass", "nonce": env[NONCE_ENV], "pack": "pulse-ts", "x": 1}) + "\n",
            id="extra-keys",
        ),
    ],
)
def test_compile_refuses_pass_verdict_that_is_not_the_exact_last_line(monkeypatch: pytest.MonkeyPatch, stderr: object) -> None:
    doc = _pulse_doc()
    assert doc["id"] == "pulse-ts"
    _stub_bundle(monkeypatch, 0, stderr)
    plugins.reset_bundles()
    with pytest.raises(PackInstallLintSetupError, match="Couldn't safety-check Pulse TS"):
        plugins.compile_typescript(doc, PULSE, update_cache=False, install_lint=True)


def test_compile_lint_block_keeps_its_message_and_is_not_a_setup_error(monkeypatch: pytest.MonkeyPatch) -> None:
    doc = _pulse_doc()
    _stub_bundle(monkeypatch, 1, f"frontend/leak.ts:1 sandbox-escape — indexedDB\n{_BLOCK_JSON}\n")
    plugins.reset_bundles()
    with pytest.raises(ValueError) as e:
        plugins.compile_typescript(doc, PULSE, update_cache=False, install_lint=True)
    assert not isinstance(e.value, PackInstallLintSetupError)
    text = str(e.value)
    assert text == _blocked("Pulse TS", "it tries to reach outside its sandbox."), text
    _assert_plain_block_text(text)
    setup = format_install_lint_setup_message("Pulse TS")
    assert setup not in text and text not in setup
    assert "safety-check" not in text and "pnpm install" not in text
    assert "was blocked" not in setup


# --- install path through the real bundle-pack-entry.mjs, built lint really missing (#186) ------


def _repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    return repo


def _no_built_lint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """#186: the service runs a copy of bundle-pack-entry.mjs whose built lint is missing."""
    monkeypatch.setattr(plugins, "_PACK_BUNDLE_SCRIPT", script_tree(tmp_path, built=False, name="tree-no-built-lint"))


def _zip_tree(src: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for path in src.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(src).as_posix())
    return buf.getvalue()


def _probe(tmp_path: Path, version: int) -> bytes:
    src = tmp_path / f"probe-v{version}"
    shutil.copytree(ROOT / "plugins/sdk/pack-bundle-fixtures/upgrade-probe", src)
    yml = src / "plugin.yml"
    text = yml.read_text(encoding="utf-8").replace("version: 1", f"version: {version}")
    yml.write_text(text.replace("name: Upgrade probe v1", "name: Upgrade Probe"), encoding="utf-8")
    return _zip_tree(src)


def _needs_node_tree() -> None:
    if not (ROOT / "web" / "node_modules" / "esbuild").exists():
        pytest.skip("web/node_modules not installed")


def test_install_local_zip_refused_when_the_built_lint_is_missing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    _no_built_lint(tmp_path, monkeypatch)
    plugins.reset_bundles()
    out = plugin_local.install_local_zip(_probe(tmp_path, 1), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("error") == REASON_INSTALL_CHECK_UNAVAILABLE, out
    assert out.get("message") == f"Couldn't safety-check Upgrade Probe{SETUP_TAIL_PREPARE}"
    assert not (paths.plugin_local_runtime_dir(create=True) / "upgrade-probe").exists()


def test_upgrade_refused_when_the_built_lint_is_missing_keeps_v1(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    first = plugin_local.install_local_zip(_probe(tmp_path, 1), overwrite=True)
    assert first.get("wrote") is True, first
    runtime = paths.plugin_local_runtime_dir(create=True) / "upgrade-probe"
    assert runtime.is_dir()
    _no_built_lint(tmp_path, monkeypatch)
    plugins.reset_bundles()
    out = plugin_local.install_local_zip(_probe(tmp_path, 2), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("error") == REASON_INSTALL_CHECK_UNAVAILABLE, out
    assert out.get("message") == (
        "Couldn't safety-check the new version of Upgrade Probe, so it wasn't updated. "
        "You're still on v1. Run `pnpm run prepare` in `web/` and try again."
    )
    assert out.get("message") == format_install_lint_setup_upgrade_message("Upgrade Probe", 1, "lint_prebuilt_missing")
    assert "was blocked" not in str(out.get("message"))
    assert "version: 1" in (runtime / "plugin.yml").read_text(encoding="utf-8"), "v1 is still installed"


# --- service timeout (#186: the only bound; the in-process hang row is in test_pack_install_lint_prebuilt.py)


def _gone(pid: int) -> bool:
    for _ in range(50):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        try:
            # reaped zombies of our own children don't count; anything else is still alive
            if Path(f"/proc/{pid}/stat").read_text().split()[2] == "Z":
                return True
        except OSError:
            return True
        time.sleep(0.1)
    return False


def test_service_timeout_maps_to_setup_refusal_and_kills_the_group(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    """The service's own timeout (a bundle-pack-entry.mjs that hangs) is the setup refusal, not a raw
    TimeoutExpired, and the whole process group (the script and its child) is killed."""
    _needs_node_tree()
    pids = tmp_path / "pids"
    hang = tmp_path / "hang-bundle.mjs"
    hang.write_text(
        "import { spawn } from 'node:child_process';\n"
        "import { appendFileSync } from 'node:fs';\n"
        "const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });\n"
        f"appendFileSync({json.dumps(str(pids))}, `${{process.pid}} ${{c.pid}}\\n`);\n"
        "setInterval(() => {}, 1000);\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(plugins, "_PACK_BUNDLE_SCRIPT", hang)
    monkeypatch.setattr(plugins, "PACK_BUNDLE_TIMEOUT_S", 1.5)
    doc = _pulse_doc()
    plugins.reset_bundles()
    t0 = time.monotonic()
    with pytest.raises(PackInstallLintSetupError) as e:
        plugins.compile_typescript(doc, PULSE, update_cache=False, install_lint=True)
    assert time.monotonic() - t0 < 15
    assert str(e.value) == f"Couldn't safety-check Pulse TS{SETUP_TAIL_INSTALL}", "service timeout: pnpm install"
    for pid in (int(p) for p in pids.read_text().split()):
        assert _gone(pid), f"pid {pid} left running after the service timeout"
    _repo(tmp_path, monkeypatch)
    out = plugin_local.install_local_zip(_probe(tmp_path, 1), overwrite=True)
    assert out.get("error") == REASON_INSTALL_CHECK_UNAVAILABLE, out
    assert out.get("message") == f"Couldn't safety-check Upgrade Probe{SETUP_TAIL_INSTALL}"


# --- unbundled and no-frontend packs go through the same gate -----------------------------------


def _shipped_zip(tmp_path: Path, pack: str, *, leak_js: bool = False) -> bytes:
    src = tmp_path / f"src-{pack}"
    shutil.copytree(ROOT / "plugins" / "src" / pack, src)
    if leak_js:
        with (src / "frontend" / "helper.js").open("a", encoding="utf-8") as fh:
            fh.write('\nexport function stash() { return indexedDB.open("x"); }\n')
    return _zip_tree(src)


def test_bundle_false_pack_with_indexeddb_in_a_js_file_is_blocked_at_install(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    assert "bundle: false" in (ROOT / "plugins/src/sandbox-fixture-multi/plugin.yml").read_text(encoding="utf-8")
    out = plugin_local.install_local_zip(_shipped_zip(tmp_path, "sandbox-fixture-multi", leak_js=True), overwrite=True)
    assert out.get("ok") is False, out
    text = str(out.get("message") or out.get("error"))
    assert text == _blocked("Sandbox Fixture Multi", "it tries to reach outside its sandbox."), out
    _assert_plain_block_text(text)
    assert "safety-check" not in text
    assert not (paths.plugin_local_runtime_dir(create=True) / "sandbox-fixture-multi").exists()


def test_no_frontend_pack_gets_an_explicit_pass_and_installs(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    assert not (ROOT / "plugins/src/cores/frontend").exists()
    runs: list[tuple[list[str], str]] = []
    real = plugins._run_pack_script

    def spy(argv: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        proc = real(argv, env)
        runs.append((argv, proc.stderr))
        return proc

    monkeypatch.setattr(plugins, "_run_pack_script", spy)
    plugins.reset_bundles()
    out = plugin_local.install_local_zip(_shipped_zip(tmp_path, "cores"), overwrite=True)
    assert out.get("wrote") is True, out
    lint_only = [(a, err) for a, err in runs if "--lint-only" in a]
    assert len(lint_only) == 1, runs
    last = [ln for ln in lint_only[0][1].splitlines() if ln.strip()][-1]
    verdict = json.loads(last)
    assert verdict["type"] == "pack-install-lint-pass" and verdict["pack"] == "cores" and verdict["nonce"], verdict


def test_no_frontend_pack_is_refused_when_the_built_lint_is_missing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    _no_built_lint(tmp_path, monkeypatch)
    plugins.reset_bundles()
    out = plugin_local.install_local_zip(_shipped_zip(tmp_path, "cores"), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("error") == REASON_INSTALL_CHECK_UNAVAILABLE, out
    assert out.get("message") == f"Couldn't safety-check CPU cores{SETUP_TAIL_PREPARE}"


def test_koi_pond_block_is_plain_words_and_the_raw_findings_are_logged(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Real pack, real in-process lint, the service's install-lint check (verify_pack_bundle_home, what the
    zip install's staging checks call): koi-pond as it is on main (d276d5df) has a `parent.` finding,
    so it's blocked. (koi-pond itself can't be shared as a zip — its .glb assets are disallowed — so no
    zip here.)"""
    _needs_node_tree()
    home = tmp_path / "koi-pond"
    shutil.copytree(ROOT / "plugins" / "src" / "koi-pond", home, symlinks=True, ignore=shutil.ignore_patterns("node_modules"))
    # combined (#185 x #187): #187 removed koi-pond's only `parent.` finding (its index.test.ts guard).
    # Put main's line back in the copy so this row still runs a real koi-pond the lint blocks.
    guard = home / "frontend" / "index.test.ts"
    guard_src = guard.read_text(encoding="utf-8")
    assert guard_src.count(KOI_187_GUARD) == 1, "koi-pond's #187 guard line moved; update this row"
    guard.write_text(guard_src.replace(KOI_187_GUARD, KOI_MAIN_GUARD), encoding="utf-8")
    doc = plugins.load_file(home / "plugin.yml")
    codes: list[int] = []
    real = plugins._run_pack_script

    def spy(argv: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        proc = real(argv, env)
        codes.append(proc.returncode)
        return proc

    monkeypatch.setattr(plugins, "_run_pack_script", spy)
    caplog.set_level(logging.WARNING, logger="service.plugins")
    plugins.reset_bundles()
    with pytest.raises(ValueError) as e:
        plugins.verify_pack_bundle_home(home, doc)
    assert not isinstance(e.value, PackInstallLintSetupError)
    text = str(e.value)
    assert text == (
        "Koi Pond was blocked because it tries to reach outside its sandbox. "
        "Nothing was installed, and your wall is unchanged. "
        "If you made this pack, run pack lint to see what to fix."
    ), text
    assert text == KOI_BLOCK
    _assert_plain_block_text(text)
    assert "safety-check" not in text
    assert codes == [1], f"bundle-pack-entry.mjs exit codes {codes} (1 = lint block, 3 = setup)"
    logged = "\n".join(r.getMessage() for r in caplog.records if r.levelno == logging.WARNING)
    assert re.search(r"plugins/src/koi-pond/frontend/\S+:\d+ sandbox-escape", logged), logged


def test_setup_messages_and_the_lint_block_share_no_text(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    """Real service output: the lint block (bundle:false pack), the fresh-install setup refusal and
    the upgrade setup refusal; neither setup message contains the block's text, nor vice versa."""
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    block = plugin_local.install_local_zip(_shipped_zip(tmp_path, "sandbox-fixture-multi", leak_js=True), overwrite=True)
    block_msg = str(block.get("message") or block.get("error"))
    assert "was blocked" in block_msg, block
    first = plugin_local.install_local_zip(_probe(tmp_path, 1), overwrite=True)
    assert first.get("wrote") is True, first
    _no_built_lint(tmp_path, monkeypatch)
    plugins.reset_bundles()
    upgrade_msg = str(plugin_local.install_local_zip(_probe(tmp_path, 2), overwrite=True).get("message"))
    fresh_msg = str(plugin_local.install_local_zip(_shipped_zip(tmp_path, "cores"), overwrite=True).get("message"))
    assert fresh_msg == f"Couldn't safety-check CPU cores{SETUP_TAIL_PREPARE}"
    assert upgrade_msg.startswith("Couldn't safety-check the new version of Upgrade Probe")
    for setup in (fresh_msg, upgrade_msg):
        assert setup not in block_msg and block_msg not in setup
        for token in ("was blocked", "sandbox-escape", "indexedDB", "Nothing was installed", "pack lint"):
            assert token not in setup, (token, setup)
        for token in ("safety-check", "pnpm install", "pnpm run prepare", "wasn't installed", "wasn't updated", "still on v"):
            assert token not in block_msg, (token, block_msg)
    assert fresh_msg != upgrade_msg and fresh_msg not in upgrade_msg and upgrade_msg not in fresh_msg


# --- one shape for every block (UX Pro copy review, 2026-09-30) ----------------------------------


def _bad_probe(tmp_path: Path, version: int, kind: str) -> bytes:
    """Upgrade Probe at ``version`` with a lint finding ("lint") or an import outside its folder ("boundary")."""
    src = tmp_path / f"probe-bad-{kind}-v{version}"
    shutil.copytree(ROOT / "plugins/sdk/pack-bundle-fixtures/upgrade-probe", src)
    yml = src / "plugin.yml"
    text = yml.read_text(encoding="utf-8").replace("version: 1", f"version: {version}")
    yml.write_text(text.replace("name: Upgrade probe v1", "name: Upgrade Probe"), encoding="utf-8")
    entry = src / "frontend" / "index.ts"
    if kind == "lint":
        entry.write_text(entry.read_text(encoding="utf-8") + '\nexport function stash() { return indexedDB.open("x"); }\n', encoding="utf-8")
    else:
        shutil.copy2(ROOT / "plugins/sdk/pack-bundle-fixtures/json-escape/frontend/index.ts", entry)
    return _zip_tree(src)


def test_import_boundary_block_is_the_one_shape_and_the_path_is_only_in_details(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    _isolate_plugin_local: Path,
) -> None:
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    caplog.set_level(logging.WARNING)
    plugins.reset_bundles()
    src = ROOT / "plugins/sdk/pack-bundle-fixtures/json-escape"
    out = plugin_local.install_local_zip(_zip_tree(src), overwrite=True)
    assert out.get("ok") is False and out.get("error") == "pack_boundary", out
    text = str(out.get("message"))
    assert text == (
        "JSON escape probe was blocked because it loads code from outside its own folder. "
        "Nothing was installed, and your wall is unchanged. "
        "If you made this pack, run pack lint to see what to fix."
    ), text
    _assert_plain_block_text(text)
    assert "frontend/index.ts imports ../../../../../schema/plugin.schema.json" in str(out.get("details")), out
    assert "plugins/sdk/starter/README.md#2-pack-lint" in str(out.get("details")), out
    assert _FIX_TAIL == out.get("hint"), out
    logged = "\n".join(r.getMessage() for r in caplog.records if r.levelno == logging.WARNING)
    assert "frontend/index.ts imports" in logged, logged


@pytest.mark.parametrize(
    ("kind", "sentence"),
    [
        pytest.param("lint", "it tries to reach outside its sandbox.", id="lint-block"),
        pytest.param("boundary", "it loads code from outside its own folder.", id="import-boundary"),
    ],
)
def test_upgrade_block_names_the_version_that_is_really_installed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
    kind: str,
    sentence: str,
) -> None:
    """v3 installed, a blocked v4 dropped on top: "…so version 3 is still installed." (never "v1")."""
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    first = plugin_local.install_local_zip(_probe(tmp_path, 3), overwrite=True)
    assert first.get("wrote") is True, first
    runtime = paths.plugin_local_runtime_dir(create=True) / "upgrade-probe"
    plugins.reset_bundles()
    out = plugin_local.install_local_zip(_bad_probe(tmp_path, 4, kind), overwrite=True)
    assert out.get("ok") is False, out
    text = str(out.get("message"))
    assert text == _upgrade_blocked("Upgrade Probe", sentence, 3), text
    assert "v1" not in text and "version 1" not in text
    _assert_plain_block_text(text)
    assert "version: 3" in (runtime / "plugin.yml").read_text(encoding="utf-8"), "v3 is still installed"


def test_sdk_contract_block_is_the_one_shape_without_the_pack_lint_tail(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    """An older-SDK pack is a block ("was blocked"); pack lint can't fix it, so no pack-lint tail."""
    from service import pack_sdk_contract as psc

    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    row = psc.catalog_sdk_contract_error("x.zip", {"id": "upgrade-probe", "name": "Upgrade Probe"}, 0, 1)
    monkeypatch.setattr("service.plugin_install.assert_pack_sdk_compatible", lambda *_a, **_k: row)
    out = plugin_local.install_local_zip(_probe(tmp_path, 1), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("message") == (
        "Upgrade Probe was blocked because it was built for an older version of zoto-viz. "
        "Its author needs to update it. Nothing was installed, and your wall is unchanged."
    ), out
    _assert_plain_block_text(str(out.get("message")))


def _every_block_and_setup_text() -> tuple[list[str], list[str]]:
    from service.pack_block_copy import SENTENCE_CHECKS_FAILED, block_message, upgrade_block_message
    from service.pack_boundary import PackBundleBoundary, format_blocked_message, format_upgrade_blocked_message
    from service.pack_install_copy import blocked_message
    from service.pack_runtime import catalog_boundary_error
    from service.pack_sdk_contract import catalog_sdk_contract_error, format_sdk_older_message
    from service.plugin_install import format_v2_blocked_message

    b = PackBundleBoundary(
        pack_id="koi-pond", pack_name="Koi Pond", file="frontend/index.ts", import_spec="../../../web/src/plugins/host"
    )
    blocks = [
        KOI_BLOCK,
        format_blocked_message(b),
        format_upgrade_blocked_message(b, 3),
        format_upgrade_blocked_message(b, None),
        b.to_dict()["message"],
        b.to_dict()["hint"],
        catalog_boundary_error("x.zip", b)["message"],
        catalog_boundary_error("x.zip", b, upgrade=True, version=3)["message"],
        format_v2_blocked_message("Koi Pond", 3, SENTENCE_CHECKS_FAILED),
        blocked_message("Koi Pond", "it loads code from another pack."),
        block_message("Koi Pond", "it tries to talk to the app directly, which packs aren't allowed to do."),
        upgrade_block_message("Koi Pond", "it reads its settings in a way that isn't allowed.", "2.1"),
        format_sdk_older_message("Koi Pond"),
        catalog_sdk_contract_error("plugins/src/koi/plugin.yml", {"id": "koi", "name": "Koi"}, 0, 1)["message"],
    ]
    setup = [
        text
        for reason in ("", "esbuild_unresolvable", "lint_prebuilt_missing", "lint_prebuilt_stale")
        for text in (
            format_install_lint_setup_message("Koi Pond", reason),
            format_install_lint_setup_upgrade_message("Koi Pond", 3, reason),
            format_install_lint_setup_upgrade_message("Koi Pond", None, reason),
            str(PackInstallLintSetupError("Koi Pond", reason)),
        )
    ]
    return blocks, setup


def test_no_user_text_carries_a_repo_path_a_file_type_or_a_rule_id() -> None:
    blocks, setup = _every_block_and_setup_text()
    for text in blocks + setup:
        for token in _NOT_IN_USER_TEXT:
            assert token not in text, (token, text)


def test_every_block_says_was_blocked_and_the_setup_refusal_never_does() -> None:
    """plugin_local / plugins branch on the substring "was blocked" (never "was blocked:")."""
    blocks, setup = _every_block_and_setup_text()
    for text in blocks:
        if text == _FIX_TAIL:  # to_dict()["hint"] is the tail on its own
            continue
        assert "was blocked because " in text, text
        assert "was blocked:" not in text and "was blocked." not in text, text
    for text in setup:
        assert text.startswith("Couldn't safety-check"), text
        assert "was blocked" not in text and "blocked" not in text, text
