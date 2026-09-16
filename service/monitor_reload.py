"""Restart the live monitor when checkout Python is newer than the running process.

Cursor's stop hook calls ``python -m service.monitor_reload --hook --if-stale``
so an agent turn that changed ``service/*.py`` (or ``zoto-viz``) is followed
by a systemd or ``scripts/dev.sh`` restart. Plugin ``backend/service.py`` is
hot-loaded by ``hooks.sync`` and does not need a process bounce.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Iterable

UNIT = "zoto-viz-monitor"
SKIP_ENV = "ZOTO_VIZ_NO_AUTO_RESTART"
MONITOR_CMD = re.compile(r"(?:-m\s+service\.monitor(?:\s|$)|service/monitor\.py)")


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def is_monitor_cmd(cmd: str) -> bool:
    text = cmd.replace("\x00", " ")
    return bool(MONITOR_CMD.search(text))


def proc_start(pid: int) -> float | None:
    try:
        return Path(f"/proc/{pid}").stat().st_ctime
    except OSError:
        return None


def cmdline(pid: int) -> str:
    try:
        return Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\x00", b" ").decode("utf-8", "replace")
    except OSError:
        return ""


def iter_monitor_pids(exclude: int | None = None) -> list[int]:
    found: list[int] = []
    me = exclude if exclude is not None else os.getpid()
    proc = Path("/proc")
    try:
        names = list(proc.iterdir())
    except OSError:
        return found
    for entry in names:
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        if pid == me:
            continue
        if is_monitor_cmd(cmdline(pid)):
            found.append(pid)
    return found


def newest_backend_mtime(root: Path) -> float:
    latest = 0.0
    service = root / "service"
    if service.is_dir():
        for path in service.rglob("*.py"):
            if not path.is_file():
                continue
            if "__pycache__" in path.parts:
                continue
            try:
                latest = max(latest, path.stat().st_mtime)
            except OSError:
                continue
    extra = root / "zoto-viz"
    if extra.is_file():
        try:
            latest = max(latest, extra.stat().st_mtime)
        except OSError:
            pass
    return latest


def is_stale(src_mtime: float, proc_starts: Iterable[float]) -> bool:
    starts = [t for t in proc_starts if t > 0]
    if not starts or src_mtime <= 0:
        return False
    return any(src_mtime > t for t in starts)


def systemd_active(unit: str = UNIT) -> bool:
    try:
        r = subprocess.run(
            ["systemctl", "--user", "is-active", "--quiet", unit],
            check=False,
            capture_output=True,
        )
    except OSError:
        return False
    return r.returncode == 0


def status(root: Path | None = None) -> dict[str, Any]:
    root = root or repo_root()
    pids = iter_monitor_pids()
    starts = [proc_start(p) or 0.0 for p in pids]
    src = newest_backend_mtime(root)
    return {
        "running": bool(pids),
        "pids": pids,
        "src_mtime": src,
        "stale": is_stale(src, starts),
        "systemd": systemd_active(),
    }


def wait_port(port: int, timeout: float = 12.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            import socket
            with socket.create_connection(("127.0.0.1", port), timeout=0.3):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def restart(root: Path | None = None, *, force: bool = False) -> dict[str, Any]:
    """Bounce the running monitor. No-op when nothing is listening or sources are fresh."""
    root = root or repo_root()
    info = status(root)
    if os.environ.get(SKIP_ENV, "").strip() in {"1", "true", "yes", "on"}:
        info["action"] = "skipped"
        info["reason"] = SKIP_ENV
        return info
    if not info["running"]:
        info["action"] = "noop"
        info["reason"] = "not running"
        return info
    if not force and not info["stale"]:
        info["action"] = "noop"
        info["reason"] = "fresh"
        return info
    port = int(os.environ.get("ZOTO_VIZ_PORT") or "7020")
    if info["systemd"]:
        r = subprocess.run(
            ["systemctl", "--user", "restart", UNIT],
            check=False,
            capture_output=True,
            text=True,
        )
        info["action"] = "systemd"
        info["ok"] = r.returncode == 0
        if r.returncode != 0:
            info["error"] = (r.stderr or r.stdout or "").strip() or f"exit {r.returncode}"
            return info
    else:
        script = root / "scripts" / "dev.sh"
        r = subprocess.run(
            ["bash", str(script), "restart", "backend"],
            check=False,
            capture_output=True,
            text=True,
            cwd=str(root),
        )
        info["action"] = "dev.sh"
        info["ok"] = r.returncode == 0
        if r.returncode != 0:
            info["error"] = (r.stderr or r.stdout or "").strip() or f"exit {r.returncode}"
            return info
    info["ok"] = True
    info["ready"] = wait_port(port)
    return info


def hook_envelope(info: dict[str, Any]) -> dict[str, Any]:
    if info.get("action") in {None, "noop", "skipped"}:
        return {}
    how = info.get("action") or "restart"
    if not info.get("ok", True):
        err = info.get("error") or "restart failed"
        return {"additional_context": f"zoto-viz monitor restart ({how}) failed: {err}"}
    ready = " and is listening again" if info.get("ready") else ""
    return {
        "additional_context": (
            f"Restarted the zoto-viz monitor ({how}) to pick up backend Python changes{ready}."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    hook = "--hook" in args
    if_stale = "--if-stale" in args or hook
    status_only = "--status" in args
    force = "--force" in args
    if hook and not sys.stdin.isatty():
        try:
            sys.stdin.read()
        except OSError:
            pass
    if status_only:
        print(json.dumps(status(), ensure_ascii=False))
        return 0
    info = restart(force=force or not if_stale)
    if hook:
        print(json.dumps(hook_envelope(info), ensure_ascii=False))
        return 0
    print(json.dumps(info, ensure_ascii=False))
    return 0 if info.get("ok", True) or info.get("action") in {"noop", "skipped"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
