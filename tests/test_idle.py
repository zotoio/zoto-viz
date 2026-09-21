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
        platform="linux",
    )
    notes = hold.start()
    assert any("caffeinate" in n for n in notes)
    hold.stop()
    assert child.terminated


def test_screensaver_hold_darwin_prefers_caffeinate() -> None:
    child = _Proc()
    hold = idle.ScreensaverHold(
        which=lambda n: {
            "caffeinate": "/usr/bin/caffeinate",
            "systemd-inhibit": "/usr/bin/systemd-inhibit",
        }.get(n),
        popen=lambda *a, **k: child,
        run=lambda *a, **k: subprocess.CompletedProcess(a[0], 0),
        platform="darwin",
    )
    notes = hold.start()
    assert any("caffeinate" in n for n in notes)
    assert hold._child is child


def test_screensaver_hold_xdg_suspend() -> None:
    child = _Proc()
    runner = _Run()

    def run(cmd, **_k):
        runner.calls.append(list(cmd))
        if len(cmd) >= 2 and cmd[-2] == "suspend":
            return subprocess.CompletedProcess(cmd, 0, stdout="cookie123\n")
        return subprocess.CompletedProcess(cmd, 0)

    hold = idle.ScreensaverHold(
        which=lambda n: {
            "systemd-inhibit": "/usr/bin/systemd-inhibit",
            "xdg-screensaver": "/usr/bin/xdg-screensaver",
        }.get(n),
        popen=lambda *a, **k: child,
        run=run,
        display=":0",
        platform="linux",
    )
    notes = hold.start()
    assert any("xdg-screensaver" in n for n in notes)
    hold.stop()
    assert ["/usr/bin/xdg-screensaver", "resume", "cookie123"] in runner.calls


class _WinHold:
    started = False
    stopped = False

    def start(self):
        self.started = True
        return ["screensaver: windows mock"]

    def stop(self):
        self.stopped = True


def test_screensaver_hold_windows() -> None:
    win = _WinHold()
    hold = idle.ScreensaverHold(platform="windows", windows_hold=win)
    notes = hold.start()
    assert win.started
    assert "windows mock" in notes[0]
    hold.stop()
    assert win.stopped


def test_default_inhibit_enabled(monkeypatch) -> None:
    monkeypatch.delenv("ZOTO_VIZ_HEADLESS", raising=False)
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.delenv("CI", raising=False)
    assert idle.default_inhibit_enabled() is True
    monkeypatch.setenv("ZOTO_VIZ_HEADLESS", "1")
    assert idle.default_inhibit_enabled() is False


def test_screensaver_tool_check_linux() -> None:
    ok, detail, manual = idle.screensaver_tool_check("linux")
    # CI may or may not have systemd-inhibit
    if ok:
        assert "systemd-inhibit" in detail
    else:
        assert manual


def test_screensaver_tool_check_darwin() -> None:
    ok, detail, _manual = idle.screensaver_tool_check("darwin")
    if ok:
        assert "caffeinate" in detail
