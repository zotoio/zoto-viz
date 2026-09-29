"""Periodic ``git pull`` of the install checkout, then bounce backend + UI.

The live monitor runs this on a timer (default 5 min). A fast-forward that
brings new commits rebuilds the packed UI when ``web/`` or ``plugins/src/``
moved (with the Node version from ``.nvmrc``, into a side folder that only
replaces ``web/dist`` when the build succeeds), reinstalls Python deps when ``requirements.txt`` moved, queues a
client reload, and detaches ``service.monitor_reload --force`` so systemd or
``scripts/dev.sh`` can recycle this process.

Skip with ``ZOTO_VIZ_NO_AUTO_PULL=1`` or ``ZOTO_VIZ_PULL_S=0``. Dirty trees,
detached HEAD, and missing upstream are no-ops (never reset).

This is the only updater for a checkout. A pass fetches just the upstream
branch into its remote-tracking ref and ``merge --ff-only``s that ref (never a
bare ``git pull``, which merges whatever ``FETCH_HEAD`` holds). It holds an
exclusive ``flock`` on ``<git dir>/zoto-viz-sync.lock`` from the fetch through
the restart: the detached restart inherits the lock, so a second pass that
starts before the bounce finishes reports ``busy`` instead of pulling or
building again. One manual pass: ``python -m service.repo_sync``.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

try:
    import fcntl
except ImportError:  # Windows: no flock; a single monitor process is the only puller there.
    fcntl = None  # type: ignore[assignment]

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
LOCK_NAME = "zoto-viz-sync.lock"


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


def _upstream_parts(root: Path) -> tuple[str, str, str]:
    """(remote, branch, tracking ref) for HEAD's upstream, e.g. ("origin", "main", "refs/remotes/origin/main").

    Empty strings when HEAD is detached, the upstream is local (``.``), or anything is missing.
    """
    try:
        cur = _git(root, "symbolic-ref", "--quiet", "--short", "HEAD")
        if cur.returncode != 0 or not cur.stdout.strip():
            return "", "", ""
        branch = cur.stdout.strip()
        remote = _git(root, "config", f"branch.{branch}.remote").stdout.strip()
        merge = _git(root, "config", f"branch.{branch}.merge").stdout.strip()
        tracking = _git(root, "rev-parse", "--symbolic-full-name", "@{upstream}")
    except (OSError, subprocess.TimeoutExpired):
        return "", "", ""
    ref = tracking.stdout.strip() if tracking.returncode == 0 else ""
    if not remote or remote == "." or not merge.startswith("refs/heads/") or not ref.startswith("refs/remotes/"):
        return "", "", ""
    return remote, merge[len("refs/heads/"):], ref


def lock_path(root: Path) -> Path | None:
    """``<git dir>/zoto-viz-sync.lock`` (works for worktrees, where ``.git`` is a file). None off a checkout."""
    try:
        r = _git(root, "rev-parse", "--absolute-git-dir")
    except (OSError, subprocess.TimeoutExpired):
        return None
    d = r.stdout.strip()
    return Path(d) / LOCK_NAME if r.returncode == 0 and d else None


def acquire_lock(root: Path) -> tuple[int | None, bool]:
    """(fd, ok). ok=False means another pass holds the lock. fd is None when locking isn't possible here."""
    path = lock_path(root)
    if path is None or fcntl is None:
        return None, True
    try:
        fd = os.open(str(path), os.O_RDWR | os.O_CREAT, 0o644)
    except OSError:
        return None, True
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        return None, False
    return fd, True


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


def _needs_web_install(files: list[str]) -> bool:
    return any(name in {"web/package.json", "web/pnpm-lock.yaml", "pnpm-lock.yaml"} for name in files)


def _needs_pip(files: list[str]) -> bool:
    return "requirements.txt" in files


def _version(text: str) -> tuple[int, ...]:
    """``v22.23.2`` / ``22.12`` / ``22`` -> (22, 23, 2) / (22, 12) / (22,). Empty when unparsable."""
    m = re.match(r"\s*v?(\d+(?:\.\d+){0,2})", text or "")
    return tuple(int(x) for x in m.group(1).split(".")) if m else ()


def node_requirement(root: Path) -> tuple[int | None, tuple[int, ...]]:
    """(major from ``.nvmrc``, minimum from ``web/package.json`` engines.node ``>=x.y.z``)."""
    major: int | None = None
    try:
        want = _version((root / ".nvmrc").read_text(encoding="utf-8"))
        major = want[0] if want else None
    except OSError:
        pass
    minimum: tuple[int, ...] = ()
    try:
        engines = json.loads((root / "web" / "package.json").read_text(encoding="utf-8")).get("engines") or {}
        m = re.search(r">=\s*v?([\d.]+)", str(engines.get("node") or ""))
        minimum = _version(m.group(1)) if m else ()
    except (OSError, ValueError, AttributeError):
        pass
    return major, minimum


def _fits(version: tuple[int, ...], major: int | None, minimum: tuple[int, ...]) -> bool:
    if not version:
        return False
    if major is not None and version[0] != major:
        return False
    return version >= minimum


def _node_version(node: Path) -> tuple[int, ...]:
    try:
        r = _run([str(node), "--version"], node.parent, 10.0)
    except (OSError, subprocess.TimeoutExpired):
        return ()
    return _version(r.stdout) if r.returncode == 0 else ()


def _nvm_dir() -> Path:
    return Path(os.environ.get("NVM_DIR") or (Path.home() / ".nvm"))


def find_node(root: Path) -> tuple[Path | None, str]:
    """Pick the Node bin dir the web build needs: newest nvm install that fits, else PATH ``node`` if it fits.

    The monitor runs under systemd or a login shell whose first ``node`` is often an old nvm default, and
    the build dies inside rolldown under Node 18. Returns (bin dir, "") or (None, reason).
    """
    major, minimum = node_requirement(root)
    found: list[tuple[tuple[int, ...], Path]] = []
    versions = _nvm_dir() / "versions" / "node"
    if versions.is_dir():
        for d in versions.iterdir():
            v = _version(d.name)
            if (d / "bin" / "node").is_file() and _fits(v, major, minimum):
                found.append((v, d / "bin"))
    if found:
        return max(found)[1], ""
    on_path = shutil.which("node")
    have = _node_version(Path(on_path)) if on_path else ()
    if on_path and _fits(have, major, minimum):
        return Path(on_path).parent, ""
    need = f"Node {major}" if major is not None else "Node"
    if minimum:
        need += f" (>= {'.'.join(map(str, minimum))})"
    seen = f"v{'.'.join(map(str, have))} on PATH" if have else "no node on PATH"
    return None, f"web build needs {need}; found {seen} and no matching nvm install under {versions}"


def _pnpm(node_bin: Path) -> str | None:
    local = node_bin / "pnpm"
    if local.is_file():
        return str(local)
    return shutil.which("pnpm")


def _tail(text: str, lines: int = 12) -> str:
    return "\n".join((text or "").strip().splitlines()[-lines:])


def build_web(root: Path, *, install: bool = False) -> dict[str, Any]:
    """Build the packed UI with the right Node into ``web/dist.next``; swap into ``web/dist`` only on success.

    A failed build leaves the previous ``web/dist`` serving and returns ``build_error``.
    """
    web_dir = root / "web"
    node_bin, why = find_node(root)
    if node_bin is None:
        return {"built": False, "build_error": why}
    pnpm = _pnpm(node_bin)
    if not pnpm:
        return {"built": False, "build_error": f"pnpm not found next to {node_bin / 'node'} or on PATH"}
    env = os.environ.copy()
    env["PATH"] = f"{node_bin}{os.pathsep}{env.get('PATH', '')}"
    out: dict[str, Any] = {"built": False, "node": str(node_bin / "node")}
    staged = web_dir / "dist.next"
    shutil.rmtree(staged, ignore_errors=True)
    steps: list[list[str]] = []
    if install:
        steps.append([pnpm, "--dir", str(web_dir), "install", "--frozen-lockfile"])
    # `pnpm build` ends in `vite build`, so the extra flags land on vite.
    steps.append([pnpm, "--dir", str(web_dir), "build", "--outDir", "dist.next", "--emptyOutDir"])
    for cmd in steps:
        try:
            r = subprocess.run(cmd, cwd=str(root), check=False, capture_output=True, text=True,
                               timeout=BUILD_TIMEOUT_S, env=env)
        except (OSError, subprocess.TimeoutExpired) as e:
            shutil.rmtree(staged, ignore_errors=True)
            out["build_error"] = f"{cmd[3]}: {e}"
            return out
        if r.returncode != 0:
            shutil.rmtree(staged, ignore_errors=True)
            out["build_error"] = f"{cmd[3]} exit {r.returncode}: " + _tail(r.stderr or r.stdout)
            return out
    if not (staged / "index.html").is_file():
        shutil.rmtree(staged, ignore_errors=True)
        out["build_error"] = "build finished without web/dist.next/index.html"
        return out
    dist = web_dir / "dist"
    old = web_dir / "dist.prev"
    shutil.rmtree(old, ignore_errors=True)
    try:
        if dist.exists():
            dist.rename(old)
        staged.rename(dist)
    except OSError as e:
        if old.exists() and not dist.exists():
            old.rename(dist)
        out["build_error"] = f"swap into web/dist failed: {e}"
        return out
    shutil.rmtree(old, ignore_errors=True)
    out["built"] = True
    return out


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
        out.update(build_web(root, install=_needs_web_install(files)))
    return out


def _restart_script(delay_s: float) -> str:
    return f"sleep {max(0.2, float(delay_s))}; {sys.executable} -m service.monitor_reload --force"


def schedule_restart(root: Path, delay_s: float = RESTART_DELAY_S, *, hold_fd: int | None = None) -> dict[str, Any]:
    """Detach a forced monitor bounce so this process can flush the reload patch.

    ``hold_fd`` is the sync lock: the detached bounce inherits it, so the lock stays held until the
    restart has run, not just until this pass returns.
    """
    env = os.environ.copy()
    try:
        subprocess.Popen(
            ["bash", "-c", _restart_script(delay_s)],
            cwd=str(root),
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
            pass_fds=(hold_fd,) if hold_fd is not None else (),
        )
    except OSError as e:
        return {"restart": "error", "error": str(e)}
    return {"restart": "scheduled", "delay_s": delay_s}


def pull(root: Path | None = None) -> dict[str, Any]:
    """Fast-forward the install checkout to its upstream. Never resets, never makes a merge commit.

    Fetches only the upstream branch into its remote-tracking ref, then ``merge --ff-only`` of that ref,
    so a ``FETCH_HEAD`` written by anything else can't be merged ("cannot fast-forward to multiple branches").
    """
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
    remote, branch, tracking = _upstream_parts(root)
    if not tracking:
        info["reason"] = "no upstream"
        return info
    before = head(root)
    info["from"] = before
    info["upstream"] = tracking[len("refs/remotes/"):]
    steps = (
        ("fetch", ["fetch", "--quiet", "--no-tags", remote, f"+refs/heads/{branch}:{tracking}"]),
        ("merge", ["merge", "--ff-only", "--quiet", tracking]),
    )
    for name, args in steps:
        try:
            r = _git(root, *args, timeout=PULL_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            info["action"] = "error"
            info["error"] = f"git {name} timed out"
            return info
        except OSError as e:
            info["action"] = "error"
            info["error"] = str(e)
            return info
        if r.returncode != 0:
            info["action"] = "error"
            info["error"] = f"git {name}: " + ((r.stderr or r.stdout or "").strip() or f"exit {r.returncode}")
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


def status_file() -> Path:
    return paths.user_dir() / "repo-sync.json"


def write_status(info: dict[str, Any]) -> None:
    """Record the last pull/build so a failed UI build is visible after the restart (``~/.zoto-viz/repo-sync.json``)."""
    keep = ("from", "to", "built", "build_error", "node", "pip", "pip_error")
    body = {k: info.get(k) for k in keep if k in info}
    body["at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    body["ok"] = not info.get("build_error") and not info.get("pip_error")
    try:
        f = status_file()
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass


def tick(root: Path | None = None, *, apply: bool = True) -> dict[str, Any]:
    """One pass under the sync lock. On a fast-forward: rebuild if needed, reload UI, restart.

    Another pass holding the lock (including a restart still pending from one) makes this return
    ``busy`` without touching git.
    """
    root = (root or paths.repo_root()).resolve()
    fd, ok = acquire_lock(root)
    if not ok:
        return {"root": str(root), "action": "busy", "reason": f"another repo sync holds {LOCK_NAME}"}
    try:
        info = pull(root)
        if info.get("action") != "pulled" or not apply:
            return info
        files = list(info.get("files") or [])
        info.update(apply_updates(root, files))
        write_status(info)
        live.queue_patch({"reloadClient": True})
        info["reloadClient"] = True
        info.update(schedule_restart(root, hold_fd=fd))
        return info
    finally:
        if fd is not None:
            os.close(fd)


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


if __name__ == "__main__":
    print(json.dumps(tick(), indent=2, default=str))
