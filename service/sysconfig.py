"""Machine-local layout at ~/.zoto-viz/sys-config.yml.

Checkout path, hostname, Wi-Fi interfaces, and watched SSIDs stay off git.
`plugin install` and the first monitor start detect missing keys and write the
file (existing values are kept). The Air SSIDs plugin default and the user
systemd drop-in are filled from it.
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
    "# Written on plugin install / first monitor start; existing keys are kept.\n"
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
        return ""
    if not isinstance(rows, list) or not rows:
        return ""
    dev = rows[0].get("dev") if isinstance(rows[0], dict) else ""
    return str(dev or "").strip()


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
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "# generated by zoto-viz from ~/.zoto-viz/sys-config.yml — do not copy this into git\n"
        "[Service]\n"
        f"Environment=ZOTO_VIZ_ROOT={root}\n",
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
