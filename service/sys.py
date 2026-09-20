"""This-host Linux pictures that are not CPU: memory/PSI, disk, GPU, sockets, cgroups, units, udev, thermal.

Each snapshot is the same Device/Flow shape as ``service/cpu.py`` so the graph engine
can reuse the LAN camera. Sampled on the 1 Hz monitor tick. Privileged files
(RAPL ``energy_uj``) are skipped when unreadable.
"""
from __future__ import annotations

import os
import re
import socket
import subprocess
import time
from pathlib import Path
from typing import Any

PROC = Path("/proc")
SYS = Path("/sys")
PAGE = os.sysconf("SC_PAGE_SIZE") if hasattr(os, "sysconf") else 4096
PROC_CAP = 36
RATE_SCALE = 100.0
SYS_VIEWS = ("memory", "disk", "gpu", "sockets", "cgroups", "units", "udev", "bridge")
BRIDGE_KIDS = 3
_SKIP_DISKS = re.compile(r"^(loop|ram|sr|fd)\d")
_PCI = {"0x10de": "nvidia", "0x8086": "intel", "0x1002": "amd"}


def _ints(line: str) -> list[int]:
    out: list[int] = []
    for tok in line.split():
        try:
            out.append(int(tok))
        except ValueError:
            continue
    return out


def _read(path: Path, default: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return default


def _device(
    ip: str,
    name: str,
    role: str,
    now: float,
    *,
    aliases: list[str] | None = None,
    ports: list[str] | None = None,
    vendor: str = "",
    cpu: float = 0.0,
    bytes_in: int = 0,
    bytes_out: int = 0,
    packets: int = 0,
    online: bool = True,
    sources: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "ip": ip,
        "mac": "",
        "vendor": vendor,
        "hostnames": [name],
        "names": [name],
        "sources": sources or ["sys"],
        "ports": ports or [],
        "ifaces": [],
        "aliases": aliases or [],
        "first_seen": now,
        "last_seen": now,
        "bytes_in": int(bytes_in),
        "bytes_out": int(bytes_out),
        "packets": int(packets),
        "role": role,
        "online": online,
        "cpu": round(float(cpu), 2),
    }


def _flow(a: str, b: str, rate: float, now: float, proto: str) -> dict[str, Any]:
    if a > b:
        a, b = b, a
    return {
        "a": a, "b": b, "bytes": int(rate), "packets": 1,
        "ports": [proto], "protos": [proto], "ifaces": [],
        "first_seen": now - 1, "last_seen": now, "rate": float(rate),
    }


def _view(hub: str, devices: list[dict[str, Any]], flows: list[dict[str, Any]]) -> dict[str, Any]:
    return {"devices": devices, "flows": flows, "hub": hub, "self": hub}


def read_meminfo() -> dict[str, int]:
    out: dict[str, int] = {}
    try:
        text = PROC.joinpath("meminfo").read_text()
    except OSError:
        return out
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, rest = line.split(":", 1)
        nums = _ints(rest)
        if nums:
            out[key] = nums[0] * 1024 if "kB" in rest else nums[0]
    return out


def read_psi(kind: str) -> dict[str, float]:
    raw = _read(PROC / "pressure" / kind)
    out: dict[str, float] = {}
    for line in raw.splitlines():
        parts = line.split()
        if not parts:
            continue
        tag = parts[0]
        for tok in parts[1:]:
            if "=" not in tok:
                continue
            k, v = tok.split("=", 1)
            try:
                out[f"{tag}_{k}"] = float(v)
            except ValueError:
                continue
    return out


def read_thermal() -> dict[str, Any]:
    """Package / zone temperatures and optional RAPL / GPU watts."""
    zones: list[dict[str, Any]] = []
    pkg_c = 0.0
    for zone in sorted(SYS.joinpath("class/thermal").glob("thermal_zone*")):
        name = _read(zone / "type") or zone.name
        raw = _read(zone / "temp")
        try:
            milli = int(raw)
        except ValueError:
            continue
        if milli <= 0 or milli > 200000:
            continue
        c = milli / 1000.0
        zones.append({"name": name, "c": round(c, 1)})
        if name in {"x86_pkg_temp", "acpitz", "cpu-thermal"} or (not pkg_c and "pkg" in name.lower()):
            pkg_c = c
    if not pkg_c and zones:
        pkg_c = max(z["c"] for z in zones)
    rapl_w = _rapl_watts()
    gpu_w = 0.0
    for row in _nvidia_rows():
        gpu_w += float(row.get("watts") or 0)
        if not pkg_c and row.get("temp"):
            pkg_c = float(row["temp"])
    return {
        "pkg_c": round(pkg_c, 1),
        "rapl_w": round(rapl_w + gpu_w, 2),
        "zones": zones[:16],
        "gpu_w": round(gpu_w, 2),
    }


_rapl_prev: dict[str, tuple[float, int]] = {}


def _rapl_watts() -> float:
    total = 0.0
    now = time.monotonic()
    for path in SYS.joinpath("class/powercap").glob("intel-rapl:*"):
        name = _read(path / "name")
        if name not in {"package-0", "package-1", "psys"}:
            continue
        raw = _read(path / "energy_uj")
        try:
            uj = int(raw)
        except ValueError:
            continue
        key = str(path)
        prev = _rapl_prev.get(key)
        _rapl_prev[key] = (now, uj)
        if not prev:
            continue
        dt = now - prev[0]
        if dt <= 0:
            continue
        du = uj - prev[1]
        if du < 0:
            continue
        watts = (du / 1_000_000.0) / dt
        if name.startswith("package"):
            total = max(total, watts)
        elif name == "psys" and not total:
            total = watts
    return total


def _nvidia_rows() -> list[dict[str, Any]]:
    try:
        raw = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
                "--format=csv,noheader,nounits",
            ],
            timeout=1.2,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    rows: list[dict[str, Any]] = []
    for line in raw.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 6:
            continue
        def num(i: int, default: float = 0.0) -> float:
            try:
                return float(parts[i])
            except (IndexError, ValueError):
                return default
        rows.append({
            "index": int(num(0)),
            "name": parts[1] or f"gpu{int(num(0))}",
            "util": num(2),
            "mem_used": int(num(3) * 1024 * 1024),
            "mem_total": int(num(4) * 1024 * 1024),
            "temp": num(5),
            "watts": num(6) if len(parts) > 6 else 0.0,
        })
    return rows


def _drm_cards() -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    seen: set[str] = set()
    root = SYS / "class/drm"
    if not root.is_dir():
        return cards
    for card in sorted(root.glob("card[0-9]")):
        if "-" in card.name:
            continue
        vendor = _read(card / "device/vendor").lower()
        ident = _read(card / "device/device")
        key = f"{vendor}:{ident}" or card.name
        if key in seen:
            continue
        seen.add(key)
        brand = _PCI.get(vendor, vendor or "drm")
        cards.append({
            "id": card.name,
            "name": f"{brand} {card.name}",
            "brand": brand,
            "busy": _read(card / "device/gpu_busy_percent"),
            "vram_used": _read(card / "device/mem_info_vram_used"),
            "vram_total": _read(card / "device/mem_info_vram_total"),
        })
    return cards


def _pid_rows() -> list[dict[str, Any]]:
    uid = os.getuid()
    rows: list[dict[str, Any]] = []
    try:
        pids = [p for p in PROC.iterdir() if p.name.isdigit()]
    except OSError:
        return rows
    for path in pids:
        try:
            stat = (path / "stat").read_text()
            st = (path / "stat").stat()
        except OSError:
            continue
        lpar = stat.find("(")
        rpar = stat.rfind(")")
        if lpar < 0 or rpar < lpar:
            continue
        try:
            pid = int(stat[:lpar].strip())
        except ValueError:
            continue
        comm = stat[lpar + 1:rpar][:48]
        rest = stat[rpar + 2:].split()
        if len(rest) < 22:
            continue
        try:
            rss = int(rest[21]) * PAGE
        except ValueError:
            continue
        io = _pid_io(path)
        try:
            kern = not (path / "cmdline").read_bytes()
        except OSError:
            kern = True
        role = "multicast" if kern else ("local" if st.st_uid == uid else "internet")
        rows.append({"pid": pid, "comm": comm, "rss": rss, "role": role, **io})
    return rows


def _pid_io(path: Path) -> dict[str, int]:
    raw = _read(path / "io")
    out = {"read_bytes": 0, "write_bytes": 0}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        if k in out:
            try:
                out[k] = int(v.strip())
            except ValueError:
                continue
    return out


def _fmt_bytes(n: int) -> str:
    x = float(max(0, n))
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if x < 1024 or unit == "TB":
            return f"{x:.0f} {unit}" if x >= 64 or unit == "B" else f"{x:.1f} {unit}"
        x /= 1024
    return f"{n} B"


def parse_tcp_hex(addr: str) -> tuple[str, int] | None:
    """Decode ``/proc/net/tcp`` local/rem hex ``IP:PORT`` (IPv4)."""
    if ":" not in addr:
        return None
    ip_h, port_h = addr.split(":", 1)
    try:
        port = int(port_h, 16)
        raw = bytes.fromhex(ip_h)
    except ValueError:
        return None
    if len(raw) == 4:
        return ".".join(str(b) for b in raw[::-1]), port
    if len(raw) == 16:
        words = [int.from_bytes(raw[i:i + 4], "little") for i in range(0, 16, 4)]
        packed = b"".join(w.to_bytes(4, "big") for w in words)
        try:
            return socket.inet_ntop(socket.AF_INET6, packed), port
        except OSError:
            return None
    return None


class Sampler:
    """Deltas for rates plus last-seen udev names."""

    def __init__(self) -> None:
        self._host = os.uname().nodename.split(".")[0] or "host"
        self._disk: dict[str, tuple[int, int]] = {}
        self._pid_io: dict[int, tuple[int, int]] = {}
        self._udev: dict[str, float] = {}
        self._udev_events: list[dict[str, Any]] = []
        self._units_at = 0.0
        self._unit_rows: list[dict[str, Any]] = []

    def thermal(self) -> dict[str, Any]:
        return read_thermal()

    def decorate_cpu(self, view: dict[str, Any]) -> dict[str, Any]:
        """Attach thermal to the CPU snapshot and annotate the host node."""
        thermal = read_thermal()
        view["thermal"] = thermal
        bits: list[str] = []
        if thermal.get("pkg_c"):
            bits.append(f"{thermal['pkg_c']:.0f}°C")
        if thermal.get("rapl_w"):
            bits.append(f"{thermal['rapl_w']:.0f} W")
        pkg = thermal.get("pkg_c")
        watts = thermal.get("rapl_w")
        for d in view.get("devices") or []:
            ip = str(d.get("ip") or "")
            if ip.startswith("cpu:"):
                d["temp"] = pkg
            if ip != "cpu:host":
                continue
            if bits:
                aliases = list(d.get("aliases") or [])
                for bit in bits:
                    if bit not in aliases:
                        aliases.append(bit)
                d["aliases"] = aliases
            if watts:
                d["watts"] = watts
        return view

    def views(self, now: float) -> dict[str, dict[str, Any]]:
        pids = _pid_rows()
        out = {
            "memory": self._memory(now, pids),
            "disk": self._disk_view(now, pids),
            "gpu": self._gpu(now),
            "sockets": self._sockets(now, pids),
            "cgroups": self._cgroups(now),
            "units": self._units(now),
            "udev": self._udev_view(now),
        }
        out["bridge"] = self._bridge(now, out)
        return out

    def _memory(self, now: float, pids: list[dict[str, Any]]) -> dict[str, Any]:
        info = read_meminfo()
        total = info.get("MemTotal") or 1
        avail = info.get("MemAvailable") or info.get("MemFree") or 0
        used = max(0, total - avail)
        swap_t = info.get("SwapTotal") or 0
        swap_f = info.get("SwapFree") or 0
        swap_u = max(0, swap_t - swap_f)
        used_pct = 100.0 * used / total
        hub = "mem:host"
        devices = [_device(
            hub, self._host, "self", now,
            aliases=[f"{_fmt_bytes(avail)} avail", f"load psi"],
            ports=["mem"], vendor="memory", cpu=used_pct,
            bytes_in=used, bytes_out=avail, packets=int(used_pct * 10),
        )]
        flows: list[dict[str, Any]] = []
        for kind, role in (("cpu", "lan"), ("memory", "local"), ("io", "internet")):
            psi = read_psi(kind)
            some = float(psi.get("some_avg10") or 0)
            devices.append(_device(
                f"psi:{kind}", f"psi {kind}", role, now,
                aliases=[f"{some:.2f} avg10"], ports=["psi"], vendor="psi",
                cpu=min(100.0, some * 20), packets=int(some * 40),
            ))
            flows.append(_flow(hub, f"psi:{kind}", some * RATE_SCALE, now, "psi"))
        if swap_t:
            devices.append(_device(
                "mem:swap", "swap", "gateway", now,
                aliases=[_fmt_bytes(swap_u)], ports=["swap"], vendor="swap",
                cpu=100.0 * swap_u / swap_t if swap_t else 0,
                bytes_in=swap_u, packets=int(swap_u / max(1, swap_t) * 100),
            ))
            flows.append(_flow(hub, "mem:swap", (swap_u / max(1, swap_t)) * RATE_SCALE, now, "swap"))
        ranked = [r for r in sorted(pids, key=lambda r: -r["rss"]) if r["rss"] >= 8 * 1024 * 1024][:PROC_CAP]
        top_rss = ranked[0]["rss"] if ranked else 1
        for row in ranked:
            ip = f"mem:proc:{row['pid']}"
            pct = 100.0 * row["rss"] / top_rss
            devices.append(_device(
                ip, row["comm"], row["role"], now,
                aliases=[f"pid {row['pid']}", _fmt_bytes(row["rss"])],
                ports=["rss"], vendor="proc", cpu=pct,
                bytes_in=row["rss"], packets=int(pct * 10),
            ))
            flows.append(_flow(ip, hub, pct * RATE_SCALE, now, "rss"))
        return _view(hub, devices, flows)

    def _disk_view(self, now: float, pids: list[dict[str, Any]]) -> dict[str, Any]:
        hub = "disk:host"
        devices = [_device(hub, self._host, "self", now, ports=["disk"], vendor="disk")]
        flows: list[dict[str, Any]] = []
        disks = self._diskstats()
        parents = {name for name in disks if not re.search(r"\d+$", name) or name.startswith("nvme")}
        # keep whole disks (nvme0n1, sda) not partitions when the parent exists
        for name, (rsec, wsec) in disks.items():
            if _SKIP_DISKS.match(name):
                continue
            parent = re.sub(r"p?\d+$", "", name)
            if name != parent and parent in parents:
                continue
            prev = self._disk.get(name)
            self._disk[name] = (rsec, wsec)
            rb = 0 if not prev else max(0, (rsec - prev[0]) * 512)
            wb = 0 if not prev else max(0, (wsec - prev[1]) * 512)
            bps = rb + wb
            pct = min(100.0, bps / (8 * 1024 * 1024) * 100)
            ip = f"disk:{name}"
            devices.append(_device(
                ip, name, "lan", now,
                aliases=[f"{_fmt_bytes(bps)}/s"], ports=["disk"], vendor="block",
                cpu=pct, bytes_in=rb, bytes_out=wb, packets=max(1, bps // 4096),
            ))
            flows.append(_flow(hub, ip, max(1.0, pct * RATE_SCALE), now, "disk"))
        host_bps = 0
        next_io: dict[int, tuple[int, int]] = {}
        ranked: list[tuple[float, dict[str, Any], int, int]] = []
        for row in pids:
            cur = (row["read_bytes"], row["write_bytes"])
            next_io[row["pid"]] = cur
            prev = self._pid_io.get(row["pid"])
            rb = 0 if not prev else max(0, cur[0] - prev[0])
            wb = 0 if not prev else max(0, cur[1] - prev[1])
            bps = rb + wb
            if bps < 4096:
                continue
            ranked.append((bps, row, rb, wb))
        self._pid_io = next_io
        ranked.sort(key=lambda t: -t[0])
        for bps, row, rb, wb in ranked[:PROC_CAP]:
            host_bps += bps
            pct = min(100.0, bps / (4 * 1024 * 1024) * 100)
            ip = f"disk:proc:{row['pid']}"
            devices.append(_device(
                ip, row["comm"], row["role"], now,
                aliases=[f"pid {row['pid']}", f"{_fmt_bytes(bps)}/s"],
                ports=["io"], vendor="proc", cpu=pct,
                bytes_in=rb, bytes_out=wb, packets=max(1, bps // 4096),
            ))
            flows.append(_flow(ip, hub, pct * RATE_SCALE, now, "io"))
        devices[0]["bytes_in"] = host_bps
        devices[0]["cpu"] = min(100.0, host_bps / (16 * 1024 * 1024) * 100)
        devices[0]["aliases"] = [f"{_fmt_bytes(host_bps)}/s"]
        return _view(hub, devices, flows)

    def _diskstats(self) -> dict[str, tuple[int, int]]:
        out: dict[str, tuple[int, int]] = {}
        try:
            text = PROC.joinpath("diskstats").read_text()
        except OSError:
            return out
        for line in text.splitlines():
            parts = line.split()
            if len(parts) < 14:
                continue
            name = parts[2]
            try:
                rsec = int(parts[5])
                wsec = int(parts[9])
            except ValueError:
                continue
            out[name] = (rsec, wsec)
        return out

    def _gpu(self, now: float) -> dict[str, Any]:
        hub = "gpu:host"
        nvidia = {row["index"]: row for row in _nvidia_rows()}
        devices = [_device(hub, self._host, "self", now, ports=["gpu"], vendor="gpu")]
        flows: list[dict[str, Any]] = []
        n = 0
        watts = 0.0
        util_sum = 0.0
        for card in _drm_cards():
            nv = None
            if card["brand"] == "nvidia" and nvidia:
                nv = nvidia.pop(min(nvidia), None)
            name = (nv or {}).get("name") or card["name"]
            util = float((nv or {}).get("util") or 0)
            if not util and card["busy"]:
                try:
                    util = float(card["busy"])
                except ValueError:
                    util = 0.0
            vram_u = int((nv or {}).get("mem_used") or 0)
            vram_t = int((nv or {}).get("mem_total") or 0)
            if not vram_u and card["vram_used"]:
                try:
                    vram_u = int(card["vram_used"])
                    vram_t = int(card["vram_total"] or 0)
                except ValueError:
                    pass
            temp = float((nv or {}).get("temp") or 0)
            w = float((nv or {}).get("watts") or 0)
            watts += w
            util_sum += util
            ip = f"gpu:{n}"
            aliases = [card["brand"]]
            if temp:
                aliases.append(f"{temp:.0f}°C")
            if w:
                aliases.append(f"{w:.0f} W")
            if vram_t:
                aliases.append(f"{_fmt_bytes(vram_u)} / {_fmt_bytes(vram_t)}")
            devices.append(_device(
                ip, name, "lan", now, aliases=aliases, ports=["gpu"],
                vendor=card["brand"], cpu=util, bytes_in=vram_u, bytes_out=vram_t,
                packets=int(util * 10),
            ))
            flows.append(_flow(hub, ip, max(1.0, util * RATE_SCALE), now, "gpu"))
            n += 1
        for row in nvidia.values():
            ip = f"gpu:{n}"
            devices.append(_device(
                ip, row["name"], "lan", now,
                aliases=["nvidia", f"{row['temp']:.0f}°C"] if row["temp"] else ["nvidia"],
                ports=["gpu"], vendor="nvidia", cpu=row["util"],
                bytes_in=row["mem_used"], bytes_out=row["mem_total"],
                packets=int(row["util"] * 10),
            ))
            flows.append(_flow(hub, ip, max(1.0, row["util"] * RATE_SCALE), now, "gpu"))
            watts += row["watts"]
            util_sum += row["util"]
            n += 1
        devices[0]["cpu"] = util_sum / n if n else 0
        devices[0]["aliases"] = [f"{n} gpu"] + ([f"{watts:.0f} W"] if watts else [])
        devices[0]["watts"] = watts
        return _view(hub, devices, flows)

    def _sockets(self, now: float, pids: list[dict[str, Any]]) -> dict[str, Any]:
        hub = "sock:host"
        inodes = _socket_inodes()
        pid_by_inode = _inode_pids()
        comm = {r["pid"]: r for r in pids}
        devices = [_device(hub, self._host, "self", now, ports=["sock"], vendor="sock")]
        flows: list[dict[str, Any]] = []
        seen_peer: set[str] = set()
        seen_proc: set[str] = set()
        n = 0
        for inode, rem, st in inodes:
            if n >= PROC_CAP:
                break
            pid = pid_by_inode.get(inode)
            proc = comm.get(pid) if pid else None
            name = proc["comm"] if proc else (f"pid {pid}" if pid else "kernel")
            role = proc["role"] if proc else "multicast"
            proc_ip = f"sock:proc:{pid or 'k'}"
            if proc_ip not in seen_proc:
                devices.append(_device(
                    proc_ip, name, role, now,
                    aliases=[f"pid {pid}"] if pid else ["inode"],
                    ports=["sock"], vendor="proc", cpu=8, packets=1,
                ))
                flows.append(_flow(proc_ip, hub, 20, now, "sock"))
                seen_proc.add(proc_ip)
            peer_ip = rem[0]
            if peer_ip in {"0.0.0.0", "::", "*"}:
                continue
            node = f"sock:peer:{peer_ip}"
            if node not in seen_peer:
                local = peer_ip.startswith(("127.", "10.", "192.168.", "172.")) or ":" in peer_ip and peer_ip.startswith(("::1", "fe80:", "fd"))
                devices.append(_device(
                    node, peer_ip, "local" if local else "internet", now,
                    aliases=[f":{rem[1]}", f"state {st}"],
                    ports=[str(rem[1])], vendor="peer", cpu=20 if st == "01" else 6, packets=1,
                ))
                seen_peer.add(node)
            flows.append(_flow(proc_ip, node, 40 if st == "01" else 8, now, "tcp"))
            n += 1
        devices[0]["aliases"] = [f"{n} sockets"]
        devices[0]["packets"] = n
        return _view(hub, devices, flows)

    def _cgroups(self, now: float) -> dict[str, Any]:
        hub = "cg:root"
        root = SYS / "fs/cgroup"
        devices = [_device(hub, "cgroup", "self", now, ports=["cgroup"], vendor="cgroup")]
        flows: list[dict[str, Any]] = []
        if not root.is_dir():
            return _view(hub, devices, flows)
        rows: list[tuple[int, str, Path]] = []
        for slice_name in ("user.slice", "system.slice", "init.scope"):
            base = root / slice_name
            if not base.is_dir():
                continue
            rows.extend(_walk_cgroups(base, slice_name, 0))
        rows.sort(key=lambda t: -t[0])
        for nproc, parent, path in rows[:PROC_CAP]:
            rel = str(path.relative_to(root)) if path != root else path.name
            ip = f"cg:{rel}"
            p_ip = f"cg:{parent}" if parent != "cgroup" else hub
            if p_ip != hub and not any(d["ip"] == p_ip for d in devices):
                devices.append(_device(p_ip, parent, "gateway", now, ports=["cgroup"], vendor="slice", cpu=4))
                flows.append(_flow(hub, p_ip, 10, now, "cgroup"))
            devices.append(_device(
                ip, path.name, "lan", now,
                aliases=[f"{nproc} procs"], ports=["cgroup"], vendor="cgroup",
                cpu=min(100.0, nproc * 4), packets=nproc,
            ))
            flows.append(_flow(p_ip, ip, max(4.0, nproc * 4), now, "cgroup"))
        devices[0]["aliases"] = [f"{min(len(rows), PROC_CAP)} groups"]
        return _view(hub, devices, flows)

    def _units(self, now: float) -> dict[str, Any]:
        if now - self._units_at > 2.5 or not self._unit_rows:
            self._unit_rows = _user_units()
            self._units_at = now
        hub = "unit:host"
        devices = [_device(hub, "systemd --user", "self", now, ports=["unit"], vendor="systemd")]
        flows: list[dict[str, Any]] = []
        failed = [u for u in self._unit_rows if u.get("active") == "failed"]
        running = [u for u in self._unit_rows if u.get("active") == "active" and u.get("sub") == "running"]
        pick = failed + [u for u in running if not _boring_unit(u.get("unit") or "")]
        if len(pick) < 12:
            pick = failed + running
        for u in pick[:PROC_CAP]:
            name = str(u.get("unit") or "")
            ip = f"unit:{name}"
            failed_u = u.get("active") == "failed"
            devices.append(_device(
                ip, name.replace(".service", ""), "internet" if failed_u else "lan", now,
                aliases=[str(u.get("description") or u.get("sub") or "")[:80]],
                ports=[str(u.get("sub") or "")], vendor="unit",
                cpu=90 if failed_u else 25, packets=2 if failed_u else 1,
                online=not failed_u,
            ))
            flows.append(_flow(hub, ip, 80 if failed_u else 18, now, "unit"))
        devices[0]["aliases"] = [f"{len(failed)} failed", f"{len(running)} running"]
        devices[0]["cpu"] = 80 if failed else 10
        return _view(hub, devices, flows)

    def _udev_view(self, now: float) -> dict[str, Any]:
        hub = "udev:host"
        present = _udev_names()
        prev = set(self._udev)
        added = present - prev
        gone = prev - present
        for name in added:
            self._udev_events.append({"name": name, "action": "add", "ts": now})
        for name in gone:
            self._udev_events.append({"name": name, "action": "remove", "ts": now})
        self._udev_events = [e for e in self._udev_events[-48:] if now - e["ts"] < 120]
        self._udev = {name: self._udev.get(name, now) if name in prev else now for name in present}
        devices = [_device(hub, "udev", "self", now, ports=["udev"], vendor="udev")]
        flows: list[dict[str, Any]] = []
        fresh = {e["name"] for e in self._udev_events if now - e["ts"] < 30}
        # show recent events first, then a sample of current classes
        names = list(dict.fromkeys([e["name"] for e in reversed(self._udev_events)] + sorted(present)))
        for name in names[:PROC_CAP]:
            is_new = name in fresh or name in added
            gone_now = name in gone and name not in present
            kind = name.split("/", 1)[0]
            ip = f"udev:{name}"
            devices.append(_device(
                ip, name.split("/", 1)[-1], "internet" if gone_now else ("local" if is_new else "lan"), now,
                aliases=[kind, "new" if is_new else ("gone" if gone_now else "present")],
                ports=[kind], vendor=kind, cpu=70 if is_new or gone_now else 12,
                packets=3 if is_new else 1, online=not gone_now,
            ))
            flows.append(_flow(hub, ip, 50 if is_new or gone_now else 8, now, "udev"))
        devices[0]["aliases"] = [f"{len(present)} devices", f"{len(self._udev_events)} events"]
        devices[0]["packets"] = len(self._udev_events)
        return _view(hub, devices, flows)

    def _bridge(self, now: float, parts: dict[str, dict[str, Any]]) -> dict[str, Any]:
        """One CIC schematic: host hub, eight subsystem satellites, hottest children."""
        thermal = read_thermal()
        load = _loadavg()
        hub = "bridge:host"
        aliases = [a for a in (f"{thermal['pkg_c']:.0f}°C" if thermal.get("pkg_c") else "",
                               f"{thermal['gpu_w']:.0f} W" if thermal.get("gpu_w") else "",
                               f"load {load}" if load else "") if a]
        devices = [_device(
            hub, self._host, "self", now,
            aliases=aliases or ["syscon"], ports=["bridge"], vendor="bridge",
            cpu=_hub_cpu(parts.get("memory")),
        )]
        devices[0]["temp"] = thermal.get("pkg_c")
        devices[0]["watts"] = thermal.get("rapl_w") or thermal.get("gpu_w")
        flows: list[dict[str, Any]] = []
        psi = _hub_cpu(parts.get("memory"), startswith="psi:")
        mem = _hub_cpu(parts.get("memory"))
        devices[0]["cpu"] = max(mem, psi)
        for key, label, role in (
            ("memory", "MEM", "local"),
            ("disk", "DISK", "lan"),
            ("gpu", "GPU", "gateway"),
            ("sockets", "SOCK", "lan"),
            ("cgroups", "CGROUP", "local"),
            ("units", "UNITS", "lan"),
            ("udev", "DEV", "lan"),
        ):
            view = parts.get(key) or empty_view(key)
            sat_ip = f"bridge:{key}"
            hub_dev = next((d for d in view.get("devices") or [] if d.get("ip") == view.get("hub")), {})
            sat_cpu = float(hub_dev.get("cpu") or 0)
            sat_aliases = list(hub_dev.get("aliases") or [])[:3]
            if key == "units" and sat_cpu >= 80:
                role = "internet"
            devices.append(_device(
                sat_ip, label, role, now,
                aliases=sat_aliases, ports=[key], vendor=key,
                cpu=sat_cpu, bytes_in=int(hub_dev.get("bytes_in") or 0),
                bytes_out=int(hub_dev.get("bytes_out") or 0),
                packets=int(hub_dev.get("packets") or 1),
            ))
            flows.append(_flow(hub, sat_ip, max(8.0, sat_cpu * RATE_SCALE * 0.4), now, key))
            kids = _hot_kids(view, BRIDGE_KIDS)
            if key == "units":
                failed = [d for d in (view.get("devices") or []) if d.get("role") == "internet"]
                kids = _uniq_devs(failed + kids)[:BRIDGE_KIDS]
            for kid in kids:
                kid_ip = str(kid.get("ip") or "")
                if not kid_ip or kid_ip == view.get("hub"):
                    continue
                devices.append(_copy_dev(kid, now))
                flows.append(_flow(sat_ip, kid_ip, max(4.0, float(kid.get("cpu") or 0) * RATE_SCALE * 0.25), now, key))
        # CPU satellite from thermal + PSI (cpu snapshot is a sibling view)
        cpu_psi = _named_cpu(parts.get("memory"), "psi:cpu")
        cpu_ip = "bridge:cpu"
        devices.append(_device(
            cpu_ip, "CPU", "lan", now,
            aliases=[a for a in aliases if "°C" in a or a.startswith("load")] or ["cores"],
            ports=["cpu"], vendor="cpu", cpu=max(cpu_psi, min(100.0, (thermal.get("pkg_c") or 0) - 30)),
        ))
        flows.append(_flow(hub, cpu_ip, max(8.0, cpu_psi * RATE_SCALE * 0.4), now, "cpu"))
        out = _view(hub, devices, flows)
        out["thermal"] = thermal
        return out


def _hub_cpu(view: dict[str, Any] | None, startswith: str = "") -> float:
    if not view:
        return 0.0
    hub = view.get("hub")
    best = 0.0
    for d in view.get("devices") or []:
        ip = str(d.get("ip") or "")
        if startswith:
            if ip.startswith(startswith):
                best = max(best, float(d.get("cpu") or 0))
            continue
        if ip == hub:
            return float(d.get("cpu") or 0)
    return best


def _named_cpu(view: dict[str, Any] | None, ip: str) -> float:
    if not view:
        return 0.0
    for d in view.get("devices") or []:
        if d.get("ip") == ip:
            return float(d.get("cpu") or 0)
    return 0.0


def _hot_kids(view: dict[str, Any], n: int) -> list[dict[str, Any]]:
    hub = view.get("hub")
    rows = [d for d in (view.get("devices") or []) if d.get("ip") != hub]
    rows.sort(key=lambda d: -float(d.get("cpu") or 0))
    return rows[:n]


def _uniq_devs(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for d in rows:
        ip = str(d.get("ip") or "")
        if not ip or ip in seen:
            continue
        seen.add(ip)
        out.append(d)
    return out


def _copy_dev(d: dict[str, Any], now: float) -> dict[str, Any]:
    return _device(
        str(d.get("ip") or ""),
        (d.get("names") or d.get("hostnames") or ["node"])[0],
        str(d.get("role") or "lan"),
        now,
        aliases=list(d.get("aliases") or [])[:3],
        ports=list(d.get("ports") or []),
        vendor=str(d.get("vendor") or ""),
        cpu=float(d.get("cpu") or 0),
        bytes_in=int(d.get("bytes_in") or 0),
        bytes_out=int(d.get("bytes_out") or 0),
        packets=int(d.get("packets") or 1),
        online=bool(d.get("online", True)),
    )


def _loadavg() -> str:
    raw = _read(PROC / "loadavg")
    parts = raw.split()
    return " ".join(parts[:3]) if len(parts) >= 3 else ""


def _walk_cgroups(path: Path, parent: str, depth: int) -> list[tuple[int, str, Path]]:
    if depth > 3:
        return []
    nproc = 0
    try:
        nproc = len((path / "cgroup.procs").read_text().split())
    except OSError:
        pass
    rows = [(nproc, parent, path)] if nproc or depth == 0 else []
    try:
        children = [p for p in path.iterdir() if p.is_dir() and not p.name.startswith(".")]
    except OSError:
        return rows
    for child in sorted(children)[:24]:
        rows.extend(_walk_cgroups(child, path.name, depth + 1))
    return rows


def _socket_inodes() -> list[tuple[int, tuple[str, int], str]]:
    out: list[tuple[int, tuple[str, int], str]] = []
    for fname, _v6 in (("tcp", False), ("tcp6", True)):
        try:
            text = PROC.joinpath("net", fname).read_text()
        except OSError:
            continue
        for line in text.splitlines()[1:]:
            parts = line.split()
            if len(parts) < 10:
                continue
            rem = parse_tcp_hex(parts[2])
            if not rem:
                continue
            try:
                inode = int(parts[9])
            except ValueError:
                continue
            if inode <= 0:
                continue
            out.append((inode, rem, parts[3]))
    out.sort(key=lambda t: (0 if t[2] == "01" else 1, t[1][0]))
    return out


def _inode_pids() -> dict[int, int]:
    found: dict[int, int] = {}
    try:
        pids = [p for p in PROC.iterdir() if p.name.isdigit()]
    except OSError:
        return found
    for path in pids:
        fd = path / "fd"
        try:
            entries = list(fd.iterdir())
        except OSError:
            continue
        try:
            pid = int(path.name)
        except ValueError:
            continue
        for link in entries:
            try:
                target = os.readlink(link)
            except OSError:
                continue
            if not target.startswith("socket:["):
                continue
            try:
                inode = int(target[8:-1])
            except ValueError:
                continue
            found.setdefault(inode, pid)
    return found


def _user_units() -> list[dict[str, Any]]:
    try:
        raw = subprocess.check_output(
            ["systemctl", "--user", "list-units", "--type=service", "--type=socket",
             "--output=json", "--no-pager"],
            timeout=1.5,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    try:
        import json
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return [u for u in data if isinstance(u, dict)] if isinstance(data, list) else []


def _boring_unit(name: str) -> bool:
    return name.startswith((
        "dbus", "at-spi", "dconf", "gvfs", "xdg-", "glib-pac", "evolution-",
        "pulseaudio", "pipewire", "filter-", "obex",
    ))


_UDEV_CLASSES = ("net", "drm", "block", "power_supply", "sound", "input", "video4linux", "hidraw")


def _udev_names() -> set[str]:
    names: set[str] = set()
    for kind in _UDEV_CLASSES:
        root = SYS / "class" / kind
        if not root.is_dir():
            continue
        try:
            kids = list(root.iterdir())
        except OSError:
            continue
        for child in kids:
            if kind == "block" and _SKIP_DISKS.match(child.name):
                continue
            if kind == "drm" and "-" in child.name:
                continue
            names.add(f"{kind}/{child.name}")
    return names


def empty_view(name: str) -> dict[str, Any]:
    hub = f"{name}:host"
    return _view(hub, [_device(hub, name, "self", time.time(), vendor=name)], [])
