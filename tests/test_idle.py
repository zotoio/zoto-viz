from __future__ import annotations

import subprocess
from service import idle


class _Proc:
    def __init__(self) -> None:
        self.terminated = False
        self.killed = False

    def terminate(self) -> None:
        self.terminated = True

    def wait(self, timeout: float = 0) -> int:
        return 0

    def kill(self) -> None:
        self.killed = True


class _Run:
    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def __call__(self, cmd, **_k):
        self.calls.append(list(cmd))
        return subprocess.CompletedProcess(cmd, 0)


def test_infer_display_env_and_socket(monkeypatch) -> None:
    class FakePath:
        present = False

        def __init__(self, p: str) -> None:
            self.p = str(p)

        def exists(self) -> bool:
            return self.p == "/tmp/.X11-unix/X0" and FakePath.present

    monkeypatch.setattr(idle, "Path", FakePath)
    assert idle.infer_display({"PATH": "/bin"}) == ""
    FakePath.present = True
    assert idle.infer_display({}) == ":0"
    assert idle.infer_display({"DISPLAY": ":1"}) == ":1"


def test_screensaver_hold_systemd_inhibit_and_xset() -> None:
    child = _Proc()
    runner = _Run()
    bins = {"systemd-inhibit": "/usr/bin/systemd-inhibit", "xset": "/usr/bin/xset"}
    hold = idle.ScreensaverHold(
        which=bins.get,
        popen=lambda *a, **k: child,
        run=runner,
        display=":0",
    )
    notes = hold.start()
    assert any("systemd-inhibit" in n for n in notes)
    assert any("xset" in n and "DISPLAY=:0" in n for n in notes)
    assert hold._child is child
    hold.stop()
    assert child.terminated
    assert ["xset", "s", "on"] in runner.calls
    assert ["xset", "+dpms"] in runner.calls


def test_screensaver_hold_caffeinate_when_no_systemd() -> None:
    child = _Proc()
    hold = idle.ScreensaverHold(
        which=lambda n: "/usr/bin/caffeinate" if n == "caffeinate" else None,
        popen=lambda *a, **k: child,
        run=lambda *a, **k: subprocess.CompletedProcess(a[0], 1),
        display="",
    )
    notes = hold.start()
    assert any("caffeinate" in n for n in notes)
    hold.stop()
    assert child.terminated
