from __future__ import annotations

import io
from pathlib import Path

import pytest

from service import install as inst


def _host(tmp_path: Path, **kwargs) -> inst.Host:
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    root = tmp_path / "repo"
    root.mkdir(exist_ok=True)
    (root / "zoto-viz").write_text("#!/usr/bin/env python3\nprint(1)\n", encoding="utf-8")
    (root / "requirements.txt").write_text("pyyaml\n", encoding="utf-8")
    (root / "web").mkdir(exist_ok=True)
    (root / "systemd").mkdir(exist_ok=True)
    (root / "systemd" / "zoto-viz-monitor.service").write_text("[Service]\n", encoding="utf-8")
    defaults = dict(
        root=root,
        home=home,
        platform="linux",
        python=(3, 12, 3),
        executable="/usr/bin/python3",
        which=lambda name: f"/usr/bin/{name}" if name in {"python3", "node", "tshark", "ip", "corepack", "pnpm", "apt-get"} else None,
        env_path=str(tmp_path / "no-bin"),
        euid=1000,
        isatty=False,
    )
    defaults.update(kwargs)
    return inst.Host(**defaults)


def test_parse_node_version() -> None:
    assert inst.parse_node_version("v22.14.0\n") == (22, 14)
    assert inst.parse_node_version("22.12") == (22, 12)
    assert inst.parse_node_version("nope") is None
    assert inst.parse_node_version("") is None


def test_python_check_too_old(tmp_path: Path) -> None:
    host = _host(tmp_path, python=(3, 11, 9))
    c = inst._python_check(host)
    assert not c.ok
    assert "3.12" in c.detail


def test_posix_and_windows_shim_text() -> None:
    posix = inst.posix_shim_text(Path("/repo/.venv/bin/python"), Path("/repo/zoto-viz"))
    assert posix.startswith("#!/bin/sh\n")
    assert '"/repo/.venv/bin/python" "/repo/zoto-viz"' in posix
    win = inst.windows_shim_text(Path(r"C:\repo\.venv\Scripts\python.exe"), Path(r"C:\repo\zoto-viz"))
    assert win.startswith("@echo off")
    assert "python.exe" in win
    assert r"C:\repo\zoto-viz" in win


def test_write_shim_linux(tmp_path: Path) -> None:
    host = _host(tmp_path)
    dest = inst.write_shim(host)
    assert dest == host.home / ".local" / "bin" / "zoto-viz"
    text = dest.read_text(encoding="utf-8")
    assert text.startswith("#!/bin/sh\n")
    assert str(inst.venv_python(host)) in text
    assert dest.stat().st_mode & 0o111


def test_write_shim_windows(tmp_path: Path) -> None:
    host = _host(tmp_path, platform="windows")
    dest = inst.write_shim(host)
    assert dest.name == "zoto-viz.cmd"
    assert dest.read_text(encoding="utf-8").startswith("@echo off")


def test_gather_checks_missing_tshark_has_manual(tmp_path: Path) -> None:
    def which(name: str):
        if name in {"node", "apt-get", "ip"}:
            return f"/usr/bin/{name}"
        return None

    host = _host(tmp_path, which=which)

    def run(cmd, cwd):
        if cmd[:2] == ["node", "-v"]:
            return 0, "v22.14.0\n", ""
        return 1, "", "missing"

    checks = inst.gather_checks(host, run)
    by_id = {c.id: c for c in checks}
    assert by_id["python"].ok
    assert by_id["node"].ok
    assert not by_id["tshark"].ok
    assert by_id["tshark"].required
    assert any("apt install" in line for line in by_id["tshark"].manual)
    assert not by_id["nmap"].ok
    assert not by_id["nmap"].required
    assert not by_id["iw"].ok
    assert not by_id["iw"].required
    assert any("apt install" in line and "iw" in line for line in by_id["iw"].manual)


def test_gather_checks_windows_no_iproute(tmp_path: Path) -> None:
    def which(name: str):
        return f"C:\\bin\\{name}.exe" if name in {"node", "tshark", "winget"} else None

    host = _host(tmp_path, platform="windows", which=which)

    def run(cmd, cwd):
        return 0, "v22.12.0\n", ""

    ids = {c.id for c in inst.gather_checks(host, run)}
    assert "ip" not in ids
    assert "wireshark-group" not in ids
    assert "iw" not in ids
    assert "tshark" in ids


def test_gather_checks_darwin_brew_and_bpf(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def which(name: str):
        return f"/opt/homebrew/bin/{name}" if name in {"node", "brew"} else None

    host = _host(tmp_path, platform="darwin", which=which)
    monkeypatch.setattr(inst, "_access_bpf_ok", lambda: False)

    def run(cmd, cwd):
        return 0, "v22.16.0\n", ""

    checks = inst.gather_checks(host, run)
    by_id = {c.id: c for c in checks}
    assert "ip" not in by_id
    assert "wireshark-group" not in by_id
    assert "iw" not in by_id
    assert "avahi-browse" not in by_id
    assert by_id["brew"].ok
    assert not by_id["tshark"].ok
    assert any("brew install wireshark" in line for line in by_id["tshark"].manual)
    assert not by_id["access-bpf"].ok
    assert any("chmodbpf" in line for line in by_id["access-bpf"].manual)
    plan = inst.build_plan(host, checks)
    ids = [s.id for s in plan]
    assert "os-packages" in ids
    assert "access-bpf" in ids
    assert "launchd" in ids
    assert "systemd" not in ids
    brew_step = next(s for s in plan if s.id == "os-packages")
    assert brew_step.argv[:2] == ("brew", "install")
    assert "wireshark" in brew_step.argv


def test_darwin_tshark_app_bundle(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    bundled = tmp_path / "Wireshark.app" / "Contents" / "MacOS" / "tshark"
    bundled.parent.mkdir(parents=True)
    bundled.write_text("x\n", encoding="utf-8")
    monkeypatch.setattr(inst, "DARWIN_TSHARK", (str(bundled),))
    host = _host(tmp_path, platform="darwin", which=lambda _n: None)
    assert inst._tool_ok(host, "tshark") is True


def test_ensure_user_path_darwin_zprofile(tmp_path: Path) -> None:
    host = _host(tmp_path, platform="darwin", env_path="/usr/bin")
    status = inst.ensure_user_path(host)
    assert status == "profile-updated"
    zprofile = (host.home / ".zprofile").read_text(encoding="utf-8")
    assert str(host.home / ".local" / "bin") in zprofile
    assert inst.PROFILE_MARK in zprofile
    zshrc = (host.home / ".zshrc").read_text(encoding="utf-8")
    assert inst.PROFILE_MARK in zshrc


def test_install_launchd_user(tmp_path: Path) -> None:
    host = _host(tmp_path, platform="darwin")
    dest = inst.install_launchd_user(host)
    assert dest == host.home / "Library" / "LaunchAgents" / "com.zoto-viz.monitor.plist"
    text = dest.read_text(encoding="utf-8")
    assert "com.zoto-viz.monitor" in text
    assert "ZOTO_VIZ_REPO_ROOT" in text
    assert str(host.root) in text
    assert "service.monitor" in text
    assert "127.0.0.1" in text
    lan = inst.launchd_plist_text(
        host.root,
        inst.venv_python(host),
        host.home,
        cfg={"bind": "0.0.0.0", "insecure_lan": True, "inhibit_screensaver": True},
    )
    assert "0.0.0.0" in lan
    assert "--insecure-lan" in lan
    assert "caffeinate" in lan


def test_manual_darwin_tshark() -> None:
    host = inst.Host(root=Path("."), home=Path("."), platform="darwin", which=lambda n: None)
    lines = inst._manual_for("tshark", host, None)
    assert any("brew.sh" in line or "brew install" in line for line in lines)
    assert any("chmodbpf" in line for line in lines)


def test_darwin_dry_run_launchd(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def which(name: str):
        return f"/opt/homebrew/bin/{name}" if name in {"node", "brew", "tshark"} else None

    host = _host(tmp_path, platform="darwin", which=which, isatty=False)
    monkeypatch.setattr(inst, "_access_bpf_ok", lambda: True)

    def run(cmd, cwd):
        if cmd[:2] == ["node", "-v"]:
            return 0, "v22.16.0\n", ""
        raise AssertionError(f"dry-run ran {cmd}")

    buf = io.StringIO()
    code = inst.cli_install(dry_run=True, no_system=True, host=host, run=run, stdin=io.StringIO(""), stdout=buf)
    assert code == 0
    out = buf.getvalue()
    assert "launchd" in out.lower() or "LaunchAgent" in out
    assert "Hopper" not in out


def test_build_plan_includes_system_and_local(tmp_path: Path) -> None:
    def which(name: str):
        return f"/usr/bin/{name}" if name in {"node", "apt-get", "ip"} else None

    host = _host(tmp_path, which=which)

    def run(cmd, cwd):
        return 0, "v22.14.0\n", ""

    checks = inst.gather_checks(host, run)
    plan = inst.build_plan(host, checks)
    ids = [s.id for s in plan]
    assert "os-packages" in ids
    assert "venv" in ids
    assert "shim" in ids
    assert "user-path" in ids
    assert "sys-config" in ids
    assert "systemd" in ids
    os_step = next(s for s in plan if s.id == "os-packages")
    assert os_step.risk == "system"
    assert "apt-get" in os_step.argv
    assert "tshark" in os_step.argv
    skipped = inst.build_plan(host, checks, no_system=True)
    assert all(s.risk != "system" for s in skipped)


def test_build_plan_winget_one_step_per_id(tmp_path: Path) -> None:
    def which(name: str):
        return "winget" if name == "winget" else None

    host = _host(tmp_path, platform="windows", which=which)
    checks = [
        inst.Check("python", "Python", True, True, "ok"),
        inst.Check("node", "Node", True, False, "missing", ()),
        inst.Check("tshark", "tshark", True, False, "missing", ()),
    ]
    plan = inst.build_plan(host, checks)
    winget = [s for s in plan if s.id.startswith("os-packages")]
    assert len(winget) == 2
    blob = " ".join(" ".join(s.argv) for s in winget)
    assert "Wireshark.Wireshark" in blob
    assert "OpenJS.NodeJS.LTS" in blob


def test_format_plan_and_checks(tmp_path: Path) -> None:
    checks = [
        inst.Check("python", "Python 3.12+", True, True, "3.12.3"),
        inst.Check("tshark", "tshark", True, False, "not on PATH", ("sudo apt install tshark",)),
    ]
    text = inst.format_checks(checks)
    assert "[ok] Python" in text
    assert "[MISSING] tshark" in text
    assert "sudo apt install tshark" in text
    plan = [
        inst.PlanStep("os-packages", "install packages", "system", argv=("sudo", "apt-get", "install", "-y", "tshark")),
        inst.PlanStep("venv", "create venv", "local", fn="create_venv"),
    ]
    ptxt = inst.format_plan(plan)
    assert "SYSTEM" in ptxt
    assert "$ sudo apt-get install -y tshark" in ptxt


def test_dry_run_skips_system_without_yes(tmp_path: Path) -> None:
    def which(name: str):
        return f"/usr/bin/{name}" if name in {"node", "apt-get", "ip", "tshark"} else None

    host = _host(tmp_path, which=which, isatty=False)
    buf = io.StringIO()

    def run(cmd, cwd):
        if cmd[:2] == ["node", "-v"]:
            return 0, "v22.14.0\n", ""
        raise AssertionError(f"dry-run ran {cmd}")

    code = inst.cli_install(dry_run=True, yes=False, host=host, run=run, stdin=io.StringIO(""), stdout=buf)
    assert code == 0
    out = buf.getvalue()
    assert "dry-run" in out
    assert "Install plan" in out
    assert "Prerequisites" in out


def test_dry_run_old_python_exits_1(tmp_path: Path) -> None:
    host = _host(tmp_path, python=(3, 10, 0))
    buf = io.StringIO()
    code = inst.cli_install(dry_run=True, host=host, stdin=io.StringIO(""), stdout=buf)
    assert code == 1
    assert "3.12" in buf.getvalue()


def test_prompt_yes_flags() -> None:
    out = io.StringIO()
    assert inst.prompt_yes("Q?", yes=True, isatty=False, stdin=io.StringIO(""), stdout=out) is True
    assert inst.prompt_yes("Q?", yes=False, isatty=False, stdin=io.StringIO("y\n"), stdout=out) is False
    assert inst.prompt_yes("Q?", yes=False, isatty=True, stdin=io.StringIO("yes\n"), stdout=out) is True
    assert inst.prompt_yes("Q?", yes=False, isatty=True, stdin=io.StringIO("n\n"), stdout=out) is False


def test_ensure_user_path_posix_appends_profile(tmp_path: Path) -> None:
    host = _host(tmp_path, env_path="/usr/bin")
    status = inst.ensure_user_path(host)
    assert status == "profile-updated"
    profile = (host.home / ".profile").read_text(encoding="utf-8")
    assert str(host.home / ".local" / "bin") in profile
    assert inst.PROFILE_MARK in profile
    again = inst.ensure_user_path(host)
    assert again in {"already-in-profile", "already-on-path"}


def test_ensure_user_path_already_present(tmp_path: Path) -> None:
    host = _host(tmp_path)
    folder = inst.path_bin_dir(host)
    folder.mkdir(parents=True)
    host.env_path = str(folder)
    assert inst.ensure_user_path(host) == "already-on-path"


def test_create_venv_skips_when_present(tmp_path: Path) -> None:
    host = _host(tmp_path)
    py = inst.venv_python(host)
    py.parent.mkdir(parents=True)
    py.write_text("#!/usr/bin/env python3\n", encoding="utf-8")
    called: list[list[str]] = []

    def run(cmd, cwd):
        called.append(cmd)
        return 0, "", ""

    inst.create_venv(host, run)
    assert called == []


def test_create_venv_and_pip(tmp_path: Path) -> None:
    host = _host(tmp_path)
    calls: list[list[str]] = []

    def run(cmd, cwd):
        calls.append(cmd)
        if "-m" in cmd and "venv" in cmd:
            dest = Path(cmd[-1]) / "bin" / "python"
            dest.parent.mkdir(parents=True)
            dest.write_text("x\n", encoding="utf-8")
        return 0, "ok\n", ""

    inst.create_venv(host, run)
    inst.pip_install(host, run)
    assert any("venv" in c for c in calls)
    assert any("pip" in c for c in calls)


def test_apply_local_steps_noninteractive(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def which(name: str):
        mapping = {
            "node": "/usr/bin/node",
            "tshark": "/usr/bin/tshark",
            "ip": "/usr/bin/ip",
            "corepack": "/usr/bin/corepack",
            "pnpm": "/usr/bin/pnpm",
            "apt-get": "/usr/bin/apt-get",
        }
        return mapping.get(name)

    host = _host(tmp_path, which=which, isatty=False)
    calls: list[list[str]] = []

    def run(cmd, cwd):
        calls.append(list(cmd))
        if cmd[:2] == ["node", "-v"]:
            return 0, "v22.14.0\n", ""
        if "-m" in cmd and "venv" in cmd:
            dest = Path(cmd[-1]) / "bin" / "python"
            dest.parent.mkdir(parents=True)
            dest.write_text("x\n", encoding="utf-8")
            return 0, "", ""
        return 0, "ok\n", ""

    monkeypatch.setattr(inst, "write_sysconfig", lambda: None)
    monkeypatch.setattr(inst, "install_systemd_user", lambda h: None)
    monkeypatch.setattr(inst, "hopper_notes", lambda h: ["sudo hopper"])
    buf = io.StringIO()
    code = inst.cli_install(dry_run=False, yes=False, no_system=True, host=host, run=run, stdin=io.StringIO(""), stdout=buf)
    assert code == 0
    out = buf.getvalue()
    assert "local steps" in out or "->" in out
    assert (host.home / ".local" / "bin" / "zoto-viz").is_file()
    assert any("pip" in x for c in calls for x in c)
    assert any("pnpm" in x for c in calls for x in c)
    assert "sudo hopper" in out
    assert not any("apt-get" in x for c in calls for x in c)


def test_yes_runs_system_step(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def which(name: str):
        return f"/usr/bin/{name}" if name in {"node", "apt-get", "ip", "corepack", "pnpm"} else None

    host = _host(tmp_path, which=which, isatty=False)
    calls: list[list[str]] = []

    def run(cmd, cwd):
        calls.append(list(cmd))
        if cmd[:2] == ["node", "-v"]:
            return 0, "v22.14.0\n", ""
        if "-m" in cmd and "venv" in cmd:
            dest = Path(cmd[-1]) / "bin" / "python"
            dest.parent.mkdir(parents=True)
            dest.write_text("x\n", encoding="utf-8")
        return 0, "", ""

    monkeypatch.setattr(inst, "write_sysconfig", lambda: None)
    monkeypatch.setattr(inst, "install_systemd_user", lambda h: None)
    buf = io.StringIO()
    code = inst.cli_install(yes=True, host=host, run=run, stdin=io.StringIO(""), stdout=buf)
    assert code == 0
    assert any("apt-get" in c for c in calls)


def test_tty_abort_apply(tmp_path: Path) -> None:
    host = _host(tmp_path, isatty=True, which=lambda n: "/usr/bin/node" if n == "node" else None)
    buf = io.StringIO()

    def run(cmd, cwd):
        if cmd[:2] == ["node", "-v"]:
            return 0, "v22.14.0\n", ""
        raise AssertionError("should not apply")

    code = inst.cli_install(
        dry_run=False,
        yes=False,
        no_system=True,
        host=host,
        run=run,
        stdin=io.StringIO("n\nn\n"),
        stdout=buf,
    )
    assert code == 1
    assert "Aborted" in buf.getvalue()


def test_step_failure_is_nonzero(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    host = _host(tmp_path, which=lambda n: "/bin/true" if n == "node" else None)

    def run(cmd, cwd):
        if cmd[:2] == ["node", "-v"]:
            return 0, "v22.14.0\n", ""
        return 1, "", "boom"

    monkeypatch.setattr(inst, "write_sysconfig", lambda: None)
    buf = io.StringIO()
    code = inst.cli_install(yes=True, no_system=True, host=host, run=run, stdin=io.StringIO(""), stdout=buf)
    assert code == 1
    assert "FAILED" in buf.getvalue()


def test_pkg_manager_detection(tmp_path: Path) -> None:
    assert inst.pkg_manager(_host(tmp_path, platform="windows", which=lambda n: "winget" if n == "winget" else None)) == "winget"
    assert inst.pkg_manager(_host(tmp_path, platform="darwin", which=lambda n: "brew" if n == "brew" else None)) == "brew"
    assert inst.pkg_manager(_host(tmp_path, which=lambda n: None)) is None


def test_manual_windows_tshark() -> None:
    host = inst.Host(root=Path("."), home=Path("."), platform="windows", which=lambda n: None)
    lines = inst._manual_for("tshark", host, None)
    assert any("Wireshark" in line for line in lines)
    assert any("Npcap" in line for line in lines)


def test_cli_script_has_shebang() -> None:
    root = Path(__file__).resolve().parents[1]
    text = (root / "zoto-viz").read_text(encoding="utf-8").splitlines()[0]
    assert text == "#!/usr/bin/env python3"
    assert not (root / "zoto-viz.py").exists()


def test_windows_cmd_wrapper_exists() -> None:
    root = Path(__file__).resolve().parents[1]
    cmd = (root / "zoto-viz.cmd").read_text(encoding="utf-8")
    assert "zoto-viz" in cmd
    assert "python.exe" in cmd


def test_detect_platform() -> None:
    assert inst.detect_platform("win32") == "windows"
    assert inst.detect_platform("linux") == "linux"
    assert inst.detect_platform("darwin") == "darwin"


def test_path_bin_dir_localappdata(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "la"))
    host = _host(tmp_path, platform="windows")
    assert inst.path_bin_dir(host) == tmp_path / "la" / "zoto-viz" / "bin"


def test_ensure_user_path_windows(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import types
    import sys

    store = {"Path": r"C:\Windows"}

    class Key:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    mod = types.ModuleType("winreg")
    mod.HKEY_CURRENT_USER = 1  # type: ignore[attr-defined]
    mod.KEY_READ = 1  # type: ignore[attr-defined]
    mod.KEY_WRITE = 2  # type: ignore[attr-defined]
    mod.REG_EXPAND_SZ = 2  # type: ignore[attr-defined]

    def open_key(*_a, **_k):
        return Key()

    def query(_key, name):
        if name not in store:
            raise FileNotFoundError(name)
        return store[name], 1

    def set_value(_key, name, _res, _typ, value):
        store[name] = value

    mod.OpenKey = open_key  # type: ignore[attr-defined]
    mod.QueryValueEx = query  # type: ignore[attr-defined]
    mod.SetValueEx = set_value  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "winreg", mod)
    folder = tmp_path / "bin"
    assert inst.ensure_user_path_windows(folder) == "user-path-updated"
    assert str(folder) in store["Path"]
    assert inst.ensure_user_path_windows(folder) == "already-on-path"


def test_apply_step_argv_and_unknown(tmp_path: Path) -> None:
    host = _host(tmp_path)

    def run(cmd, cwd):
        assert cmd == ["true"]
        return 0, "ok\n", ""

    step = inst.PlanStep("x", "run true", "local", argv=("true",))
    assert inst.apply_step(step, host, run) == "ok"
    with pytest.raises(RuntimeError, match="unknown"):
        inst.apply_step(inst.PlanStep("nope", "x", "local", fn="missing"), host, run)


def test_optional_step_failure_continues(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def which(name: str):
        return f"/usr/bin/{name}" if name in {"node", "tshark", "ip", "corepack", "pnpm"} else None

    host = _host(tmp_path, which=which)

    def run(cmd, cwd):
        if cmd[:2] == ["node", "-v"]:
            return 0, "v22.14.0\n", ""
        if "-m" in cmd and "venv" in cmd:
            dest = Path(cmd[-1]) / "bin" / "python"
            dest.parent.mkdir(parents=True)
            dest.write_text("x\n", encoding="utf-8")
        return 0, "", ""

    monkeypatch.setattr(inst, "write_sysconfig", lambda: None)

    def boom(_host):
        raise RuntimeError("no systemd")

    monkeypatch.setattr(inst, "install_systemd_user", boom)
    buf = io.StringIO()
    code = inst.cli_install(yes=True, no_system=True, host=host, run=run, stdin=io.StringIO(""), stdout=buf)
    assert code == 0
    assert "FAILED" in buf.getvalue()


def test_subprocess_install_help() -> None:
    import subprocess
    import sys

    root = Path(__file__).resolve().parents[1]
    proc = subprocess.run(
        [sys.executable, str(root / "zoto-viz"), "install", "--help"],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0
    assert "--dry-run" in proc.stdout
    assert "--yes" in proc.stdout


def test_run_capture_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_a, **_k):
        raise FileNotFoundError("nope")

    monkeypatch.setattr(inst.subprocess, "run", boom)
    code, _out, err = inst._run_capture(["missing-tool"])
    assert code == 127
    assert "not found" in err


def test_tool_ok_exists_without_which(tmp_path: Path) -> None:
    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "dumpcap").write_text("", encoding="utf-8")
    host = inst.Host(
        root=tmp_path,
        home=tmp_path,
        platform="linux",
        which=lambda _n: None,
        env_path=str(bindir),
    )
    assert inst._tool_ok(host, "dumpcap") is True
    assert inst._tool_ok(host, "nope") is False


def test_prefer_node_uses_nvm_when_path_is_18(tmp_path: Path) -> None:
    bindir = tmp_path / "home" / ".nvm" / "versions" / "node" / "v22.23.2" / "bin"
    bindir.mkdir(parents=True)
    node = bindir / "node"
    node.write_text("#!/bin/sh\n", encoding="utf-8")
    node.chmod(0o755)
    host = _host(tmp_path, which=lambda n: "/usr/bin/node" if n == "node" else None)

    def run(cmd, cwd):
        exe = str(cmd[0])
        if exe.endswith("/node") and "v22.23.2" in exe:
            return 0, "v22.23.2\n", ""
        if cmd[:2] == ["node", "-v"]:
            return 0, "v18.20.2\n", ""
        return 1, "", "no"

    new, note = inst.prefer_node(host, run)
    assert "22.23" in note
    assert "nvm alias default 22" in note
    assert new.which("node") == str(node)


def test_cli_old_node_stops_before_web(tmp_path: Path) -> None:
    host = _host(tmp_path, which=lambda n: "/usr/bin/node" if n == "node" else None)

    def run(cmd, cwd):
        if cmd[:2] == ["node", "-v"]:
            return 0, "v18.20.2\n", ""
        raise AssertionError(f"should not run {cmd}")

    buf = io.StringIO()
    code = inst.cli_install(yes=True, no_system=True, host=host, run=run, stdin=io.StringIO(""), stdout=buf)
    assert code == 1
    assert "22.12" in buf.getvalue()
    assert "web:" not in buf.getvalue()


def test_setup_pnpm_retries_broken_cjs_shim(tmp_path: Path) -> None:
    host = _host(tmp_path)
    seen = {"v": 0}

    def run(cmd, cwd):
        if cmd and str(cmd[0]).endswith("pnpm") and cmd[-1] == "-v":
            seen["v"] += 1
            if seen["v"] == 1:
                return 1, "", "Error: Cannot find module '.../pnpm/12.4.2/bin/pnpm.cjs'"
            return 0, "10.18.0\n", ""
        return 0, "", ""

    inst.setup_pnpm(host, run)
    assert seen["v"] >= 2


def test_build_plan_skips_web_without_node(tmp_path: Path) -> None:
    host = _host(tmp_path, which=lambda n: None)
    checks = [
        inst.Check("python", "Python", True, True, "ok"),
        inst.Check("node", "Node", True, False, "v18", ()),
    ]
    ids = [s.id for s in inst.build_plan(host, checks, no_system=True)]
    assert "venv" in ids
    assert "web" not in ids
    assert "corepack" not in ids


def test_install_systemd_user_copies_unit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    host = _host(tmp_path)
    from service import sysconfig as real_sc

    monkeypatch.setattr(real_sc, "ensure", lambda: {"root": str(host.root)})
    monkeypatch.setattr(real_sc, "write_systemd_override", lambda cfg: host.home / "override.conf")
    monkeypatch.setattr(inst.subprocess, "run", lambda *a, **k: type("R", (), {"returncode": 0})())
    inst.install_systemd_user(host)
    dest = host.home / ".config" / "systemd" / "user" / "zoto-viz-monitor.service"
    assert dest.is_file()
