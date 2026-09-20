"""Checkout bootstrap: prereqs, dry-run plan, PATH shim, venv, frontend build.

Stdlib-only so ``./zoto-viz install`` works before ``requirements.txt``.
YAML / sysconfig load after pip. System package steps are opt-in (``--yes``
or an explicit risk prompt); missing tools always print manual instructions.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Callable, Iterable, Sequence, TextIO

MIN_PYTHON = (3, 12)
MIN_NODE = (22, 12)
CLI_NAME = "zoto-viz"
PROFILE_MARK = "# zoto-viz CLI"

Which = Callable[[str], str | None]
Run = Callable[[list[str], Path | None], tuple[int, str, str]]

# tool id -> apt / dnf / pacman / winget / brew
_BREW = {
    "tshark": ["wireshark"],
    "dumpcap": ["wireshark"],
    "nmap": ["nmap"],
    "dot": ["graphviz"],
    "arp-scan": ["arp-scan"],
    "fping": ["fping"],
    "openssl": ["openssl"],
    "node": ["node"],
    "python": ["python@3.12"],
}
DARWIN_TSHARK = (
    "/opt/homebrew/bin/tshark",
    "/usr/local/bin/tshark",
    "/Applications/Wireshark.app/Contents/MacOS/tshark",
)

_APT = {
    "tshark": ["tshark"],
    "dumpcap": ["tshark"],
    "ip": ["iproute2"],
    "arp-scan": ["arp-scan"],
    "fping": ["fping"],
    "nmap": ["nmap"],
    "avahi-browse": ["avahi-utils"],
    "nbtscan": ["nbtscan"],
    "dig": ["bind9-dnsutils"],
    "dot": ["graphviz"],
    "openssl": ["openssl"],
    "iw": ["iw"],
    "python3-venv": ["python3-venv"],
}
_DNF = {
    "tshark": ["wireshark-cli"],
    "dumpcap": ["wireshark-cli"],
    "ip": ["iproute"],
    "arp-scan": ["arp-scan"],
    "fping": ["fping"],
    "nmap": ["nmap"],
    "avahi-browse": ["avahi-tools"],
    "nbtscan": ["nbtscan"],
    "dig": ["bind-utils"],
    "dot": ["graphviz"],
    "openssl": ["openssl"],
    "iw": ["iw"],
}
_PACMAN = {
    "tshark": ["wireshark-cli"],
    "dumpcap": ["wireshark-cli"],
    "ip": ["iproute2"],
    "arp-scan": ["arp-scan"],
    "fping": ["fping"],
    "nmap": ["nmap"],
    "avahi-browse": ["avahi"],
    "nbtscan": ["nbtscan"],
    "dig": ["bind"],
    "dot": ["graphviz"],
    "openssl": ["openssl"],
    "iw": ["iw"],
}
_WINGET = {
    "tshark": "Wireshark.Wireshark",
    "dumpcap": "Wireshark.Wireshark",
    "nmap": "Insecure.Nmap",
    "dot": "Graphviz.Graphviz",
    "node": "OpenJS.NodeJS.LTS",
    "openssl": "ShiningLight.OpenSSL",
}


@dataclass(frozen=True)
class Check:
    id: str
    label: str
    required: bool
    ok: bool
    detail: str
    manual: tuple[str, ...] = ()


@dataclass(frozen=True)
class PlanStep:
    id: str
    summary: str
    risk: str  # "local" | "system"
    argv: tuple[str, ...] = ()
    cwd: str | None = None
    fn: str = ""
    optional: bool = False


@dataclass
class Host:
    root: Path
    home: Path
    platform: str
    python: tuple[int, int, int] = field(default_factory=lambda: sys.version_info[:3])
    executable: str = field(default_factory=lambda: sys.executable)
    which: Which = field(default_factory=lambda: shutil.which)
    env_path: str = field(default_factory=lambda: os.environ.get("PATH", ""))
    euid: int | None = None
    isatty: bool = False


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def detect_platform(name: str | None = None) -> str:
    raw = (name or sys.platform).lower()
    if raw.startswith("win"):
        return "windows"
    if raw.startswith("linux"):
        return "linux"
    if raw.startswith("darwin"):
        return "darwin"
    return raw


def default_host(root: Path | None = None) -> Host:
    plat = detect_platform()
    euid: int | None = None
    if plat != "windows":
        try:
            euid = os.geteuid()  # type: ignore[attr-defined]
        except AttributeError:
            euid = None
    return Host(
        root=(root or repo_root()).resolve(),
        home=Path.home(),
        platform=plat,
        python=sys.version_info[:3],
        executable=sys.executable,
        which=shutil.which,
        env_path=os.environ.get("PATH", ""),
        euid=euid,
        isatty=bool(sys.stdin.isatty() and sys.stdout.isatty()),
    )


def venv_python(host: Host) -> Path:
    if host.platform == "windows":
        return host.root / ".venv" / "Scripts" / "python.exe"
    return host.root / ".venv" / "bin" / "python"


def cli_path(host: Host) -> Path:
    return host.root / CLI_NAME


def path_bin_dir(host: Host) -> Path:
    if host.platform == "windows":
        base = os.environ.get("LOCALAPPDATA")
        root = Path(base) if base else host.home / "AppData" / "Local"
        return root / "zoto-viz" / "bin"
    return host.home / ".local" / "bin"


def path_shim(host: Host) -> Path:
    folder = path_bin_dir(host)
    if host.platform == "windows":
        return folder / f"{CLI_NAME}.cmd"
    return folder / CLI_NAME


def posix_shim_text(python: Path, script: Path) -> str:
    return (
        "#!/bin/sh\n"
        f'exec "{python}" "{script}" "$@"\n'
    )


def windows_shim_text(python: Path, script: Path) -> str:
    return (
        "@echo off\n"
        "setlocal EnableExtensions\n"
        f'"{python}" "{script}" %*\n'
        "exit /b %ERRORLEVEL%\n"
    )


def parse_node_version(raw: str) -> tuple[int, int] | None:
    text = raw.strip().lstrip("v").split()[0] if raw.strip() else ""
    parts = text.split(".")
    try:
        return int(parts[0]), int(parts[1] if len(parts) > 1 else 0)
    except (TypeError, ValueError, IndexError):
        return None


def _cmd_text(out: str, err: str) -> str:
    return "\n".join(part.strip() for part in (out, err) if part and part.strip())


def _env_home_root(home: Path, env_key: str, *parts: str, fallback: tuple[str, ...] | None = None) -> Path:
    """Use $ENV only when it lives under this host home, or this is the real $HOME."""
    raw = os.environ.get(env_key)
    if raw:
        p = Path(raw)
        try:
            p.resolve().relative_to(home.resolve())
            return p.joinpath(*parts)
        except (OSError, ValueError):
            if home.resolve() == Path.home().resolve():
                return p.joinpath(*parts)
    if fallback:
        return home.joinpath(*fallback)
    return home.joinpath(*parts)


def _node_bins(home: Path) -> list[Path]:
    """nvm / fnm / volta bin dirs that may hold a Node 22+ the PATH node is missing."""
    roots = [
        _env_home_root(home, "NVM_DIR", "versions", "node", fallback=(".nvm", "versions", "node")),
        _env_home_root(home, "FNM_DIR", "node-versions", fallback=(".local", "share", "fnm", "node-versions")),
        _env_home_root(home, "VOLTA_HOME", "tools", "image", "node", fallback=(".volta", "tools", "image", "node")),
    ]
    bins: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        try:
            kids = list(root.iterdir())
        except OSError:
            continue
        for child in kids:
            for cand in (child / "bin", child / "installation" / "bin", child):
                node = cand / "node"
                if not node.is_file():
                    continue
                key = str(cand.resolve()) if cand.exists() else str(cand)
                if key in seen:
                    continue
                seen.add(key)
                bins.append(cand)
    return bins


def _read_node_ver(run: Run, node: str | None = None) -> tuple[int, int] | None:
    _code, out, err = run([node or "node", "-v"], None)
    return parse_node_version(out or err)


def prefer_node(host: Host, run: Run) -> tuple[Host, str]:
    """If PATH Node is older than 22.12, use the newest nvm/fnm/volta 22+ bin."""
    path_node = host.which("node")
    have = _read_node_ver(run) if path_node else None
    if have and have >= MIN_NODE:
        return host, ""
    best: tuple[tuple[int, int], Path] | None = None
    for bindir in _node_bins(host.home):
        ver = _read_node_ver(run, str(bindir / "node"))
        if ver and ver >= MIN_NODE and (best is None or ver > best[0]):
            best = (ver, bindir)
    if not best:
        return host, ""
    ver, bindir = best
    new_path = f"{bindir}{os.pathsep}{host.env_path}"

    def which(name: str) -> str | None:
        return shutil.which(name, path=new_path)

    note = (
        f"PATH Node is {('v%d.%d' % have) if have else 'missing'}; "
        f"using v{ver[0]}.{ver[1]} at {bindir}. "
        f"New shells still follow nvm default — run: nvm alias default {ver[0]}"
    )
    return replace(host, env_path=new_path, which=which), note


def _run_capture(cmd: list[str], cwd: Path | None = None) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
    except FileNotFoundError:
        return 127, "", f"{cmd[0]} not found"
    except subprocess.TimeoutExpired as exc:
        out = exc.stdout if isinstance(exc.stdout, str) else (exc.stdout or b"").decode("utf-8", "replace")
        err = exc.stderr if isinstance(exc.stderr, str) else (exc.stderr or b"").decode("utf-8", "replace")
        return 124, out, err or "timeout"
    return proc.returncode, proc.stdout or "", proc.stderr or ""


def pkg_manager(host: Host) -> str | None:
    if host.platform == "windows":
        if host.which("winget"):
            return "winget"
        if host.which("choco"):
            return "choco"
        return None
    if host.platform == "darwin":
        return "brew" if host.which("brew") else None
    if host.which("apt-get"):
        return "apt"
    if host.which("dnf"):
        return "dnf"
    if host.which("pacman"):
        return "pacman"
    return None


def _pkg_table(mgr: str | None) -> dict[str, list[str] | str]:
    if mgr == "apt":
        return dict(_APT)
    if mgr == "dnf":
        return dict(_DNF)
    if mgr == "pacman":
        return dict(_PACMAN)
    if mgr == "winget":
        return dict(_WINGET)
    if mgr == "brew":
        return dict(_BREW)
    return {}


def _manual_for(tool: str, host: Host, mgr: str | None) -> tuple[str, ...]:
    table = _pkg_table(mgr)
    spec = table.get(tool)
    if mgr == "apt" and isinstance(spec, list):
        return (f"sudo apt install {' '.join(spec)}",)
    if mgr == "dnf" and isinstance(spec, list):
        return (f"sudo dnf install {' '.join(spec)}",)
    if mgr == "pacman" and isinstance(spec, list):
        return (f"sudo pacman -S {' '.join(spec)}",)
    if mgr == "brew" and isinstance(spec, list):
        return (f"brew install {' '.join(spec)}",)
    if mgr == "winget" and isinstance(spec, str):
        return (f"winget install -e --id {spec}",)
    if mgr == "choco":
        names = {"tshark": "wireshark", "nmap": "nmap", "dot": "graphviz", "node": "nodejs-lts"}
        if tool in names:
            return (f"choco install {names[tool]}",)
    if tool in {"node", "node.js", "nodejs"}:
        if host.platform == "darwin":
            return ("brew install node   # or Node.js 22 LTS from https://nodejs.org",)
        return ("Install Node.js 22.12+ from https://nodejs.org (LTS), then reopen the terminal.",)
    if tool == "python":
        if host.platform == "windows":
            return (
                "Install Python 3.12+ from https://www.python.org/downloads/",
                "On the installer, enable 'Add python.exe to PATH'.",
            )
        if host.platform == "darwin":
            return (
                "brew install python@3.12",
                "Or the installer from https://www.python.org/downloads/ (not Apple's /usr/bin/python3 stub).",
            )
        return ("Install Python 3.12+ (python3) from your distro or https://www.python.org/downloads/",)
    if tool == "tshark" and host.platform == "windows":
        return (
            "Install Wireshark (includes tshark) from https://www.wireshark.org/download.html",
            "Enable Npcap when the installer asks.",
        )
    if tool == "tshark" and host.platform == "darwin":
        return (
            "Install Homebrew from https://brew.sh if needed",
            "brew install wireshark",
            "brew install --cask wireshark-chmodbpf   # capture without root; then log out",
            "Or install Wireshark.app from https://www.wireshark.org/download.html",
        )
    if tool == "brew":
        return (
            '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
            'Then reopen the terminal (Apple Silicon: eval "$(/opt/homebrew/bin/brew shellenv)").',
        )
    if tool == "wireshark-group":
        return (
            "sudo usermod -aG wireshark $USER",
            "Log out and back in (new shells must carry the group).",
        )
    if tool == "access-bpf":
        return (
            "brew install --cask wireshark-chmodbpf",
            "Log out and back in so /dev/bpf* is readable (access_bpf group).",
        )
    return (f"Install '{tool}' using your OS package manager, then reopen the terminal.",)


def _tool_ok(host: Host, name: str) -> bool:
    if host.which(name):
        return True
    if host.platform == "darwin" and name == "tshark":
        for cand in DARWIN_TSHARK:
            if Path(cand).is_file():
                return True
    # dumpcap is often 750 root:wireshark; existence is enough to know the package is there
    for part in host.env_path.split(os.pathsep):
        if part and (Path(part) / name).exists():
            return True
        if host.platform == "windows" and part:
            for ext in (".exe", ".bat", ".cmd"):
                if (Path(part) / f"{name}{ext}").exists():
                    return True
    return False


def _python_check(host: Host) -> Check:
    ver = host.python
    ok = (ver[0], ver[1]) >= MIN_PYTHON
    detail = f"{ver[0]}.{ver[1]}.{ver[2] if len(ver) > 2 else 0} ({host.executable})"
    return Check(
        id="python",
        label="Python 3.12+",
        required=True,
        ok=ok,
        detail=detail if ok else f"{detail} — need {MIN_PYTHON[0]}.{MIN_PYTHON[1]}+",
        manual=() if ok else _manual_for("python", host, pkg_manager(host)),
    )


def _node_check(host: Host, run: Run) -> Check:
    path = host.which("node")
    if not path:
        return Check(
            id="node",
            label="Node.js 22.12+",
            required=True,
            ok=False,
            detail="not on PATH",
            manual=_manual_for("node", host, pkg_manager(host)),
        )
    parsed = _read_node_ver(run)
    if parsed is None:
        return Check(
            id="node",
            label="Node.js 22.12+",
            required=True,
            ok=False,
            detail=f"{path} (could not read version)",
            manual=_manual_for("node", host, pkg_manager(host)),
        )
    ok = parsed >= MIN_NODE
    detail = f"v{parsed[0]}.{parsed[1]} ({path})"
    return Check(
        id="node",
        label="Node.js 22.12+",
        required=True,
        ok=ok,
        detail=detail if ok else f"{detail} — need v{MIN_NODE[0]}.{MIN_NODE[1]}+",
        manual=() if ok else _manual_for("node", host, pkg_manager(host)),
    )


def _wireshark_group_ok() -> bool:
    try:
        import grp
        import pwd

        gid = grp.getgrnam("wireshark").gr_gid
        if gid in os.getgroups():
            return True
        user = pwd.getpwuid(os.getuid()).pw_name
        return user in grp.getgrnam("wireshark").gr_mem
    except (ImportError, KeyError, OSError):
        return False


def _access_bpf_ok() -> bool:
    for i in range(4):
        path = Path(f"/dev/bpf{i}")
        try:
            if path.exists() and os.access(path, os.R_OK):
                return True
        except OSError:
            continue
    try:
        import grp
        import pwd

        gid = grp.getgrnam("access_bpf").gr_gid
        if gid in os.getgroups():
            return True
        user = pwd.getpwuid(os.getuid()).pw_name
        return user in grp.getgrnam("access_bpf").gr_mem
    except (ImportError, KeyError, OSError):
        return False


def gather_checks(host: Host, run: Run | None = None) -> list[Check]:
    run = run or _run_capture
    mgr = pkg_manager(host)
    checks = [_python_check(host), _node_check(host, run)]

    if host.platform == "darwin":
        brew = host.which("brew")
        checks.append(
            Check(
                id="brew",
                label="Homebrew",
                required=False,
                ok=bool(brew),
                detail=brew or "not on PATH",
                manual=() if brew else _manual_for("brew", host, mgr),
            )
        )

    required_tools: list[tuple[str, str]] = [("tshark", "tshark (Wireshark CLI)")]
    if host.platform == "linux":
        required_tools.append(("ip", "iproute2 (`ip`)"))
    optional_tools: list[tuple[str, str]] = [
        ("arp-scan", "arp-scan"),
        ("fping", "fping"),
        ("nmap", "nmap"),
        ("dot", "graphviz (`dot`)"),
        ("openssl", "openssl"),
    ]
    if host.platform == "linux":
        optional_tools.extend(
            [
                ("avahi-browse", "avahi-utils"),
                ("nbtscan", "nbtscan"),
                ("dig", "bind9-dnsutils (`dig`)"),
                ("iw", "iw (Wi-Fi link/scan)"),
            ]
        )

    for tid, label in required_tools:
        ok = _tool_ok(host, tid)
        checks.append(
            Check(
                id=tid,
                label=label,
                required=True,
                ok=ok,
                detail="on PATH" if ok else "not on PATH",
                manual=() if ok else _manual_for(tid, host, mgr),
            )
        )
    for tid, label in optional_tools:
        ok = _tool_ok(host, tid)
        checks.append(
            Check(
                id=tid,
                label=label,
                required=False,
                ok=ok,
                detail="on PATH" if ok else "not on PATH",
                manual=() if ok else _manual_for(tid, host, mgr),
            )
        )

    if host.platform == "linux":
        ok = _wireshark_group_ok()
        checks.append(
            Check(
                id="wireshark-group",
                label="wireshark group (dumpcap)",
                required=False,
                ok=ok,
                detail="active or listed in /etc/group" if ok else "user not in wireshark group",
                manual=() if ok else _manual_for("wireshark-group", host, mgr),
            )
        )
    if host.platform == "darwin":
        ok = _access_bpf_ok()
        checks.append(
            Check(
                id="access-bpf",
                label="BPF capture (ChmodBPF / access_bpf)",
                required=False,
                ok=ok,
                detail="can read /dev/bpf*" if ok else "need ChmodBPF (then log out)",
                manual=() if ok else _manual_for("access-bpf", host, mgr),
            )
        )
    return checks


def _sudo_prefix(host: Host) -> list[str]:
    if host.platform == "windows":
        return []
    if host.euid == 0:
        return []
    return ["sudo"]


def _os_package_argv(host: Host, tools: Iterable[str]) -> list[str] | None:
    mgr = pkg_manager(host)
    table = _pkg_table(mgr)
    names: list[str] = []
    seen: set[str] = set()
    for tool in tools:
        spec = table.get(tool)
        if isinstance(spec, list):
            for pkg in spec:
                if pkg not in seen:
                    seen.add(pkg)
                    names.append(pkg)
        elif isinstance(spec, str) and spec not in seen:
            seen.add(spec)
            names.append(spec)
    if not names:
        return None
    sudo = _sudo_prefix(host)
    if mgr == "apt":
        return [*sudo, "apt-get", "install", "-y", *names]
    if mgr == "dnf":
        return [*sudo, "dnf", "install", "-y", *names]
    if mgr == "pacman":
        return [*sudo, "pacman", "-S", "--noconfirm", *names]
    if mgr == "brew":
        return ["brew", "install", *names]
    if mgr == "winget":
        # winget can only install one id cleanly per invocation; first required
        return ["winget", "install", "-e", "--accept-package-agreements", "--accept-source-agreements", names[0]]
    if mgr == "choco":
        return [*sudo, "choco", "install", "-y", *names]
    return None


def build_plan(host: Host, checks: Sequence[Check], *, no_system: bool = False) -> list[PlanStep]:
    steps: list[PlanStep] = []
    missing = [c for c in checks if not c.ok]
    missing_ids = {c.id for c in missing}

    if not no_system:
        auto_ids = [c.id for c in missing if c.id not in {"python", "wireshark-group", "access-bpf", "brew"}]
        if pkg_manager(host) == "winget":
            table = _pkg_table("winget")
            seen: set[str] = set()
            for tid in auto_ids:
                spec = table.get(tid)
                if isinstance(spec, str) and spec not in seen:
                    seen.add(spec)
                    argv = (
                        "winget",
                        "install",
                        "-e",
                        "--accept-package-agreements",
                        "--accept-source-agreements",
                        spec,
                    )
                    steps.append(
                        PlanStep(
                            id=f"os-packages-{spec}",
                            summary=f"winget install {spec}",
                            risk="system",
                            argv=argv,
                        )
                    )
        else:
            argv = _os_package_argv(host, auto_ids)
            if argv:
                steps.append(
                    PlanStep(
                        id="os-packages",
                        summary="install missing OS packages",
                        risk="system",
                        argv=tuple(argv),
                    )
                )
        if "wireshark-group" in missing_ids and host.platform == "linux":
            user = os.environ.get("USER") or os.environ.get("USERNAME") or "$USER"
            steps.append(
                PlanStep(
                    id="wireshark-group",
                    summary=f"add {user} to the wireshark group (then log out)",
                    risk="system",
                    argv=tuple([*_sudo_prefix(host), "usermod", "-aG", "wireshark", user]),
                )
            )
        if "access-bpf" in missing_ids and host.platform == "darwin" and host.which("brew"):
            steps.append(
                PlanStep(
                    id="access-bpf",
                    summary="brew install --cask wireshark-chmodbpf (then log out)",
                    risk="system",
                    argv=("brew", "install", "--cask", "wireshark-chmodbpf"),
                )
            )

    py = venv_python(host)
    steps.append(
        PlanStep(
            id="venv",
            summary=f"create {host.root / '.venv'} if missing",
            risk="local",
            fn="create_venv",
        )
    )
    steps.append(
        PlanStep(
            id="pip",
            summary="pip install -r requirements.txt into the venv",
            risk="local",
            fn="pip_install",
        )
    )
    node_ok = next((c.ok for c in checks if c.id == "node"), False)
    if node_ok:
        steps.append(
            PlanStep(
                id="corepack",
                summary="corepack enable && corepack prepare pnpm@latest --activate",
                risk="local",
                fn="setup_pnpm",
            )
        )
        steps.append(
            PlanStep(
                id="web",
                summary="pnpm install && pnpm build in web/",
                risk="local",
                fn="web_build",
            )
        )
    steps.append(
        PlanStep(
            id="shim",
            summary=f"write PATH shim {path_shim(host)} → {py} {cli_path(host)}",
            risk="local",
            fn="write_shim",
        )
    )
    steps.append(
        PlanStep(
            id="user-path",
            summary=f"ensure {path_bin_dir(host)} is on the user PATH",
            risk="local",
            fn="ensure_user_path",
        )
    )
    steps.append(
        PlanStep(
            id="sys-config",
            summary="write ~/.zoto-viz/sys-config.yml (existing keys kept)",
            risk="local",
            fn="write_sysconfig",
        )
    )
    if host.platform == "linux":
        steps.append(
            PlanStep(
                id="systemd",
                summary="install systemd user unit + checkout override (not enabled)",
                risk="local",
                fn="install_systemd_user",
                optional=True,
            )
        )
    if host.platform == "darwin":
        steps.append(
            PlanStep(
                id="launchd",
                summary="write LaunchAgent com.zoto-viz.monitor (not loaded)",
                risk="local",
                fn="install_launchd_user",
                optional=True,
            )
        )
    return steps


def format_checks(checks: Sequence[Check]) -> str:
    lines = ["== Prerequisites =="]
    for c in checks:
        flag = "ok" if c.ok else ("MISSING" if c.required else "skip")
        lines.append(f"  [{flag}] {c.label}: {c.detail}")
        if not c.ok and c.manual:
            lines.append("         manual:")
            for inst in c.manual:
                lines.append(f"           {inst}")
    return "\n".join(lines)


def format_plan(steps: Sequence[PlanStep]) -> str:
    lines = ["== Install plan =="]
    if not steps:
        lines.append("  (nothing to do)")
        return "\n".join(lines)
    for i, step in enumerate(steps, 1):
        risk = "SYSTEM" if step.risk == "system" else "local"
        extra = f"  [{risk}]"
        lines.append(f"  {i}. {step.summary}{extra}")
        if step.argv:
            lines.append(f"       $ {' '.join(step.argv)}")
    return "\n".join(lines)


def prompt_yes(question: str, *, yes: bool, isatty: bool, stdin: TextIO, stdout: TextIO) -> bool:
    if yes:
        return True
    if not isatty:
        return False
    stdout.write(f"{question} [y/N] ")
    stdout.flush()
    try:
        reply = (stdin.readline() or "").strip().lower()
    except EOFError:
        return False
    return reply in {"y", "yes"}


def write_shim(host: Host) -> Path:
    dest = path_shim(host)
    dest.parent.mkdir(parents=True, exist_ok=True)
    python = venv_python(host)
    script = cli_path(host)
    if host.platform == "windows":
        dest.write_text(windows_shim_text(python, script), encoding="utf-8")
    else:
        dest.write_text(posix_shim_text(python, script), encoding="utf-8")
        dest.chmod(dest.stat().st_mode | 0o111)
        try:
            script.chmod(script.stat().st_mode | 0o111)
        except OSError:
            pass
    return dest


def _path_contains(env_path: str, directory: Path) -> bool:
    target = str(directory)
    parts = env_path.split(os.pathsep)
    for part in parts:
        if not part:
            continue
        try:
            if Path(part).expanduser().resolve() == directory.resolve():
                return True
        except OSError:
            if part.rstrip("\\/") == target.rstrip("\\/"):
                return True
    return False


def _append_profile_path(profile: Path, directory: Path) -> bool:
    export = f'export PATH="{directory}:$PATH"'
    existing = profile.read_text(encoding="utf-8") if profile.is_file() else ""
    if PROFILE_MARK in existing or export in existing:
        return False
    profile.parent.mkdir(parents=True, exist_ok=True)
    addition = f"\n{PROFILE_MARK}\n{export}\n"
    profile.write_text(existing + addition, encoding="utf-8")
    return True


def _posix_profile_files(host: Host) -> list[Path]:
    if host.platform == "darwin":
        return [host.home / ".zprofile", host.home / ".zshrc", host.home / ".profile"]
    files = [host.home / ".profile"]
    bashrc = host.home / ".bashrc"
    if bashrc.is_file() or not files[0].is_file():
        files.append(bashrc)
    return files


def ensure_user_path_posix(host: Host) -> str:
    folder = path_bin_dir(host)
    if _path_contains(host.env_path, folder):
        return "already-on-path"
    wrote = False
    for profile in _posix_profile_files(host):
        if _append_profile_path(profile, folder):
            wrote = True
    return "profile-updated" if wrote else "already-in-profile"


def ensure_user_path_windows(directory: Path) -> str:
    import winreg  # type: ignore[attr-defined]

    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment", 0, winreg.KEY_READ | winreg.KEY_WRITE) as key:
        try:
            current, _typ = winreg.QueryValueEx(key, "Path")
        except FileNotFoundError:
            current = ""
        parts = [p for p in str(current).split(";") if p]
        target = str(directory)
        if any(p.rstrip("\\/") == target.rstrip("\\/") for p in parts):
            return "already-on-path"
        parts.append(target)
        winreg.SetValueEx(key, "Path", 0, winreg.REG_EXPAND_SZ, ";".join(parts))
    try:
        import ctypes

        HWND_BROADCAST = 0xFFFF
        WM_SETTINGCHANGE = 0x001A
        ctypes.windll.user32.SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, "Environment", 0, 1000, None)
    except (AttributeError, OSError):
        pass
    return "user-path-updated"


def ensure_user_path(host: Host) -> str:
    folder = path_bin_dir(host)
    folder.mkdir(parents=True, exist_ok=True)
    if host.platform == "windows":
        return ensure_user_path_windows(folder)
    return ensure_user_path_posix(host)


def create_venv(host: Host, run: Run) -> None:
    py = venv_python(host)
    if py.is_file():
        return
    code, _out, err = run([host.executable, "-m", "venv", str(host.root / ".venv")], host.root)
    if code != 0:
        raise RuntimeError(err.strip() or "venv create failed")


def pip_install(host: Host, run: Run) -> None:
    py = venv_python(host)
    req = host.root / "requirements.txt"
    code, _out, err = run([str(py), "-m", "pip", "install", "-r", str(req)], host.root)
    if code != 0:
        raise RuntimeError(err.strip() or "pip install failed")


def _pnpm_works(host: Host, run: Run) -> bool:
    pnpm = host.which("pnpm")
    if not pnpm:
        return False
    code, out, err = run([pnpm, "-v"], None)
    text = _cmd_text(out, err)
    if code != 0 or "MODULE_NOT_FOUND" in text or "pnpm.cjs" in text:
        return False
    return True


def setup_pnpm(host: Host, run: Run) -> None:
    corepack = host.which("corepack")
    if not corepack:
        raise RuntimeError("corepack not on PATH (it ships with Node 16.13+). Reopen the terminal after installing Node 22.")
    enable = run([corepack, "enable"], host.root)
    if enable[0] != 0:
        sudo = _sudo_prefix(host)
        if sudo:
            enable = run([*sudo, corepack, "enable"], host.root)
        if enable[0] != 0:
            raise RuntimeError(_cmd_text(enable[1], enable[2]) or "corepack enable failed")
    prep = run([corepack, "prepare", "pnpm@latest", "--activate"], host.root)
    if prep[0] != 0:
        raise RuntimeError(_cmd_text(prep[1], prep[2]) or "corepack prepare pnpm failed")
    if _pnpm_works(host, run):
        return
    # Node 18 corepack looks for pnpm.cjs; Node 22 writes pnpm.mjs into the same cache.
    retry = run([corepack, "prepare", "pnpm@latest", "--activate"], host.root)
    if retry[0] != 0 or not _pnpm_works(host, run):
        raise RuntimeError(
            _cmd_text(retry[1], retry[2])
            or "pnpm shim is broken (stale corepack cache). "
            "Use Node 22.12+ and re-run: corepack prepare pnpm@latest --activate"
        )


def web_build(host: Host, run: Run) -> None:
    pnpm = host.which("pnpm")
    if not pnpm:
        raise RuntimeError("pnpm not on PATH after corepack; reopen the terminal (Node 22.12+) and re-run install")
    if not _pnpm_works(host, run):
        raise RuntimeError(
            "pnpm does not run (often Node 18 + a Node 22 corepack cache). "
            "nvm use 22 && corepack prepare pnpm@latest --activate"
        )
    web = host.root / "web"
    inst = run([pnpm, "install"], web)
    if inst[0] != 0:
        raise RuntimeError(_cmd_text(inst[1], inst[2]) or "pnpm install failed")
    run([pnpm, "approve-builds", "esbuild"], web)  # pnpm 10+; ignore failure
    asb = run([pnpm, "asbuild"], web)
    if asb[0] != 0:
        if not (web / "node_modules" / ".bin" / "asc").is_file():
            inst = run([pnpm, "install"], web)
            if inst[0] != 0:
                raise RuntimeError(_cmd_text(inst[1], inst[2]) or "pnpm install failed (assemblyscript)")
            asb = run([pnpm, "asbuild"], web)
        if asb[0] != 0:
            raise RuntimeError("asbuild failed:\n" + (_cmd_text(asb[1], asb[2]) or "asc exit 1"))
    tsc = run([pnpm, "exec", "tsc", "--noEmit"], web)
    if tsc[0] != 0:
        raise RuntimeError("tsc --noEmit failed:\n" + (_cmd_text(tsc[1], tsc[2]) or "tsc exit 1"))
    vite = run([pnpm, "exec", "vite", "build"], web)
    if vite[0] != 0:
        raise RuntimeError("vite build failed:\n" + (_cmd_text(vite[1], vite[2]) or "vite exit 1"))
    bridge = host.root / "service" / "cursor-bridge"
    if (bridge / "package.json").is_file():
        br = run([pnpm, "install"], bridge)
        if br[0] != 0:
            raise RuntimeError("cursor-bridge pnpm install failed:\n" + (_cmd_text(br[1], br[2]) or "exit 1"))


def write_sysconfig() -> None:
    from . import sysconfig

    sysconfig.cli_install()


def install_systemd_user(host: Host) -> None:
    src = host.root / "systemd" / "zoto-viz-monitor.service"
    dest_dir = host.home / ".config" / "systemd" / "user"
    dest = dest_dir / "zoto-viz-monitor.service"
    if not src.is_file():
        return
    dest_dir.mkdir(parents=True, exist_ok=True)
    if not dest.is_file():
        shutil.copyfile(src, dest)
    from . import sysconfig

    sysconfig.write_systemd_override(sysconfig.ensure())
    subprocess.run(["systemctl", "--user", "daemon-reload"], capture_output=True, check=False)


def launchd_plist_text(root: Path, python: Path, home: Path, cfg: dict | None = None) -> str:
    abs_root = str(root.expanduser().resolve())
    abs_py = str(python)
    log = str(home / ".zoto-viz" / "monitor.log")
    err = str(home / ".zoto-viz" / "monitor.err")
    try:
        from . import sysconfig

        args = sysconfig.monitor_cli_args(cfg)
        inhibit = bool(sysconfig.listen_opts(cfg or {}).get("inhibit_screensaver"))
    except Exception:
        args = ["-m", "service.monitor", "--bind", "127.0.0.1", "--port", "7020"]
        inhibit = False
    argv = [abs_py, *args]
    if inhibit:
        argv = ["/usr/bin/caffeinate", "-dimsu", *argv]
    arg_xml = "\n".join(f"    <string>{item}</string>" for item in argv)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.zoto-viz.monitor</string>
  <key>WorkingDirectory</key>
  <string>{abs_root}</string>
  <key>ProgramArguments</key>
  <array>
{arg_xml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ZOTO_VIZ_ROOT</key>
    <string>{abs_root}</string>
    <key>ZOTO_VIZ_REPO_ROOT</key>
    <string>{abs_root}</string>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>{log}</string>
  <key>StandardErrorPath</key>
  <string>{err}</string>
</dict>
</plist>
"""


def launchd_plist_path(host: Host) -> Path:
    return host.home / "Library" / "LaunchAgents" / "com.zoto-viz.monitor.plist"


def install_launchd_user(host: Host, cfg: dict | None = None) -> Path:
    dest = launchd_plist_path(host)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(launchd_plist_text(host.root, venv_python(host), host.home, cfg=cfg), encoding="utf-8")
    return dest


def apply_step(step: PlanStep, host: Host, run: Run) -> str:
    if step.argv:
        cwd = Path(step.cwd) if step.cwd else host.root
        code, out, err = run(list(step.argv), cwd)
        if code != 0:
            raise RuntimeError((err or out).strip() or f"exit {code}")
        return (out or err).strip() or "ok"
    fn = step.fn
    if fn == "create_venv":
        create_venv(host, run)
        return str(venv_python(host))
    if fn == "pip_install":
        pip_install(host, run)
        return "ok"
    if fn == "setup_pnpm":
        setup_pnpm(host, run)
        return "ok"
    if fn == "web_build":
        web_build(host, run)
        return "ok"
    if fn == "write_shim":
        return str(write_shim(host))
    if fn == "ensure_user_path":
        return ensure_user_path(host)
    if fn == "write_sysconfig":
        write_sysconfig()
        return "ok"
    if fn == "install_systemd_user":
        install_systemd_user(host)
        return "ok"
    if fn == "install_launchd_user":
        cfg = None
        try:
            from . import sysconfig

            cfg = sysconfig.load()
        except Exception:
            cfg = None
        return str(install_launchd_user(host, cfg=cfg))
    raise RuntimeError(f"unknown step {step.id}")


def hopper_notes(host: Host) -> list[str]:
    if host.platform != "linux":
        return []
    try:
        from . import sysconfig

        cfg = sysconfig.load()
        return sysconfig.hopper_install_hint(cfg, host.home)
    except Exception:
        return []


def cli_install(
    *,
    dry_run: bool = False,
    yes: bool = False,
    no_system: bool = False,
    host: Host | None = None,
    run: Run | None = None,
    stdin: TextIO | None = None,
    stdout: TextIO | None = None,
) -> int:
    host = host or default_host()
    run = run or _run_capture
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout

    def emit(text: str) -> None:
        stdout.write(text + ("" if text.endswith("\n") else "\n"))

    if (host.python[0], host.python[1]) < MIN_PYTHON:
        emit(format_checks([_python_check(host)]))
        emit("Python 3.12+ is required. Install it, then re-run zoto-viz install.")
        return 1

    host, node_note = prefer_node(host, run)
    if node_note:
        os.environ["PATH"] = host.env_path
        emit(node_note)
    checks = gather_checks(host, run)
    emit(format_checks(checks))
    node_check = next((c for c in checks if c.id == "node"), None)
    if node_check is not None and not node_check.ok:
        emit("Node.js 22.12+ is required for the web UI (nvm default 18 is not enough).")
        emit("Install Node 22 LTS or: nvm install 22 && nvm alias default 22")
        return 1
    plan = build_plan(host, checks, no_system=no_system)
    system_steps = [s for s in plan if s.risk == "system"]

    if system_steps:
        emit("")
        emit("System steps change OS packages or groups (sudo/brew/winget). They can fail or need a new login.")
        accepted = prompt_yes(
            "Attempt those system steps anyway, accepting the risk?",
            yes=yes,
            isatty=host.isatty,
            stdin=stdin,
            stdout=stdout,
        )
        if not accepted:
            emit("Skipping system steps. Manual instructions are listed above.")
            plan = [s for s in plan if s.risk != "system"]

    emit("")
    emit(format_plan(plan))

    if dry_run:
        emit("(dry-run: nothing applied)")
        notes = hopper_notes(host)
        if notes:
            emit("Hopper (manual, root radio):")
            for line in notes:
                emit(f"  {line}")
        emit(f"After install, open a new terminal and run: {CLI_NAME} --help")
        return 0

    if not yes:
        applied = prompt_yes(
            "Apply this plan?",
            yes=False,
            isatty=host.isatty,
            stdin=stdin,
            stdout=stdout,
        )
        if not applied:
            if host.isatty:
                emit("Aborted.")
                return 1
            emit("Non-interactive: applying local steps only. Pass --yes to include prompts.")

    failures: list[str] = []
    for step in plan:
        emit(f"-> {step.summary}")
        try:
            result = apply_step(step, host, run)
            emit(f"   {result}")
        except Exception as exc:
            msg = str(exc).strip() or step.id
            emit(f"   FAILED: {msg}")
            if step.optional:
                continue
            failures.append(f"{step.id}: {msg}")

    notes = hopper_notes(host)
    if notes:
        emit("Hopper (manual, root radio):")
        for line in notes:
            emit(f"  {line}")

    shim = path_shim(host)
    emit(f"CLI shim  {shim}")
    emit("Open a new terminal so PATH picks up the shim, then: zoto-viz --help")
    if host.platform == "linux":
        emit("Optional daemon: systemctl --user enable --now zoto-viz-monitor")
    if host.platform == "darwin":
        plist = launchd_plist_path(host)
        emit(f"Optional daemon: launchctl load {plist}")
    if failures:
        emit("Install finished with errors:")
        for line in failures:
            emit(f"  {line}")
        return 1
    return 0
