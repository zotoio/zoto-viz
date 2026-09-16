"""Machine-local layout at ~/.zoto-viz/sys-config.yml.

Checkout path, hostname, Wi-Fi interfaces, and watched SSIDs stay off git.
`zoto-viz install` and the first monitor start detect missing keys and write the
file (existing values are kept). The user systemd drop-in is filled from it.
"""
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
from pathlib import Path
from typing import Any, Callable

import yaml

from . import paths

KEYS = ("root", "hostname", "iface", "monitor_iface", "ssids")
HEADER = (
    "# Machine-local zoto-viz layout. Do not commit this file.\n"
    "# Written on zoto-viz install / first monitor start; existing keys are kept.\n"
)
REPO = Path(__file__).resolve().parents[1]
Run = Callable[[list[str]], str]


def sys_config_file() -> Path:
    return paths.sys_config_file()


def systemd_dropin() -> Path:
    return Path.home() / ".config" / "systemd" / "user" / "zoto-viz-monitor.service.d" / "override.conf"


def _run(cmd: list[str]) -> str:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=8, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return proc.stdout if proc.returncode == 0 else ""


def _present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(str(v).strip() for v in value)
    return True


def _ssids(raw: Any) -> list[str]:
    if isinstance(raw, str):
        raw = raw.split(",")
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        s = str(item).strip()
        if s and s not in out:
            out.append(s)
    return out[:16]


def load(path: Path | None = None) -> dict[str, Any]:
    path = path or sys_config_file()
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        "root": str(raw.get("root") or "").strip(),
        "hostname": str(raw.get("hostname") or "").strip(),
        "iface": str(raw.get("iface") or "").strip(),
        "monitor_iface": str(raw.get("monitor_iface") or "").strip(),
        "ssids": _ssids(raw.get("ssids")),
    }


def dump(cfg: dict[str, Any]) -> str:
    body = {
        "root": str(cfg.get("root") or ""),
        "hostname": str(cfg.get("hostname") or ""),
        "iface": str(cfg.get("iface") or ""),
        "monitor_iface": str(cfg.get("monitor_iface") or ""),
        "ssids": _ssids(cfg.get("ssids")),
    }
    return HEADER + yaml.safe_dump(body, sort_keys=False, default_flow_style=False)


def save(cfg: dict[str, Any], path: Path | None = None) -> Path:
    path = path or sys_config_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump(cfg), encoding="utf-8")
    os.chmod(path, 0o600)
    return path


def _default_iface(run: Run) -> str:
    raw = run(["ip", "-j", "route", "show", "default"])
    try:
        rows = json.loads(raw or "[]")
    except json.JSONDecodeError:
        rows = []
    if isinstance(rows, list) and rows:
        dev = rows[0].get("dev") if isinstance(rows[0], dict) else ""
        if str(dev or "").strip():
            return str(dev).strip()
    for line in (run(["route", "-n", "get", "default"]) or "").splitlines():
        text = line.strip()
        if text.lower().startswith("interface:"):
            return text.split(":", 1)[1].strip()
    return ""


def _wifi_devices(run: Run) -> list[str]:
    out: list[str] = []
    for line in (run(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device", "status"]) or "").splitlines():
        parts = line.split(":")
        if len(parts) < 2:
            continue
        name, kind = parts[0], parts[1]
        if kind == "wifi" and name and name not in out:
            out.append(name)
    if out:
        return out
    for line in (run(["iw", "dev"]) or "").splitlines():
        m = re.search(r"Interface\s+(\S+)", line)
        if m and m.group(1) not in out:
            out.append(m.group(1))
    if out:
        return out
    pending = False
    for line in (run(["networksetup", "-listallhardwareports"]) or "").splitlines():
        if re.search(r"Hardware Port:\s*Wi-Fi", line, re.I):
            pending = True
            continue
        if pending:
            m = re.search(r"Device:\s*(\S+)", line)
            if m and m.group(1) not in out:
                out.append(m.group(1))
            pending = False
    return out


def _associated_ssid(run: Run, iface: str) -> str:
    if iface:
        for line in (run(["iw", "dev", iface, "link"]) or "").splitlines():
            if line.strip().upper().startswith("SSID:"):
                return line.split(":", 1)[1].strip()
        info = run(["iw", "dev", iface, "info"])
        m = re.search(r"ssid\s+(\S+)", info, re.I)
        if m:
            return m.group(1).strip()
    for line in (run(["nmcli", "-t", "-f", "IN-USE,SSID", "dev", "wifi"]) or "").splitlines():
        if line.startswith("*:"):
            return line.split(":", 1)[1].strip().replace("\\:", ":")
        if line.startswith("*"):
            parts = line.split(":", 1)
            if len(parts) == 2:
                return parts[1].strip().replace("\\:", ":")
    if iface:
        air = run(["networksetup", "-getairportnetwork", iface])
        if air and "not associated" not in air.lower():
            if ":" in air:
                return air.split(":", 1)[1].strip()
    return ""


def _watch_ssids() -> list[str]:
    path = paths.config_dir() / "wifi-watch.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(raw, dict):
        return []
    return _ssids(raw.get("ssids"))


def _plan_ssids() -> list[str]:
    path = paths.config_dir() / "wifi-hop.plan"
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    out: list[str] = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        parts = s.split(None, 4)
        if len(parts) < 5:
            continue
        for name in parts[4].split(","):
            name = name.strip()
            if name and name not in out:
                out.append(name)
    return out[:16]


def detect(run: Run | None = None) -> dict[str, Any]:
    run = run or _run
    iface = _default_iface(run)
    wifi = _wifi_devices(run)
    if iface not in wifi and wifi:
        # default route may be ethernet; prefer the associated Wi-Fi radio for Air SSIDs
        iface = wifi[0]
    monitor = next((n for n in wifi if n != iface and n.startswith("wlx")), "")
    if not monitor:
        monitor = next((n for n in wifi if n != iface), "")
    ssids = _watch_ssids() or _plan_ssids()
    assoc = _associated_ssid(run, iface)
    if assoc and assoc not in ssids:
        ssids = [assoc, *ssids]
    return {
        "root": str(REPO),
        "hostname": socket.gethostname(),
        "iface": iface,
        "monitor_iface": monitor,
        "ssids": ssids[:16],
    }


def merge(existing: dict[str, Any], detected: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in KEYS:
        have, found = existing.get(key), detected.get(key)
        out[key] = have if _present(have) else (found if _present(found) else (have or found or ([] if key == "ssids" else "")))
    out["ssids"] = _ssids(out.get("ssids"))
    return out


def ensure(path: Path | None = None, run: Run | None = None) -> dict[str, Any]:
    """Create or fill ~/.zoto-viz/sys-config.yml. Existing keys win."""
    path = path or sys_config_file()
    existing = load(path) if path.is_file() else {}
    cfg = merge(existing, detect(run=run))
    if cfg != existing or not path.is_file():
        save(cfg, path)
    return cfg


def apply_watch_default(path: Path, ssids: list[str]) -> bool:
    """Set `config.watch.default` in an Air SSIDs plugin YAML. Comments stay."""
    names = _ssids(ssids)
    if not names or not path.is_file():
        return False
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    in_watch = False
    changed = False
    for line in lines:
        if re.match(r"^  - key: watch\s*$", line):
            in_watch = True
            out.append(line)
            continue
        if in_watch and re.match(r"^  - key:", line):
            in_watch = False
        if in_watch and re.match(r"^    default:", line):
            ending = "\r\n" if line.endswith("\r\n") else ("\n" if line.endswith("\n") else "")
            replacement = f"    default: {', '.join(names)}{ending}"
            changed = replacement != line
            out.append(replacement)
            in_watch = False
            continue
        out.append(line)
    if not changed:
        return False
    path.write_text("".join(out), encoding="utf-8")
    return True


HOPPER_SCRIPT_DST = Path("/usr/local/sbin/zoto-viz-wifi-monitor")
HOPPER_UNIT_DST = Path("/etc/systemd/system/zoto-viz-wifi-monitor@.service")
HOPPER_ENV_DST = Path("/etc/zoto-viz/hopper.env")


def hopper_env_text(home: Path | None = None) -> str:
    """Environment for the root hopper: the operator's wifi-hop.plan, not /root."""
    plan = (home or Path.home()) / ".config" / "zoto-viz" / "wifi-hop.plan"
    return (
        "# generated by zoto-viz install — hop plan for zoto-viz-wifi-monitor@.service\n"
        f"ZOTO_VIZ_HOP_PLAN={plan}\n"
    )


def hopper_install_hint(cfg: dict[str, Any], home: Path | None = None) -> list[str]:
    """sudo commands that put monitor_iface into monitor mode and start the hopper."""
    mon = str(cfg.get("monitor_iface") or "").strip()
    if not mon:
        return []
    src_sh = REPO / "systemd" / "zoto-viz-wifi-monitor.sh"
    src_unit = REPO / "systemd" / "zoto-viz-wifi-monitor@.service"
    plan = (home or Path.home()) / ".config" / "zoto-viz" / "wifi-hop.plan"
    return [
        f"sudo install -D {src_sh} {HOPPER_SCRIPT_DST}",
        f"sudo cp {src_unit} {HOPPER_UNIT_DST}",
        f"sudo mkdir -p {HOPPER_ENV_DST.parent} && echo ZOTO_VIZ_HOP_PLAN={plan} | sudo tee {HOPPER_ENV_DST}",
        "sudo systemctl daemon-reload",
        f"sudo systemctl enable --now zoto-viz-wifi-monitor@{mon}",
    ]


def write_systemd_override(cfg: dict[str, Any], path: Path | None = None) -> Path | None:
    root = str(cfg.get("root") or "").strip()
    if not root:
        return None
    dest = path or systemd_dropin()
    if path is None:
        unit = dest.parent.parent / "zoto-viz-monitor.service"
        if not unit.is_file():
            return None
    path = dest
    # Resolve now so the user unit pins the checkout even if its cwd differs.
    abs_root = str(Path(root).expanduser().resolve())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "# generated by zoto-viz from ~/.zoto-viz/sys-config.yml — do not copy this into git\n"
        "[Service]\n"
        f"WorkingDirectory={abs_root}\n"
        f"Environment=ZOTO_VIZ_ROOT={abs_root}\n"
        f"Environment=ZOTO_VIZ_REPO_ROOT={abs_root}\n"
        "ExecStart=\n"
        f"ExecStart={abs_root}/.venv/bin/python -m service.monitor --bind 127.0.0.1 --port 7020\n",
        encoding="utf-8",
    )
    return path


def describe(cfg: dict[str, Any]) -> list[str]:
    ssids = ", ".join(_ssids(cfg.get("ssids"))) or "(none yet)"
    return [
        f"root           {cfg.get('root') or '—'}",
        f"hostname       {cfg.get('hostname') or '—'}",
        f"iface          {cfg.get('iface') or '—'}",
        f"monitor_iface  {cfg.get('monitor_iface') or '—'}",
        f"ssids          {ssids}",
    ]


def cli_install() -> int:
    """Write sys-config.yml and the systemd user-unit override (top-level ``install``)."""
    cfg = ensure()
    dropin = write_systemd_override(cfg)
    print(f"sys-config  {sys_config_file()}")
    for line in describe(cfg):
        print(f"  {line}")
    if dropin:
        print(f"systemd    {dropin}  (systemctl --user daemon-reload)")
    for i, line in enumerate(hopper_install_hint(cfg)):
        print(("hopper     " if i == 0 else "           ") + line)
    return 0
