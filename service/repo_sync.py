"""Periodic ``git pull`` of the install checkout, then bounce backend + UI.

The live monitor runs this on a timer (default 5 min). A fast-forward that
brings new commits rebuilds the packed UI when ``web/`` or ``plugins/src/``
moved, reinstalls Python deps when ``requirements.txt`` moved, queues a
client reload, and detaches ``service.monitor_reload --force`` so systemd or
``scripts/dev.sh`` can recycle this process.

Skip with ``ZOTO_VIZ_NO_AUTO_PULL=1`` or ``ZOTO_VIZ_PULL_S=0``. Dirty trees,
detached HEAD, and missing upstream are no-ops (never reset).
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from . import live
from . import monitor_reload
from . import paths

SKIP_ENV = "ZOTO_VIZ_NO_AUTO_PULL"
INTERVAL_ENV = "ZOTO_VIZ_PULL_S"
DEFAULT_INTERVAL_S = 300.0
STARTUP_DELAY_S = 45.0
PULL_TIMEOUT_S = 60.0
BUILD_TIMEOUT_S = 240.0
RESTART_DELAY_S = 2.0


def interval_s() -> float:
    raw = os.environ.get(INTERVAL_ENV, "").strip()
    if not raw:
        return DEFAULT_INTERVAL_S
    try:
        n = float(raw)
    except ValueError:
        return DEFAULT_INTERVAL_S
    return max(0.0, n)


def startup_delay_s() -> float:
    return min(STARTUP_DELAY_S, interval_s() or STARTUP_DELAY_S)


def disabled() -> bool:
    if os.environ.get(SKIP_ENV, "").strip().lower() in {"1", "true", "yes", "on"}:
        return True
    return interval_s() <= 0


def _run(cmd: list[str], cwd: Path, timeout: float) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd),
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _git(root: Path, *args: str, timeout: float = 12.0) -> subprocess.CompletedProcess[str]:
    return _run(["git", *args], root, timeout)


def is_git_checkout(root: Path) -> bool:
    try:
        r = _git(root, "rev-parse", "--is-inside-work-tree")
    except (OSError, subprocess.TimeoutExpired):
        return False
    return r.returncode == 0 and r.stdout.strip() == "true"


def head(root: Path | None = None) -> str:
    root = root or paths.repo_root()
    try:
        r = _git(root, "rev-parse", "HEAD")
    except (OSError, subprocess.TimeoutExpired):
        return ""
    sha = r.stdout.strip()
    return sha if r.returncode == 0 and len(sha) >= 7 else ""


def _dirty(root: Path) -> bool:
    try:
        r = _git(root, "status", "--porcelain")
    except (OSError, subprocess.TimeoutExpired):
        return True
    if r.returncode != 0:
        return True
    return bool(r.stdout.strip())


def _merging(root: Path) -> bool:
    return (root / ".git" / "MERGE_HEAD").is_file()


def _upstream(root: Path) -> str:
    try:
        r = _git(root, "rev-parse", "--abbrev-ref", "@{upstream}")
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return r.stdout.strip() if r.returncode == 0 else ""


def _changed_files(root: Path, old: str, new: str) -> list[str]:
    if not old or not new or old == new:
        return []
    try:
        r = _git(root, "diff", "--name-only", old, new)
    except (OSError, subprocess.TimeoutExpired):
        return []
    if r.returncode != 0:
        return []
    return [line.strip() for line in r.stdout.splitlines() if line.strip()]


def _venv_python(root: Path) -> str:
    unix = root / ".venv" / "bin" / "python"
    if unix.is_file():
        return str(unix)
    win = root / ".venv" / "Scripts" / "python.exe"
    if win.is_file():
        return str(win)
    return sys.executable


def _needs_web_build(files: list[str]) -> bool:
    return any(name.startswith("web/") or name.startswith("plugins/src/") for name in files)


def _needs_pip(files: list[str]) -> bool:
    return "requirements.txt" in files


def apply_updates(root: Path, files: list[str]) -> dict[str, Any]:
    """Rebuild packed UI / Python deps when the pull touched them."""
    out: dict[str, Any] = {"built": False, "pip": False}
    if _needs_pip(files):
        py = _venv_python(root)
        req = root / "requirements.txt"
        try:
            r = _run([py, "-m", "pip", "install", "-r", str(req)], root, BUILD_TIMEOUT_S)
        except (OSError, subprocess.TimeoutExpired) as e:
            out["pip_error"] = str(e)
        else:
            out["pip"] = r.returncode == 0
            if r.returncode != 0:
                out["pip_error"] = (r.stderr or r.stdout or "").strip() or f"exit {r.returncode}"
    if _needs_web_build(files):
        pnpm = shutil.which("pnpm")
        if not pnpm:
            out["build_error"] = "pnpm not on PATH"
            return out
        try:
            r = _run([pnpm, "--dir", str(root / "web"), "build"], root, BUILD_TIMEOUT_S)
        except (OSError, subprocess.TimeoutExpired) as e:
            out["build_error"] = str(e)
        else:
            out["built"] = r.returncode == 0
            if r.returncode != 0:
                out["build_error"] = (r.stderr or r.stdout or "").strip() or f"exit {r.returncode}"
    return out


def schedule_restart(root: Path, delay_s: float = RESTART_DELAY_S) -> dict[str, Any]:
    """Detach a forced monitor bounce so this process can flush the reload patch."""
    env = os.environ.copy()
    script = (
        f"sleep {max(0.2, float(delay_s))}; "
        f"{sys.executable} -m service.monitor_reload --force"
    )
    try:
        subprocess.Popen(
            ["bash", "-c", script],
            cwd=str(root),
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
        )
    except OSError as e:
        return {"restart": "error", "error": str(e)}
    return {"restart": "scheduled", "delay_s": delay_s}


def pull(root: Path | None = None) -> dict[str, Any]:
    """Fast-forward the install checkout. Never resets or merges."""
    root = (root or paths.repo_root()).resolve()
    info: dict[str, Any] = {"root": str(root), "action": "noop"}
    if disabled():
        info["action"] = "skipped"
        info["reason"] = SKIP_ENV if os.environ.get(SKIP_ENV, "").strip() else INTERVAL_ENV
        return info
    if not is_git_checkout(root):
        info["reason"] = "not a git checkout"
        return info
    if _merging(root):
        info["reason"] = "merge in progress"
        return info
    if _dirty(root):
        info["reason"] = "dirty worktree"
        return info
    upstream = _upstream(root)
    if not upstream:
        info["reason"] = "no upstream"
        return info
    before = head(root)
    info["from"] = before
    info["upstream"] = upstream
    try:
        r = _git(root, "pull", "--ff-only", timeout=PULL_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        info["action"] = "error"
        info["error"] = "git pull timed out"
        return info
    except OSError as e:
        info["action"] = "error"
        info["error"] = str(e)
        return info
    if r.returncode != 0:
        info["action"] = "error"
        info["error"] = (r.stderr or r.stdout or "").strip() or f"exit {r.returncode}"
        return info
    after = head(root)
    info["to"] = after
    if not after or after == before:
        info["action"] = "fresh"
        return info
    info["action"] = "pulled"
    info["files"] = _changed_files(root, before, after)
    global _rev, _rev_at
    _rev = after
    _rev_at = time.monotonic()
    return info


def tick(root: Path | None = None, *, apply: bool = True) -> dict[str, Any]:
    """One pull pass. On a fast-forward: rebuild if needed, reload UI, restart."""
    root = (root or paths.repo_root()).resolve()
    info = pull(root)
    if info.get("action") != "pulled" or not apply:
        return info
    files = list(info.get("files") or [])
    info.update(apply_updates(root, files))
    live.queue_patch({"reloadClient": True})
    info["reloadClient"] = True
    info.update(schedule_restart(root))
    return info


def repo_rev() -> str:
    """Cached HEAD for the 1 Hz snapshot (refreshed after a successful pull)."""
    global _rev, _rev_at
    now = time.monotonic()
    if _rev and now - _rev_at < 30.0:
        return _rev
    _rev = head()
    _rev_at = now
    return _rev


_rev = ""
_rev_at = 0.0
