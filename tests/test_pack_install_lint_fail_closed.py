"""#185: the pack install lint fails closed (service side).

bundle-pack-entry.mjs refuses an install with exit 3 and a ``pack-install-lint-setup-error`` line
when the install lint can't run or gives no verdict. The service maps that (and its own timeout)
to PackInstallLintSetupError with the user-facing wording, keeps a real lint block's existing
"was blocked" message, and accepts only exit 0 whose LAST stderr line is exactly
``{"type":"pack-install-lint-pass","nonce":<the service's per-run nonce>,"pack":<id>}``.
Unbundled (``frontend.bundle: false``) and no-frontend packs go through the same gate
(``bundle-pack-entry.mjs --lint-only``).

The install rows run the real bundle-pack-entry.mjs; the "unresolvable" rows point the repo root at a
temp tree that has no tsx, so the lint runner really can't be resolved.
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
SETUP_TAIL = ", so it wasn't installed. Run `pnpm install` in `web/` and try again."
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


def _assert_plain_block_text(text: str) -> None:
    """#185 UX: after "<Name> was blocked:" only plain words; raw findings stay in the log."""
    for rule in _RULE_IDS:
        assert rule not in text, (rule, text)
    assert "parent" not in text and "plugins/src/" not in text.replace("plugins/sdk/starter", ""), text
    assert not re.search(r":\d", text), text


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
    assert format_install_lint_setup_message("Star Sines") == (
        "Couldn't safety-check Star Sines, so it wasn't installed. Run `pnpm install` in `web/` and try again."
    )
    assert format_install_lint_setup_message("") == f"Couldn't safety-check Plugin{SETUP_TAIL}"


def test_compile_maps_lint_setup_exit_to_setup_error(monkeypatch: pytest.MonkeyPatch) -> None:
    doc = _pulse_doc()
    setup = json.dumps({"type": "pack-install-lint-setup-error", "message": "x", "detail": "tsx not resolvable"})
    _stub_bundle(monkeypatch, EXIT_LINT_SETUP, f"Couldn't safety-check Pulse TS\n{setup}\n")
    plugins.reset_bundles()
    with pytest.raises(PackInstallLintSetupError) as e:
        plugins.compile_typescript(doc, PULSE, update_cache=False, install_lint=True)
    assert str(e.value) == f"Couldn't safety-check Pulse TS{SETUP_TAIL}"
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
    assert text.startswith("Pulse TS was blocked: it tries to reach outside its sandbox. Nothing was installed")
    _assert_plain_block_text(text)
    assert "Nothing was installed and the current wall is unchanged." in text
    setup = format_install_lint_setup_message("Pulse TS")
    assert setup not in text and text not in setup
    assert "safety-check" not in text and "pnpm install" not in text
    assert "was blocked" not in setup


# --- install path through the real bundle-pack-entry.mjs, tsx really unresolvable --------------


def _repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    return repo


def _tree_without_tsx(tmp_path: Path) -> Path:
    """Repo root for bundle-pack-entry.mjs: web/package.json, the lint runner, plugins/sdk; no tsx."""
    tree = tmp_path / "tree-no-tsx"
    (tree / "web" / "scripts").mkdir(parents=True)
    (tree / "plugins").mkdir(parents=True)
    shutil.copy2(ROOT / "web" / "package.json", tree / "web" / "package.json")
    shutil.copy2(ROOT / "web" / "scripts" / "pack-install-lint-run.ts", tree / "web" / "scripts" / "pack-install-lint-run.ts")
    os.symlink(ROOT / "plugins" / "sdk", tree / "plugins" / "sdk")
    assert not (tree / "web" / "node_modules").exists()
    return tree


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


def test_install_local_zip_refused_when_lint_runner_unresolvable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    monkeypatch.setattr(plugins, "REPO", _tree_without_tsx(tmp_path))
    plugins.reset_bundles()
    out = plugin_local.install_local_zip(_probe(tmp_path, 1), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("error") == REASON_INSTALL_CHECK_UNAVAILABLE, out
    assert out.get("message") == f"Couldn't safety-check Upgrade Probe{SETUP_TAIL}"
    assert not (paths.plugin_local_runtime_dir(create=True) / "upgrade-probe").exists()


def test_upgrade_refused_when_lint_runner_unresolvable_keeps_v1(
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
    monkeypatch.setattr(plugins, "REPO", _tree_without_tsx(tmp_path))
    plugins.reset_bundles()
    out = plugin_local.install_local_zip(_probe(tmp_path, 2), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("error") == REASON_INSTALL_CHECK_UNAVAILABLE, out
    assert out.get("message") == (
        "Couldn't safety-check the new version of Upgrade Probe, so it wasn't updated. "
        "You're still on v1. Run `pnpm install` in `web/` and try again."
    )
    assert out.get("message") == format_install_lint_setup_upgrade_message("Upgrade Probe", 1)
    assert "was blocked" not in str(out.get("message"))
    assert "version: 1" in (runtime / "plugin.yml").read_text(encoding="utf-8"), "v1 is still installed"


# --- runner / service timeouts -----------------------------------------------------------------


def test_default_lint_timeout_is_15s_and_below_the_service_timeout() -> None:
    gate = (ROOT / "web" / "scripts" / "pack-install-lint-gate.mjs").as_uri()
    js = subprocess.run(
        ["node", "--input-type=module", "-e", f"import({json.dumps(gate)}).then((m) => console.log(m.DEFAULT_LINT_TIMEOUT_MS))"],
        capture_output=True, text=True, check=True, timeout=30,
    )
    assert int(js.stdout.strip()) == 15000 and int(js.stdout.strip()) < plugins.PACK_BUNDLE_TIMEOUT_S * 1000 == 20000


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
    assert str(e.value) == f"Couldn't safety-check Pulse TS{SETUP_TAIL}"
    for pid in (int(p) for p in pids.read_text().split()):
        assert _gone(pid), f"pid {pid} left running after the service timeout"
    _repo(tmp_path, monkeypatch)
    out = plugin_local.install_local_zip(_probe(tmp_path, 1), overwrite=True)
    assert out.get("error") == REASON_INSTALL_CHECK_UNAVAILABLE, out
    assert out.get("message") == f"Couldn't safety-check Upgrade Probe{SETUP_TAIL}"


def test_service_timeout_while_the_lint_runner_hangs_takes_the_runner_group_down(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Real bundle-pack-entry.mjs, real tsx, a runner that hangs (and ignores SIGTERM) under the
    15 s runner timeout; the service's shorter timeout here must still leave no runner behind."""
    _needs_node_tree()
    if not (ROOT / "web" / "node_modules" / "tsx").exists():
        pytest.skip("tsx not installed")
    pids = tmp_path / "runner.pids"
    tree = _tree_without_tsx(tmp_path)
    (tree / "web" / "node_modules").mkdir()
    os.symlink((ROOT / "web" / "node_modules" / "tsx").resolve(), tree / "web" / "node_modules" / "tsx")
    (tree / "web" / "scripts" / "pack-install-lint-run.ts").write_text(
        "import { appendFileSync } from 'node:fs';\n"
        "process.on('SIGTERM', () => {});\n"
        f"appendFileSync({json.dumps(str(pids))}, `${{process.pid}} ${{process.ppid}}\\n`);\n"
        "setInterval(() => {}, 1000);\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(plugins, "REPO", tree)
    monkeypatch.setattr(plugins, "PACK_BUNDLE_TIMEOUT_S", 4)
    doc = _pulse_doc()
    plugins.reset_bundles()
    with pytest.raises(PackInstallLintSetupError) as e:
        plugins.compile_typescript(doc, PULSE, update_cache=False, install_lint=True)
    assert str(e.value) == f"Couldn't safety-check Pulse TS{SETUP_TAIL}"
    assert pids.is_file(), "the runner really started and hung before the service timeout"
    for pid in (int(p) for p in pids.read_text().split()):
        assert _gone(pid), f"lint runner pid {pid} left running after the service timeout"


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
    assert text.startswith("Sandbox Fixture Multi was blocked: "), out
    assert text.startswith("Sandbox Fixture Multi was blocked: it tries to reach outside its sandbox. "), out
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


def test_no_frontend_pack_is_refused_when_the_runner_is_unresolvable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    monkeypatch.setattr(plugins, "REPO", _tree_without_tsx(tmp_path))
    plugins.reset_bundles()
    out = plugin_local.install_local_zip(_shipped_zip(tmp_path, "cores"), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("error") == REASON_INSTALL_CHECK_UNAVAILABLE, out
    assert out.get("message") == f"Couldn't safety-check CPU cores{SETUP_TAIL}"


def test_koi_pond_block_is_plain_words_and_the_raw_findings_are_logged(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Real pack, real runner, the service's install-lint check (verify_pack_bundle_home, what the
    zip install's staging checks call): koi-pond has baselined `parent.` findings, so it's blocked.
    (koi-pond itself can't be shared as a zip — its .glb assets are disallowed — so no zip here.)"""
    _needs_node_tree()
    home = tmp_path / "koi-pond"
    shutil.copytree(ROOT / "plugins" / "src" / "koi-pond", home, symlinks=True, ignore=shutil.ignore_patterns("node_modules"))
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
        "Koi Pond was blocked: it tries to reach outside its sandbox. "
        "Nothing was installed and the current wall is unchanged. "
        "Ask the pack author to run pack lint — see plugins/sdk/starter/README.md#2-pack-lint."
    ), text
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
    monkeypatch.setattr(plugins, "REPO", _tree_without_tsx(tmp_path))
    plugins.reset_bundles()
    upgrade_msg = str(plugin_local.install_local_zip(_probe(tmp_path, 2), overwrite=True).get("message"))
    fresh_msg = str(plugin_local.install_local_zip(_shipped_zip(tmp_path, "cores"), overwrite=True).get("message"))
    assert fresh_msg == f"Couldn't safety-check CPU cores{SETUP_TAIL}"
    assert upgrade_msg.startswith("Couldn't safety-check the new version of Upgrade Probe")
    for setup in (fresh_msg, upgrade_msg):
        assert setup not in block_msg and block_msg not in setup
        for token in ("was blocked", "sandbox-escape", "indexedDB", "Nothing was installed", "pack lint"):
            assert token not in setup, (token, setup)
        for token in ("safety-check", "pnpm install", "wasn't installed", "wasn't updated", "still on v"):
            assert token not in block_msg, (token, block_msg)
    assert fresh_msg != upgrade_msg and fresh_msg not in upgrade_msg and upgrade_msg not in fresh_msg
