"""Hold idle / sleep so a kiosk display does not blank while the monitor runs.

Linux: ``systemd-inhibit --what=idle:sleep``, optional ``xdg-screensaver suspend``,
and ``xset s off`` / ``-dpms`` when an X display is reachable.
macOS: ``caffeinate -dimsu``. Windows: ``SetThreadExecutionState`` via ctypes.
Locks last only as long as this process (or its child) is alive.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Callable

Which = Callable[[str], str | None]
Popen = Callable[..., subprocess.Popen]
Run = Callable[..., subprocess.CompletedProcess]

# Windows SetThreadExecutionState flags
_ES_CONTINUOUS = 0x80000000
_ES_SYSTEM_REQUIRED = 0x00000001
_ES_DISPLAY_REQUIRED = 0x00000002


def detect_platform() -> str:
    raw = sys.platform.lower()
    if raw.startswith("win"):
        return "windows"
    if raw.startswith("darwin"):
        return "darwin"
    if raw.startswith("linux"):
        return "linux"
    return raw


def headless_inhibit() -> bool:
    """True when screensaver inhibit should stay off (CI, pytest, explicit env)."""
    for key in ("ZOTO_VIZ_HEADLESS", "ZOTO_VIZ_NO_SCREENSAVER_INHIBIT"):
        if os.environ.get(key, "").strip().lower() in {"1", "true", "yes", "on"}:
            return True
    if os.environ.get("CI", "").strip().lower() in {"1", "true", "yes"}:
        return True
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return True
    return False


def default_inhibit_enabled() -> bool:
    """Default for live monitor: on unless headless/test/CI."""
    return not headless_inhibit()


def infer_display(env: Mapping[str, str] | None = None) -> str:
    env = env if env is not None else os.environ
    display = (env.get("DISPLAY") or "").strip()
    if display:
        return display
    if Path("/tmp/.X11-unix/X0").exists():
        return ":0"
    return ""


class _WindowsHold:
    """ctypes wrapper for SetThreadExecutionState."""

    def __init__(self) -> None:
        self._active = False
        self._kernel32 = None

    def start(self) -> list[str]:
        try:
            import ctypes

            self._kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
            flags = _ES_CONTINUOUS | _ES_SYSTEM_REQUIRED | _ES_DISPLAY_REQUIRED
            self._kernel32.SetThreadExecutionState(flags)
            self._active = True
            return ["screensaver: SetThreadExecutionState SYSTEM+DISPLAY"]
        except (AttributeError, OSError) as exc:
            return [f"screensaver: SetThreadExecutionState failed ({exc})"]

    def stop(self) -> None:
        if not self._active or self._kernel32 is None:
            return
        try:
            self._kernel32.SetThreadExecutionState(_ES_CONTINUOUS)
        except (AttributeError, OSError):
            pass
        self._active = False


class ScreensaverHold:
    """Process-lifetime idle inhibit. ``start`` / ``stop`` are idempotent."""

    def __init__(
        self,
        *,
        which: Which | None = None,
        popen: Popen | None = None,
        run: Run | None = None,
        display: str | None = None,
        platform: str | None = None,
        windows_hold: _WindowsHold | None = None,
    ) -> None:
        self._which = which or shutil.which
        self._popen = popen or subprocess.Popen
        self._run = run or subprocess.run
        self._display = display
        self._platform = platform or detect_platform()
        self._child: subprocess.Popen | None = None
        self._xset = False
        self._xdg_cookie: str | None = None
        self._windows = windows_hold if windows_hold is not None else _WindowsHold()

    def start(self) -> list[str]:
        notes: list[str] = []
        if self._platform == "windows":
            notes.extend(self._windows.start())
            return notes
        if self._child is None:
            notes.extend(self._spawn_lock())
        notes.extend(self._xdg_suspend())
        notes.extend(self._xset_off())
        return notes

    def stop(self) -> None:
        if self._platform == "windows":
            self._windows.stop()
            return
        child = self._child
        self._child = None
        if child is not None:
            child.terminate()
            try:
                child.wait(timeout=2)
            except Exception:
                child.kill()
        if self._xdg_cookie:
            self._xdg_resume()
        if self._xset:
            self._xset = False
            display = self._display if self._display is not None else infer_display()
            self._xset_cmd(["s", "on"], display)
            self._xset_cmd(["+dpms"], display)

    def _spawn_lock(self) -> list[str]:
        if self._platform == "darwin":
            caffeinate = self._which("caffeinate")
            if caffeinate:
                self._child = self._popen(
                    [caffeinate, "-dimsu"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return ["screensaver: caffeinate -dimsu"]
            return ["screensaver: caffeinate not found on macOS"]
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
            return ["screensaver: caffeinate -dimsu (no systemd-inhibit)"]
        return ["screensaver: no systemd-inhibit/caffeinate; trying xset/xdg only"]

    def _xdg_suspend(self) -> list[str]:
        xdg = self._which("xdg-screensaver")
        if not xdg:
            return []
        display = self._display if self._display is not None else infer_display()
        if not display:
            return []
        try:
            proc = self._run(
                [xdg, "suspend", display],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return [f"screensaver: xdg-screensaver suspend failed on DISPLAY={display}"]
        if getattr(proc, "returncode", 1) != 0:
            return [f"screensaver: xdg-screensaver suspend failed on DISPLAY={display}"]
        cookie = (proc.stdout or "").strip()
        if cookie:
            self._xdg_cookie = cookie
        return [f"screensaver: xdg-screensaver suspend on DISPLAY={display}"]

    def _xdg_resume(self) -> None:
        xdg = self._which("xdg-screensaver")
        cookie = self._xdg_cookie
        self._xdg_cookie = None
        if not xdg or not cookie:
            return
        try:
            self._run(
                [xdg, "resume", cookie],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass

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


def screensaver_tool_check(platform: str | None = None) -> tuple[bool, str, tuple[str, ...]]:
    """Bootstrap/doctor: whether an inhibit backend exists on this host."""
    plat = platform or detect_platform()
    which = shutil.which
    if plat == "windows":
        try:
            import ctypes

            ctypes.windll.kernel32  # type: ignore[attr-defined]
            return True, "SetThreadExecutionState (Windows API)", ()
        except (AttributeError, OSError):
            return False, "SetThreadExecutionState unavailable", (
                "Run the monitor on Windows 7+ with kernel32 available.",
            )
    if plat == "darwin":
        path = which("caffeinate")
        if path:
            return True, f"caffeinate ({path})", ()
        return False, "caffeinate not on PATH", (
            "caffeinate ships with macOS — check PATH or reinstall macOS command-line tools.",
        )
    inhibit = which("systemd-inhibit")
    if inhibit:
        detail = f"systemd-inhibit ({inhibit})"
        extras = []
        if which("xset"):
            extras.append("xset")
        if which("xdg-screensaver"):
            extras.append("xdg-screensaver")
        if extras:
            detail += " + " + ", ".join(extras)
        return True, detail, ()
    manual = ("Install systemd (systemd-inhibit) or use xset on X11.",)
    return False, "systemd-inhibit not on PATH", manual
