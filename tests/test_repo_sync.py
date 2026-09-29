from __future__ import annotations

import json
import subprocess
import threading
import time
from pathlib import Path

from service import live
from service import repo_sync as rs


def test_disabled_by_env(monkeypatch) -> None:
    monkeypatch.setenv(rs.SKIP_ENV, "1")
    assert rs.disabled() is True
    info = rs.pull(Path("/tmp"))
    assert info["action"] == "skipped"


def test_interval_zero_disables(monkeypatch) -> None:
    monkeypatch.delenv(rs.SKIP_ENV, raising=False)
    monkeypatch.setenv(rs.INTERVAL_ENV, "0")
    assert rs.disabled() is True
    assert rs.interval_s() == 0.0


def test_interval_default(monkeypatch) -> None:
    monkeypatch.delenv(rs.SKIP_ENV, raising=False)
    monkeypatch.delenv(rs.INTERVAL_ENV, raising=False)
    assert rs.disabled() is False
    assert rs.interval_s() == rs.DEFAULT_INTERVAL_S


def test_needs_web_and_pip() -> None:
    assert rs._needs_web_build(["web/src/app/main.ts"])
    assert rs._needs_web_build(["plugins/src/syscon/plugin.yml"])
    assert not rs._needs_web_build(["docs/install.md"])
    assert rs._needs_pip(["requirements.txt", "README.md"])
    assert not rs._needs_pip(["service/live.py"])


def test_pull_skips_non_git(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv(rs.SKIP_ENV, raising=False)
    monkeypatch.delenv(rs.INTERVAL_ENV, raising=False)
    monkeypatch.setattr(rs, "is_git_checkout", lambda root: False)
    info = rs.pull(tmp_path)
    assert info["action"] == "noop"
    assert info["reason"] == "not a git checkout"


def test_pull_skips_dirty(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv(rs.SKIP_ENV, raising=False)
    monkeypatch.delenv(rs.INTERVAL_ENV, raising=False)
    monkeypatch.setattr(rs, "is_git_checkout", lambda root: True)
    monkeypatch.setattr(rs, "_merging", lambda root: False)
    monkeypatch.setattr(rs, "_dirty", lambda root: True)
    info = rs.pull(tmp_path)
    assert info["reason"] == "dirty worktree"


def test_tick_reloads_and_schedules_restart(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv(rs.SKIP_ENV, raising=False)
    monkeypatch.delenv(rs.INTERVAL_ENV, raising=False)
    live.reset_for_tests()
    monkeypatch.setattr(rs, "pull", lambda root=None: {
        "action": "pulled",
        "from": "aaa",
        "to": "bbb",
        "files": ["docs/install.md"],
    })
    monkeypatch.setattr(rs, "apply_updates", lambda root, files: {"built": False, "pip": False})
    scheduled: list[Path] = []
    monkeypatch.setattr(rs, "schedule_restart", lambda root, delay_s=rs.RESTART_DELAY_S, hold_fd=None: (
        scheduled.append(root) or {"restart": "scheduled", "delay_s": delay_s}
    ))
    info = rs.tick(tmp_path)
    assert info["action"] == "pulled"
    assert info["reloadClient"] is True
    assert info["restart"] == "scheduled"
    assert scheduled == [tmp_path.resolve()]
    snap = live.snapshot()
    assert snap["patch"]["reloadClient"] is True


def test_tick_fresh_does_not_restart(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(rs, "pull", lambda root=None: {"action": "fresh", "from": "aaa", "to": "aaa"})
    called = []
    monkeypatch.setattr(rs, "schedule_restart", lambda *a, **k: called.append(1))
    info = rs.tick(tmp_path)
    assert info["action"] == "fresh"
    assert called == []


def _exe(path: Path, body: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\n" + body + "\n", encoding="utf-8")
    path.chmod(0o755)
    return path


def _repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    (root / "web" / "dist").mkdir(parents=True)
    (root / "web" / "dist" / "index.html").write_text("old", encoding="utf-8")
    (root / ".nvmrc").write_text("22\n", encoding="utf-8")
    (root / "web" / "package.json").write_text('{"engines": {"node": ">=22.12.0"}}', encoding="utf-8")
    return root


def _nvm(tmp_path: Path, monkeypatch, *versions: str) -> Path:
    nvm = tmp_path / "nvm"
    for v in versions:
        _exe(nvm / "versions" / "node" / v / "bin" / "node", f"echo {v}")
    monkeypatch.setenv("NVM_DIR", str(nvm))
    return nvm


def _path_node(tmp_path: Path, monkeypatch, version: str) -> None:
    bin_dir = tmp_path / "pathbin"
    _exe(bin_dir / "node", f"echo {version}")
    monkeypatch.setenv("PATH", f"{bin_dir}:/usr/bin:/bin")


def test_find_node_prefers_nvmrc_major_over_old_path_node(monkeypatch, tmp_path: Path) -> None:
    """zoto's first node is nvm v18, which breaks rolldown; the build must use the newest fitting 22."""
    root = _repo(tmp_path)
    nvm = _nvm(tmp_path, monkeypatch, "v18.20.2", "v22.11.0", "v22.23.2", "v24.1.0")
    _path_node(tmp_path, monkeypatch, "v18.20.2")
    node_bin, why = rs.find_node(root)
    assert why == ""
    assert node_bin == nvm / "versions" / "node" / "v22.23.2" / "bin"


def test_find_node_explains_when_nothing_fits(monkeypatch, tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _nvm(tmp_path, monkeypatch, "v18.20.2")
    _path_node(tmp_path, monkeypatch, "v18.20.2")
    node_bin, why = rs.find_node(root)
    assert node_bin is None
    assert "Node 22 (>= 22.12.0)" in why and "v18.20.2 on PATH" in why


def test_find_node_accepts_fitting_path_node(monkeypatch, tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _nvm(tmp_path, monkeypatch)
    _path_node(tmp_path, monkeypatch, "v22.12.0")
    node_bin, why = rs.find_node(root)
    assert why == "" and node_bin == tmp_path / "pathbin"


def _pnpm(nvm: Path, version: str, body: str) -> Path:
    log = nvm.parent / "pnpm.log"
    return _exe(
        nvm / "versions" / "node" / version / "bin" / "pnpm",
        f'echo "$(node --version) $*" >> {log}\n' + body,
    )


def test_build_web_swaps_dist_only_after_success(monkeypatch, tmp_path: Path) -> None:
    root = _repo(tmp_path)
    nvm = _nvm(tmp_path, monkeypatch, "v18.20.2", "v22.23.2")
    _path_node(tmp_path, monkeypatch, "v18.20.2")
    _pnpm(nvm, "v22.23.2", f'case "$*" in *build*) mkdir -p {root}/web/dist.next && echo new > {root}/web/dist.next/index.html;; esac')
    out = rs.build_web(root, install=True)
    assert out["built"] is True, out
    assert (root / "web" / "dist" / "index.html").read_text().strip() == "new"
    assert not (root / "web" / "dist.next").exists() and not (root / "web" / "dist.prev").exists()
    calls = (tmp_path / "pnpm.log").read_text().splitlines()
    assert calls[0].startswith("v22.23.2 ") and "install --frozen-lockfile" in calls[0]
    assert calls[1].startswith("v22.23.2 ") and calls[1].endswith("build --outDir dist.next --emptyOutDir")


def test_build_web_failure_keeps_old_dist_and_reports(monkeypatch, tmp_path: Path) -> None:
    root = _repo(tmp_path)
    nvm = _nvm(tmp_path, monkeypatch, "v22.23.2")
    _pnpm(nvm, "v22.23.2", f"mkdir -p {root}/web/dist.next; echo 'SyntaxError: styleText' >&2; exit 1")
    out = rs.build_web(root)
    assert out["built"] is False
    assert "build exit 1" in out["build_error"] and "styleText" in out["build_error"]
    assert (root / "web" / "dist" / "index.html").read_text() == "old"
    assert not (root / "web" / "dist.next").exists()


def test_build_web_without_fitting_node_never_runs_pnpm(monkeypatch, tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _nvm(tmp_path, monkeypatch, "v18.20.2")
    _path_node(tmp_path, monkeypatch, "v18.20.2")
    out = rs.build_web(root)
    assert out["built"] is False and "needs Node 22" in out["build_error"]
    assert (root / "web" / "dist" / "index.html").read_text() == "old"


def test_apply_updates_installs_only_when_lockfile_moves(monkeypatch, tmp_path: Path) -> None:
    seen: list[bool] = []
    monkeypatch.setattr(rs, "build_web", lambda root, install=False: seen.append(install) or {"built": True})
    rs.apply_updates(tmp_path, ["web/src/ui/media-ask.ts"])
    rs.apply_updates(tmp_path, ["web/pnpm-lock.yaml", "web/src/app/main.ts"])
    rs.apply_updates(tmp_path, ["service/monitor.py"])
    assert seen == [False, True]


def test_tick_records_failed_build_in_status_file(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(rs.paths, "user_dir", lambda: tmp_path / "home")
    monkeypatch.setattr(rs, "pull", lambda root=None: {"action": "pulled", "from": "a" * 40, "to": "b" * 40, "files": ["web/x.ts"]})
    monkeypatch.setattr(rs, "apply_updates", lambda root, files: {"built": False, "pip": False, "build_error": "build exit 1: boom"})
    monkeypatch.setattr(rs, "schedule_restart", lambda root, delay_s=rs.RESTART_DELAY_S, hold_fd=None: {"restart": "scheduled"})
    monkeypatch.setattr(rs.live, "queue_patch", lambda patch: patch)
    info = rs.tick(tmp_path)
    assert info["build_error"] == "build exit 1: boom"
    status = json.loads((tmp_path / "home" / "repo-sync.json").read_text())
    assert status["ok"] is False and status["build_error"] == "build exit 1: boom" and status["to"] == "b" * 40


# --- single updater: fetch + merge --ff-only under a .git flock ---------------------------------


def _g(cwd: Path, *args: str) -> str:
    r = subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True, check=True)
    return r.stdout.strip()


def _origin_and_install(tmp_path: Path) -> tuple[Path, Path]:
    """A bare origin, an install clone tracking origin/main, and one new origin commit touching web/."""
    origin = tmp_path / "origin.git"
    seed = tmp_path / "seed"
    install = tmp_path / "install"
    _g(tmp_path, "init", "-q", "--bare", "-b", "main", str(origin))
    _g(tmp_path, "clone", "-q", str(origin), str(seed))
    for repo in (seed,):
        _g(repo, "config", "user.email", "t@example.invalid")
        _g(repo, "config", "user.name", "t")
    (seed / "web").mkdir()
    (seed / "web" / "a.ts").write_text("1\n", encoding="utf-8")
    _g(seed, "add", "-A")
    _g(seed, "commit", "-q", "-m", "one")
    _g(seed, "push", "-q", "origin", "HEAD:main")
    _g(tmp_path, "clone", "-q", "-b", "main", str(origin), str(install))
    (seed / "web" / "a.ts").write_text("2\n", encoding="utf-8")
    _g(seed, "commit", "-q", "-am", "two")
    _g(seed, "push", "-q", "origin", "HEAD:main")
    return origin, install


def _quiet_side_effects(monkeypatch, tmp_path: Path, builds: list[str], restarts: list[int | None]) -> None:
    monkeypatch.delenv(rs.SKIP_ENV, raising=False)
    monkeypatch.delenv(rs.INTERVAL_ENV, raising=False)
    monkeypatch.setattr(rs.paths, "user_dir", lambda: tmp_path / "home")
    monkeypatch.setattr(rs.live, "queue_patch", lambda patch: patch)
    monkeypatch.setattr(rs, "build_web", lambda root, install=False: builds.append(str(root)) or {"built": True})
    monkeypatch.setattr(rs, "schedule_restart", lambda root, delay_s=rs.RESTART_DELAY_S, hold_fd=None: (
        restarts.append(hold_fd) or {"restart": "scheduled"}
    ))


def test_two_updaters_within_one_second_build_once_and_land_origin_main(monkeypatch, tmp_path: Path) -> None:
    """Row: two passes fire together. 0 git errors, 1 rebuild, HEAD == origin/main, no bare pull.

    The first pass is held inside its merge until the second pass has finished, so without the
    lock the second fast-forwards and builds too (2 builds), and the first then reports a second
    "pulled" for the same range.
    """
    origin, install = _origin_and_install(tmp_path)
    builds: list[str] = []
    restarts: list[int | None] = []
    _quiet_side_effects(monkeypatch, tmp_path, builds, restarts)
    real_git = rs._git
    calls: list[tuple[str, ...]] = []
    second_done = threading.Event()
    holder: dict[str, threading.Thread] = {}

    def git(root: Path, *args: str, timeout: float = 12.0):
        calls.append(args)
        if args[:1] == ("merge",) and threading.current_thread() is holder.get("first"):
            second_done.wait(5)
        return real_git(root, *args, timeout=timeout)

    monkeypatch.setattr(rs, "_git", git)
    results: dict[str, dict] = {}

    def run(name: str) -> None:
        results[name] = rs.tick(install)
        if name == "second":
            second_done.set()

    t1 = threading.Thread(target=run, args=("first",))
    holder["first"] = t1
    t1.start()
    deadline = time.monotonic() + 10
    while not any(a[:1] == ("merge",) for a in calls) and time.monotonic() < deadline:
        time.sleep(0.01)
    assert any(a[:1] == ("merge",) for a in calls), f"first pass never reached merge --ff-only: {calls}"
    t2 = threading.Thread(target=run, args=("second",))
    t2.start()
    t1.join(10)
    t2.join(10)

    actions = sorted(r["action"] for r in results.values())
    assert actions == ["busy", "pulled"], results
    assert not [r for r in results.values() if r["action"] == "error"]
    assert len(builds) == 1
    assert _g(install, "rev-parse", "HEAD") == _g(origin, "rev-parse", "main")
    assert not [a for a in calls if a[:1] == ("pull",)]
    assert ("merge", "--ff-only", "--quiet", "refs/remotes/origin/main") in calls
    assert len(restarts) == 1 and restarts[0] is not None


def test_pull_uses_fetch_then_ff_only_merge_of_tracking_ref(monkeypatch, tmp_path: Path) -> None:
    origin, install = _origin_and_install(tmp_path)
    monkeypatch.delenv(rs.SKIP_ENV, raising=False)
    monkeypatch.delenv(rs.INTERVAL_ENV, raising=False)
    real_git = rs._git
    calls: list[tuple[str, ...]] = []
    monkeypatch.setattr(rs, "_git", lambda root, *a, timeout=12.0: calls.append(a) or real_git(root, *a, timeout=timeout))
    # A stray multi-branch FETCH_HEAD (what a sidecar `git fetch origin` leaves) must not be merged.
    (install / ".git" / "FETCH_HEAD").write_text(
        "1111111111111111111111111111111111111111\t\tbranch 'main' of x\n"
        "2222222222222222222222222222222222222222\t\tbranch 'other' of x\n",
        encoding="utf-8",
    )
    info = rs.pull(install)
    assert info["action"] == "pulled" and info["upstream"] == "origin/main", info
    assert info["files"] == ["web/a.ts"]
    net = [a[0] for a in calls if a[:1] in (("fetch",), ("merge",), ("pull",))]
    assert net == ["fetch", "merge"]
    assert calls[[a[0] for a in calls].index("fetch")] == (
        "fetch", "--quiet", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main",
    )
    assert _g(install, "rev-parse", "HEAD") == _g(origin, "rev-parse", "main")


def test_lock_held_makes_pass_do_nothing(monkeypatch, tmp_path: Path) -> None:
    _, install = _origin_and_install(tmp_path)
    builds: list[str] = []
    restarts: list[int | None] = []
    _quiet_side_effects(monkeypatch, tmp_path, builds, restarts)
    fd, ok = rs.acquire_lock(install)
    assert ok and fd is not None
    assert rs.lock_path(install) == (install / ".git" / rs.LOCK_NAME).resolve()
    real_git = rs._git
    calls: list[tuple[str, ...]] = []
    monkeypatch.setattr(rs, "_git", lambda root, *a, timeout=12.0: calls.append(a) or real_git(root, *a, timeout=timeout))
    try:
        info = rs.tick(install)
    finally:
        import os
        os.close(fd)
    assert info["action"] == "busy"
    assert not [a for a in calls if a[:1] in (("fetch",), ("merge",), ("pull",))]
    assert builds == [] and restarts == []
    after = rs.tick(install)
    assert after["action"] == "pulled" and len(builds) == 1


def test_lock_stays_held_until_detached_restart_has_run(monkeypatch, tmp_path: Path) -> None:
    """The bounce inherits the lock: a pass started before the restart finishes is busy, after it is fresh."""
    _, install = _origin_and_install(tmp_path)
    monkeypatch.delenv(rs.SKIP_ENV, raising=False)
    monkeypatch.delenv(rs.INTERVAL_ENV, raising=False)
    monkeypatch.setattr(rs.paths, "user_dir", lambda: tmp_path / "home")
    monkeypatch.setattr(rs.live, "queue_patch", lambda patch: patch)
    monkeypatch.setattr(rs, "build_web", lambda root, install=False: {"built": True})
    marker = tmp_path / "restarted"
    monkeypatch.setattr(rs, "_restart_script", lambda delay_s: f"sleep 1; touch {marker}")
    info = rs.tick(install)
    assert info["action"] == "pulled" and info["restart"] == "scheduled"
    assert rs.tick(install)["action"] == "busy"
    deadline = time.monotonic() + 10
    while not marker.exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    assert marker.exists()
    for _ in range(100):
        again = rs.tick(install)
        if again["action"] != "busy":
            break
        time.sleep(0.05)
    assert again["action"] == "fresh"
