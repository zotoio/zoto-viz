"""Hold idle / sleep so a kiosk display does not blank while the monitor runs.

Linux: ``systemd-inhibit --what=idle:sleep`` plus ``xset s off`` / ``-dpms`` when
an X display is reachable. macOS: ``caffeinate -dimsu``. Locks last only as
long as this process (or its child) is alive.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from collections.abc import Mapping
from pathlib import Path
from typing import Callable

Which = Callable[[str], str | None]
Popen = Callable[..., subprocess.Popen]
Run = Callable[..., subprocess.CompletedProcess]


def infer_display(env: Mapping[str, str] | None = None) -> str:
    env = env if env is not None else os.environ
    display = (env.get("DISPLAY") or "").strip()
    if display:
        return display
    if Path("/tmp/.X11-unix/X0").exists():
        return ":0"
    return ""


class ScreensaverHold:
    """Process-lifetime idle inhibit. ``start`` / ``stop`` are idempotent."""

    def __init__(
        self,
        *,
        which: Which | None = None,
        popen: Popen | None = None,
        run: Run | None = None,
        display: str | None = None,
    ) -> None:
        self._which = which or shutil.which
        self._popen = popen or subprocess.Popen
        self._run = run or subprocess.run
        self._display = display
        self._child: subprocess.Popen | None = None
        self._xset = False

    def start(self) -> list[str]:
        notes: list[str] = []
        if self._child is None:
            notes.extend(self._spawn_lock())
        notes.extend(self._xset_off())
        return notes

    def stop(self) -> None:
        child = self._child
        self._child = None
        if child is not None:
            child.terminate()
            try:
                child.wait(timeout=2)
            except Exception:
                child.kill()
        if self._xset:
            self._xset = False
            display = self._display if self._display is not None else infer_display()
            self._xset_cmd(["s", "on"], display)
            self._xset_cmd(["+dpms"], display)

    def _spawn_lock(self) -> list[str]:
        inhibit = self._which("systemd-inhibit")
        if inhibit:
            self._child = self._popen(
                [
                    inhibit,
                    "--what=idle:sleep",
                    "--who=zoto-viz",
                    "--why=live-monitor",
                    "--mode=block",
                    "sleep",
                    "infinity",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return ["screensaver: systemd-inhibit idle:sleep"]
        caffeinate = self._which("caffeinate")
        if caffeinate:
            self._child = self._popen(
                [caffeinate, "-dimsu"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return ["screensaver: caffeinate -dimsu"]
        return ["screensaver: no systemd-inhibit/caffeinate; trying xset only"]

    def _xset_off(self) -> list[str]:
        if self._which("xset") is None:
            return []
        display = self._display if self._display is not None else infer_display()
        if not display:
            return []
        ok = (
            self._xset_cmd(["s", "off"], display)
            and self._xset_cmd(["s", "noblank"], display)
            and self._xset_cmd(["-dpms"], display)
        )
        if not ok:
            return [f"screensaver: xset failed on DISPLAY={display}"]
        self._xset = True
        return [f"screensaver: xset s off -dpms on DISPLAY={display}"]

    def _xset_cmd(self, args: list[str], display: str) -> bool:
        try:
            proc = self._run(
                ["xset", *args],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
                env={**os.environ, "DISPLAY": display},
            )
        except (OSError, subprocess.TimeoutExpired):
            return False
        return getattr(proc, "returncode", 1) == 0
