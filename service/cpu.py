"""This-host CPU picture: per-core utilisation and per-process CPU share.

Sampled from /proc/stat and /proc/<pid>/stat on each monitor snapshot (~1 Hz).
The UI renders it as a parallel graph (`views.cpu`) keyed `cpu:host` / `cpu:<n>` /
`proc:<pid>`, the same Device/Flow shape as the IP and RF views.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

PROC = Path("/proc")
RATE_SCALE = 100.0       # 1 % CPU → 100 on flow.rate so the graph heat/particles have room
PROC_CAP = 48            # busiest processes kept after the idle floor
MIN_PCT = 0.15           # drop quieter processes (still always keep every core)
TICK = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100
PAGE = os.sysconf("SC_PAGE_SIZE") if hasattr(os, "sysconf") else 4096


def _ints(line: str) -> list[int]:
    out: list[int] = []
    for tok in line.split()[1:]:
        try:
            out.append(int(tok))
        except ValueError:
            break
    return out


def read_stat() -> tuple[tuple[int, int], list[tuple[int, int]]]:
    """Aggregate and per-core (used, total) jiffies from /proc/stat."""
    agg = (0, 1)
    cores: list[tuple[int, int]] = []
    try:
        text = PROC.joinpath("stat").read_text()
    except OSError:
        return agg, cores
    for line in text.splitlines():
        if not line.startswith("cpu"):
            break
        n = _ints(line)
        if len(n) < 5:
            continue
        idle = n[3] + (n[4] if len(n) > 4 else 0)  # idle + iowait
        total = sum(n[:8]) or 1
        used = max(0, total - idle)
        if line.startswith("cpu "):
            agg = (used, total)
        else:
            cores.append((used, total))
    return agg, cores


def _parse_pid_stat(raw: str) -> tuple[int, str, int, int, int, int] | None:
    """pid, comm, utime, stime, rss pages, last processor."""
    lpar = raw.find("(")
    rpar = raw.rfind(")")
    if lpar < 0 or rpar < lpar:
        return None
    try:
        pid = int(raw[:lpar].strip())
    except ValueError:
        return None
    comm = raw[lpar + 1:rpar][:48]
    rest = raw[rpar + 2:].split()
    if len(rest) < 37:
        return None
    try:
        utime = int(rest[11])
        stime = int(rest[12])
        rss = int(rest[21])
        cpu = int(rest[36])
    except ValueError:
        return None
    return pid, comm, utime, stime, rss, cpu


def _kernel(pid: int) -> bool:
    try:
        return not PROC.joinpath(str(pid), "cmdline").read_bytes()
    except OSError:
        return True


def read_loadavg() -> str:
    try:
        a, b, c, *_ = PROC.joinpath("loadavg").read_text().split()
        return f"{a} {b} {c}"
    except OSError:
        return ""


class Sampler:
    """Two-sample deltas so each snapshot is a percent, not a lifetime counter."""

    def __init__(self) -> None:
        self._agg = (0, 1)
        self._cores: list[tuple[int, int]] = []
        self._procs: dict[int, int] = {}  # pid -> utime+stime
        self._uid = os.getuid()
        self._host = os.uname().nodename.split(".")[0] or "host"

    def snapshot(self, now: float) -> dict[str, Any]:
        agg, cores = read_stat()
        n = len(cores) or 1
        first = not self._cores
        dt_agg = max(1, agg[1] - self._agg[1])
        host_pct = 0.0 if first else 100.0 * max(0, agg[0] - self._agg[0]) / dt_agg
        core_pct = []
        for i, (used, total) in enumerate(cores):
            prev = self._cores[i] if i < len(self._cores) else (0, 1)
            dtot = max(1, total - prev[1])
            core_pct.append(0.0 if first else 100.0 * max(0, used - prev[0]) / dtot)

        rows: list[tuple[float, dict[str, Any]]] = []
        seen: dict[int, int] = {}
        try:
            pids = [p.name for p in PROC.iterdir() if p.name.isdigit()]
        except OSError:
            pids = []
        for name in pids:
            path = PROC / name / "stat"
            try:
                parsed = _parse_pid_stat(path.read_text())
                uid = path.stat().st_uid
            except OSError:
                continue
            if not parsed:
                continue
            pid, comm, utime, stime, rss, last = parsed
            jif = utime + stime
            seen[pid] = jif
            prev = self._procs.get(pid)
            dp = 0 if first or prev is None else max(0, jif - prev)
            pct = 0.0 if first else 100.0 * dp * n / dt_agg
            if pct < MIN_PCT and dp == 0:
                continue
            kern = _kernel(pid)
            mine = uid == self._uid
            role = "multicast" if kern else ("local" if mine else "internet")
            core_id = f"cpu:{max(0, min(last, n - 1))}"
            rows.append((pct, {
                "ip": f"proc:{pid}",
                "mac": "",
                "vendor": "",
                "hostnames": [comm],
                "names": [comm],
                "sources": ["proc"],
                "ports": [core_id],
                "ifaces": [],
                "aliases": [f"pid {pid}"],
                "first_seen": now,
                "last_seen": now,
                "bytes_in": rss * PAGE,
                "bytes_out": int(jif * 1_000_000 / TICK) if TICK else 0,
                "packets": int(round(pct * 10)),
                "role": role,
                "online": True,
                "cpu": round(pct, 2),
            }))

        rows.sort(key=lambda r: -r[0])
        procs = [d for _, d in rows[:PROC_CAP]]

        load = read_loadavg()
        host = {
            "ip": "cpu:host",
            "mac": "",
            "vendor": "",
            "hostnames": [self._host],
            "names": [self._host],
            "sources": ["proc"],
            "ports": ["cpu"],
            "ifaces": [],
            "aliases": [f"{n} cores"] + ([f"load {load}"] if load else []),
            "first_seen": now,
            "last_seen": now,
            "bytes_in": 0,
            "bytes_out": 0,
            "packets": int(round(host_pct * 10)),
            "role": "self",
            "online": True,
            "cpu": round(host_pct, 2),
        }
        core_devs = []
        for i, pct in enumerate(core_pct):
            core_devs.append({
                "ip": f"cpu:{i}",
                "mac": "",
                "vendor": "",
                "hostnames": [f"cpu{i}"],
                "names": [f"cpu{i}"],
                "sources": ["proc"],
                "ports": ["cpu"],
                "ifaces": [],
                "aliases": [],
                "first_seen": now,
                "last_seen": now,
                "bytes_in": 0,
                "bytes_out": 0,
                "packets": int(round(pct * 10)),
                "role": "lan",
                "online": True,
                "cpu": round(pct, 2),
            })

        devices = [host, *core_devs, *procs]
        flows = []
        t0 = now - 1
        for i, pct in enumerate(core_pct):
            rate = pct * RATE_SCALE
            flows.append(_flow("cpu:host", f"cpu:{i}", rate, now, t0))
        for d in procs:
            core = (d.get("ports") or ["cpu:0"])[0]
            rate = float(d.get("cpu") or 0) * RATE_SCALE
            flows.append(_flow(d["ip"], core, rate, now, t0))

        self._agg = agg
        self._cores = cores
        self._procs = seen
        return {"devices": devices, "flows": flows, "hub": "cpu:host", "self": "cpu:host"}


def _flow(a: str, b: str, rate: float, now: float, first: float) -> dict[str, Any]:
    if a > b:
        a, b = b, a
    return {
        "a": a, "b": b, "bytes": int(rate), "packets": 1,
        "ports": ["cpu"], "protos": ["cpu"], "ifaces": [],
        "first_seen": first, "last_seen": now, "rate": rate,
    }
