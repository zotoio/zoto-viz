#!/usr/bin/env python3
"""netviz monitor: continuous capture + discovery, streamed to the Three.js UI over WebSocket.

    ./monitor.py                 # http://127.0.0.1:8765
    ./monitor.py --port 9000 --iface wlp59s0 --bind 0.0.0.0

Pipeline
  tshark -i <iface> -T fields ... (line per packet)  ->  State (devices, flows, names)
  every 60 s: ip neigh + mDNS + NetBIOS + OUI                ->  State.devices
  unnamed external TLS peers                                 ->  certificate probe (thread)
  1 Hz: full state snapshot                                  ->  every WebSocket client

State is persisted to data/monitor-state.json so device history survives restarts.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import ipaddress
import json
import os
import re
import shutil
import signal
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from aiohttp import web

import netviz  # discovery helpers, OUI lookup, cert probe

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
WEB_DIST = ROOT / "web" / "dist"
STATE_FILE = DATA / "monitor-state.json"

FIELDS = [
    "frame.time_epoch", "frame.len", "eth.src", "eth.dst", "ip.src", "ip.dst", "ipv6.src", "ipv6.dst",
    "ip.proto", "tcp.srcport", "tcp.dstport", "udp.srcport", "udp.dstport",
    "tls.handshake.extensions_server_name", "dns.qry.name", "dns.a", "dhcp.option.hostname", "_ws.col.Protocol",
    "frame.interface_name",
]
IFACE_RESCAN_S = 15        # how often to check for interfaces appearing/disappearing
IFACE_SKIP_PREFIXES = ("lo", "veth")  # veth traffic is already visible on its bridge
FLOW_IDLE_S = 300          # flows silent this long drop out of the live set
DEVICE_OFFLINE_S = 600     # devices silent this long are shown as offline
RATE_WINDOW_S = 5          # bytes/s smoothing window
DISCOVERY_EVERY_S = 60
PERSIST_EVERY_S = 30
TLS_PORTS = {"443", "8443", "853", "993", "995", "465", "5223", "5228"}


def log(msg: str) -> None:
    print(f"[monitor] {time.strftime('%H:%M:%S')} {msg}", file=sys.stderr, flush=True)


def mac_from_eui64(ip: str) -> str:
    """Recover the MAC from a SLAAC IPv6 address (…xxff:fexx… interface id), else ''."""
    try:
        b = ipaddress.IPv6Address(ip).packed[8:]
    except (ValueError, ipaddress.AddressValueError):
        return ""
    if b[3] != 0xFF or b[4] != 0xFE:
        return ""
    mac = bytes([b[0] ^ 0x02, b[1], b[2], b[5], b[6], b[7]])
    return ":".join(f"{x:02x}" for x in mac)


def list_interfaces(only: list[str] | None = None) -> dict[str, list[str]]:
    """Capturable interfaces -> their IPv4/IPv6 CIDRs. Link must be up (LOWER_UP); lo and veth* are skipped."""
    links = json.loads(netviz.run(["ip", "-j", "link"], quiet=True) or "[]")
    addrs = {a["ifname"]: a.get("addr_info", []) for a in json.loads(netviz.run(["ip", "-j", "addr"], quiet=True) or "[]")}
    out: dict[str, list[str]] = {}
    for l in links:
        name, flags = l["ifname"], set(l.get("flags", []))
        if only is not None:
            if name not in only:
                continue
        elif name.startswith(IFACE_SKIP_PREFIXES) or "LOWER_UP" not in flags or "UP" not in flags:
            continue
        out[name] = [
            str(ipaddress.ip_interface(f"{ai['local']}/{ai['prefixlen']}").network)
            for ai in addrs.get(name, []) if ai.get("scope") != "host"
        ]
    return out


def is_multicast(ip: str) -> bool:
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return a.is_multicast or ip.endswith(".255") or ip == "255.255.255.255"


# --------------------------------------------------------------------------- state


class State:
    def __init__(self, iface: str, local_ip: str, net: str, gateway: str, only_ifaces: list[str] | None = None) -> None:
        self.iface, self.local_ip, self.net_str, self.gateway = iface, local_ip, net, gateway
        self.net = ipaddress.ip_network(net)
        self.only_ifaces = only_ifaces
        self.ifaces: dict[str, list[str]] = {}
        self.local_nets: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
        self.own_ips: set[str] = set()
        self.refresh_interfaces()
        self.started = time.time()
        self.devices: dict[str, dict] = {}       # ip -> device
        self.flows: dict[str, dict] = {}         # "a|b" -> flow
        self.names: dict[str, set[str]] = defaultdict(set)
        self.mac_to_v4: dict[str, str] = {}      # local MAC -> its IPv4 (canonical node id)
        self.alias_to_ip: dict[str, str] = {}    # IPv6 address -> canonical IPv4
        self.cert_tried: set[str] = set()
        self.packets = 0
        self.bytes = 0
        self._rate_buckets: dict[int, list[int]] = defaultdict(lambda: [0, 0])  # sec -> [pkts, bytes]
        self._flow_buckets: dict[str, dict[int, int]] = defaultdict(dict)       # flow -> sec -> bytes

    # ---- interfaces
    def refresh_interfaces(self) -> bool:
        """Re-read capturable interfaces and this host's addresses. Returns True when the interface set changed."""
        ifaces = list_interfaces(self.only_ifaces)
        changed = set(ifaces) != set(self.ifaces)
        self.ifaces = ifaces
        self.local_nets = [ipaddress.ip_network(c) for cidrs in ifaces.values() for c in cidrs]
        own = {self.local_ip}
        for a in json.loads(netviz.run(["ip", "-j", "addr"], quiet=True) or "[]"):
            for ai in a.get("addr_info", []):
                if ai.get("scope") != "host":
                    own.add(ai["local"])
        self.own_ips = own
        return changed

    # ---- classification
    def is_local(self, ip: str) -> bool:
        try:
            a = ipaddress.ip_address(ip)
        except ValueError:
            return False
        return any(a in n for n in self.local_nets) or a.is_link_local or a.is_private

    def role(self, ip: str) -> str:
        if ip == self.local_ip or ip in self.own_ips:
            return "self"
        if ip == self.gateway:
            return "gateway"
        if is_multicast(ip):
            return "multicast"
        try:
            a = ipaddress.ip_address(ip)
        except ValueError:
            return "internet"
        if a in self.net or a.is_link_local:
            return "lan"
        if self.is_local(ip):
            return "local"  # secondary subnet on this host: Docker bridge, VMs, tunnels
        return "internet"

    # ---- devices
    def canonical(self, ip: str, mac: str = "") -> str:
        """Fold a local IPv6 address onto the IPv4 device with the same MAC, so one box is one node."""
        if ":" in ip and not is_multicast(ip):
            v4 = self.mac_to_v4.get(mac) or self.mac_to_v4.get(mac_from_eui64(ip))
            if v4:
                d = self.devices.get(v4)
                if d is not None and ip not in d["aliases"]:
                    d["aliases"].append(ip)
                    self.alias_to_ip[ip] = v4
                return v4
        return self.alias_to_ip.get(ip, ip)

    def device(self, ip: str, mac: str = "") -> dict:
        if ip in self.own_ips and ip != self.local_ip:  # every address of this host is one node
            ip = self.local_ip
        ip = self.alias_to_ip.get(ip, ip)
        d = self.devices.get(ip)
        if d is None:
            d = self.devices[ip] = {
                "ip": ip, "mac": "", "vendor": "", "hostnames": [], "aliases": [], "sources": [], "ports": [], "ifaces": [],
                "first_seen": time.time(), "last_seen": 0.0, "bytes_in": 0, "bytes_out": 0, "packets": 0,
                "role": self.role(ip),
            }
        if mac and not d["mac"] and mac != "ff:ff:ff:ff:ff:ff" and not mac.startswith(("01:00:5e", "33:33")):
            d["mac"] = mac
            if not d["vendor"]:
                d["vendor"] = netviz.vendor_for(mac)
        if d["mac"] and ":" not in ip and self.is_local(ip) and d["mac"] not in self.mac_to_v4:
            self.mac_to_v4[d["mac"]] = ip
            # absorb IPv6-only nodes that were created for this MAC before the IPv4 address was seen
            for v6, other in [(k, v) for k, v in self.devices.items() if ":" in k and v["mac"] == d["mac"]]:
                if v6 not in d["aliases"]:
                    d["aliases"].append(v6)
                d["bytes_in"] += other["bytes_in"]; d["bytes_out"] += other["bytes_out"]; d["packets"] += other["packets"]
                d["last_seen"] = max(d["last_seen"], other["last_seen"])
                self.alias_to_ip[v6] = ip
                del self.devices[v6]
                for key in [k for k in self.flows if v6 in k.split("|")]:
                    del self.flows[key]
                    self._flow_buckets.pop(key, None)
        return d

    def add_name(self, ip: str, name: str, source: str = "") -> None:
        name = name.strip().rstrip(".")
        ip = self.alias_to_ip.get(ip, ip)
        if not name or name == ip or re.fullmatch(r"[\d.]+", name):
            return
        self.names[ip].add(name)
        if ip in self.devices and name not in self.devices[ip]["hostnames"]:
            self.devices[ip]["hostnames"].append(name)
        if source and ip in self.devices and source not in self.devices[ip]["sources"]:
            self.devices[ip]["sources"].append(source)

    # ---- packets
    def packet(self, f: list[str]) -> None:
        try:
            t = float(f[0]); size = int(f[1])
        except (ValueError, IndexError):
            return
        eth_src, eth_dst = f[2].lower(), f[3].lower()
        src = f[4] or f[6]
        dst = f[5] or f[7]
        proto_num, tsp, tdp, usp, udp_ = f[8], f[9], f[10], f[11], f[12]
        sni, dns_q, dns_a, dhcp_host, proto = f[13], f[14], f[15], f[16], f[17]
        iface = f[18] if len(f) > 18 else self.iface
        sec = int(t)

        self.packets += 1
        self.bytes += size
        b = self._rate_buckets[sec]
        b[0] += 1
        b[1] += size

        if not src or not dst:
            return
        if src == "0.0.0.0":  # DHCP discover/request: attribute to the sender's known IPv4, else skip
            src = self.mac_to_v4.get(eth_src, "")
            if not src:
                return

        # a frame's MAC only identifies the IP when that IP is on this segment; otherwise it is the gateway's
        src = self.canonical(src, eth_src if self.is_local(src) else "")
        dst = self.canonical(dst, eth_dst if self.is_local(dst) and not is_multicast(dst) else "")
        ds = self.device(src, eth_src if self.is_local(src) else "")
        ds["last_seen"] = t
        ds["bytes_out"] += size
        ds["packets"] += 1
        dd = self.device(dst, eth_dst if self.is_local(dst) and not is_multicast(dst) else "")
        dd["last_seen"] = t
        dd["bytes_in"] += size
        src, dst = ds["ip"], dd["ip"]  # after own-address / alias folding
        if src == dst:
            return
        if iface:
            for d in (ds, dd):
                if iface not in d["ifaces"]:
                    d["ifaces"].append(iface)

        # flow
        a, b_ = sorted((src, dst))
        key = f"{a}|{b_}"
        fl = self.flows.get(key)
        if fl is None:
            fl = self.flows[key] = {"a": a, "b": b_, "bytes": 0, "packets": 0, "ports": [], "protos": [], "ifaces": [],
                                    "first_seen": t, "last_seen": t, "rate": 0.0}
        if iface and iface not in fl["ifaces"]:
            fl["ifaces"].append(iface)
        fl["bytes"] += size
        fl["packets"] += 1
        fl["last_seen"] = t
        fb = self._flow_buckets[key]
        fb[sec] = fb.get(sec, 0) + size
        port_kind = "tcp" if tsp else ("udp" if usp else "")
        if port_kind:
            sp, dp = (tsp, tdp) if tsp else (usp, udp_)
            try:
                svc = min(int(sp), int(dp))
            except ValueError:
                svc = 0
            tag = f"{port_kind}/{svc}"
            if tag not in fl["ports"]:
                fl["ports"].append(tag)
                if len(fl["ports"]) > 12:
                    fl["ports"].pop(0)
            if self.is_local(dst) and not is_multicast(dst) and str(dp) in (str(svc),):
                if tag not in dd["ports"]:
                    dd["ports"].append(tag)
        if proto and proto not in fl["protos"]:
            fl["protos"].append(proto)
            if len(fl["protos"]) > 8:
                fl["protos"].pop(0)

        # names
        if sni:
            for n in sni.split(","):
                self.add_name(dst, n, "sni")
        if dns_q and dns_a:
            qs, ans = dns_q.split(","), dns_a.split(",")
            for ip in ans:
                self.add_name(ip, qs[0], "dns")
        if dhcp_host:
            self.add_name(src, dhcp_host, "dhcp")

    # ---- periodic
    def tick(self, now: float) -> None:
        cutoff = int(now) - RATE_WINDOW_S
        for s in [s for s in self._rate_buckets if s < cutoff - 1]:
            del self._rate_buckets[s]
        for key, fl in list(self.flows.items()):
            fb = self._flow_buckets[key]
            for s in [s for s in fb if s < cutoff - 1]:
                del fb[s]
            fl["rate"] = sum(v for s, v in fb.items() if s >= cutoff) / RATE_WINDOW_S
            if now - fl["last_seen"] > FLOW_IDLE_S:
                del self.flows[key]
                del self._flow_buckets[key]

    def unnamed_tls_peers(self) -> list[str]:
        out = []
        for fl in self.flows.values():
            for ip in (fl["a"], fl["b"]):
                if (not self.is_local(ip) and ":" not in ip and ip not in self.names and ip not in self.cert_tried
                        and any(p.split("/")[1] in TLS_PORTS for p in fl["ports"] if p.startswith("tcp/"))):
                    out.append(ip)
        return list(dict.fromkeys(out))

    def snapshot(self, now: float) -> dict:
        cutoff = int(now) - RATE_WINDOW_S
        pk = sum(v[0] for s, v in self._rate_buckets.items() if s >= cutoff) / RATE_WINDOW_S
        bp = sum(v[1] for s, v in self._rate_buckets.items() if s >= cutoff) / RATE_WINDOW_S
        devices = []
        for d in self.devices.values():
            dd = dict(d)
            dd["role"] = self.role(d["ip"])  # interfaces/subnets can change at runtime
            dd["online"] = (now - d["last_seen"]) < DEVICE_OFFLINE_S if d["last_seen"] else False
            dd["names"] = sorted(self.names.get(d["ip"], ()), key=lambda n: (n.startswith("*"), len(n)))
            devices.append(dd)
        return {
            "ts": now,
            "iface": self.iface,
            "interfaces": sorted(self.ifaces),
            "network": self.net_str,
            "local_ip": self.local_ip,
            "gateway": self.gateway,
            "uptime": now - self.started,
            "stats": {"pps": pk, "bps": bp, "packets": self.packets, "bytes": self.bytes,
                      "devices": len(self.devices), "online": sum(1 for d in devices if d["online"]),
                      "flows": len(self.flows), "active_flows": sum(1 for f in self.flows.values() if f["rate"] > 0)},
            "devices": devices,
            "flows": list(self.flows.values()),
        }

    # ---- persistence
    def save(self) -> None:
        DATA.mkdir(exist_ok=True)
        tmp = STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps({
            "devices": self.devices,
            "names": {k: sorted(v) for k, v in self.names.items()},
            "cert_tried": sorted(self.cert_tried),
        }))
        tmp.replace(STATE_FILE)

    def load(self) -> None:
        if not STATE_FILE.exists():
            return
        try:
            s = json.loads(STATE_FILE.read_text())
        except json.JSONDecodeError:
            return
        for ip, d in s.get("devices", {}).items():
            if ip == "0.0.0.0" or (ip in self.own_ips and ip != self.local_ip):
                continue
            d.setdefault("ports", [])
            d.setdefault("aliases", [])
            d.setdefault("ifaces", [])
            d["role"] = self.role(ip)
            if not self.is_local(ip):  # older state files attributed the gateway MAC to remote hosts
                d["mac"], d["vendor"] = "", ""
            self.devices[ip] = d
            if d["mac"] and ":" not in ip and self.is_local(ip):
                self.mac_to_v4.setdefault(d["mac"], ip)
            for a in d["aliases"]:
                self.alias_to_ip[a] = ip
        for ip, ns in s.get("names", {}).items():
            self.names[ip].update(ns)
        self.cert_tried.update(s.get("cert_tried", []))
        # fold IPv6 nodes onto their IPv4 sibling (state written before aliasing existed)
        for v6 in [k for k in self.devices if ":" in k and not is_multicast(k)]:
            v4 = self.alias_to_ip.get(v6) or self.mac_to_v4.get(self.devices[v6]["mac"]) or self.mac_to_v4.get(mac_from_eui64(v6))
            if v4 and v4 != v6 and v4 in self.devices:
                d, other = self.devices[v4], self.devices.pop(v6)
                if v6 not in d["aliases"]:
                    d["aliases"].append(v6)
                d["bytes_in"] += other["bytes_in"]; d["bytes_out"] += other["bytes_out"]; d["packets"] += other["packets"]
                for n in self.names.pop(v6, ()):
                    self.names[v4].add(n)
                    if n not in d["hostnames"]:
                        d["hostnames"].append(n)
                self.alias_to_ip[v6] = v4
        for d in self.devices.values():
            d["aliases"] = list(dict.fromkeys(d["aliases"]))
        log(f"restored {len(self.devices)} devices from {STATE_FILE.name}")


# --------------------------------------------------------------------------- capture


def tshark_cmd(ifaces: list[str], bpf: str) -> list[str]:
    cmd = ["tshark"]
    for i in ifaces:
        cmd += ["-i", i]
    cmd += ["-l", "-q", "-n", "-T", "fields", "-E", "separator=|", "-E", "occurrence=f"]
    for f in FIELDS:
        cmd += ["-e", f]
    if bpf:
        cmd += ["-f", bpf]
    return cmd


def wrap_privileged(cmd: list[str]) -> list[str]:
    if os.geteuid() == 0 or netviz.group_active("wireshark"):
        return cmd
    if shutil.which("sg") and netviz.group_member("wireshark"):
        return ["sg", "wireshark", "-c", " ".join(f"'{c}'" if "|" in c or " " in c else c for c in cmd)]
    return ["sudo", "-n"] + cmd


async def _kill_group(proc: asyncio.subprocess.Process) -> None:
    with contextlib.suppress(ProcessLookupError):
        os.killpg(proc.pid, signal.SIGTERM)
    with contextlib.suppress(Exception):
        await asyncio.wait_for(proc.wait(), 3)
    with contextlib.suppress(ProcessLookupError):
        os.killpg(proc.pid, signal.SIGKILL)


async def capture_loop(state: State, bpf: str) -> None:
    backoff = 2
    while True:
        ifaces = sorted(state.ifaces) or [state.iface]
        cmd = wrap_privileged(tshark_cmd(ifaces, bpf))
        log(f"starting capture on {', '.join(ifaces)} via {cmd[0]}" + (f" (filter: {bpf})" if bpf else ""))
        # own process group so `sg -> sh -> tshark -> dumpcap` all die together on shutdown
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, start_new_session=True,
        )
        assert proc.stdout

        async def watch_interfaces() -> None:
            while True:
                await asyncio.sleep(IFACE_RESCAN_S)
                if state.refresh_interfaces():
                    log(f"interfaces changed -> {', '.join(sorted(state.ifaces))}; restarting capture")
                    await _kill_group(proc)
                    return

        watcher = asyncio.create_task(watch_interfaces())
        n = 0
        t0 = time.time()
        try:
            async for raw in proc.stdout:
                line = raw.decode(errors="replace").rstrip("\n")
                if not line:
                    continue
                state.packet(line.split("|"))
                n += 1
                if n % 2000 == 0:
                    await asyncio.sleep(0)  # yield to the server under heavy load
        except asyncio.CancelledError:
            watcher.cancel()
            await _kill_group(proc)
            raise
        restarted_by_watcher = watcher.done() and not watcher.cancelled()
        watcher.cancel()
        err = (await proc.stderr.read()).decode(errors="replace").strip() if proc.stderr else ""
        rc = await proc.wait()
        if restarted_by_watcher:
            backoff = 1
        else:
            log(f"tshark exited rc={rc} after {n} packets" + (f": {err.splitlines()[-1]}" if err else ""))
            backoff = 2 if time.time() - t0 > 60 else min(backoff * 2, 60)
        await asyncio.sleep(backoff)


# --------------------------------------------------------------------------- discovery


def discover_once(state: State) -> None:
    """Root-less discovery pass: kernel neighbour table, mDNS, NetBIOS. Runs in a worker thread."""
    try:
        for n in json.loads(netviz.run(["ip", "-j", "-4", "neigh", "show"], quiet=True) or "[]"):
            if n.get("lladdr") and n.get("state", [""])[0] not in ("FAILED", "INCOMPLETE") and n.get("dev") in state.ifaces:
                d = state.device(n["dst"], n["lladdr"].lower())
                if "neigh" not in d["sources"]:
                    d["sources"].append("neigh")
                if n["dev"] not in d["ifaces"]:
                    d["ifaces"].append(n["dev"])
    except Exception as e:  # noqa: BLE001
        log(f"neigh failed: {e}")

    out = netviz.run(["avahi-browse", "-a", "-t", "-r", "-p"], check=False, timeout=15, quiet=True)
    for line in out.splitlines():
        f = line.split(";")
        if len(f) >= 9 and f[0] == "=" and f[2] == "IPv4" and ":" not in f[7]:
            ip, host, name, svc = f[7], f[6], f[3].replace("\\032", " "), f[4]
            d = state.device(ip)
            state.add_name(ip, host, "mdns")
            if not d.get("mdns_name"):
                d["mdns_name"], d["mdns_service"] = name, svc

    out = netviz.run(["nbtscan", "-q", "-s", ";", state.net_str], check=False, timeout=30, quiet=True)
    for line in out.splitlines():
        f = [x.strip() for x in line.split(";")]
        if len(f) >= 2 and re.match(r"^\d+\.\d+\.\d+\.\d+$", f[0]):
            mac = f[4].lower() if len(f) > 4 and f[4] != "00:00:00:00:00:00" else ""
            state.device(f[0], mac)
            state.add_name(f[0], f[1], "netbios")

    own = json.loads(netviz.run(["ip", "-j", "link", "show", state.iface], quiet=True) or "[]")
    if own:
        d = state.device(state.local_ip, own[0].get("address", "").lower())
        state.add_name(state.local_ip, os.uname().nodename, "self")


async def discovery_loop(state: State, pool: ThreadPoolExecutor) -> None:
    loop = asyncio.get_running_loop()
    while True:
        t0 = time.time()
        try:
            await loop.run_in_executor(pool, discover_once, state)
            log(f"discovery pass: {len(state.devices)} devices ({time.time() - t0:.1f}s)")
        except Exception as e:  # noqa: BLE001
            log(f"discovery failed: {e}")
        await asyncio.sleep(DISCOVERY_EVERY_S)


async def cert_probe_loop(state: State, pool: ThreadPoolExecutor) -> None:
    loop = asyncio.get_running_loop()
    while True:
        peers = state.unnamed_tls_peers()[:16]
        if peers:
            state.cert_tried.update(peers)
            results = await asyncio.gather(*(loop.run_in_executor(pool, netviz._probe_cert, ip, 443) for ip in peers))
            named = 0
            for ip, ns in zip(peers, results):
                for n in ns:
                    state.add_name(ip, n, "cert")
                named += bool(ns)
            log(f"cert probe: {named}/{len(peers)} named")
        await asyncio.sleep(5)


async def housekeeping_loop(state: State) -> None:
    last_save = time.time()
    while True:
        now = time.time()
        state.tick(now)
        if now - last_save > PERSIST_EVERY_S:
            state.save()
            last_save = now
        await asyncio.sleep(1)


# --------------------------------------------------------------------------- web


async def broadcast_loop(app: web.Application) -> None:
    state: State = app["state"]
    while True:
        clients: set[web.WebSocketResponse] = app["clients"]
        if clients:
            msg = json.dumps({"type": "state", **state.snapshot(time.time())})
            await asyncio.gather(*(ws.send_str(msg) for ws in list(clients)), return_exceptions=True)
        await asyncio.sleep(1)


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    request.app["clients"].add(ws)
    log(f"client connected ({len(request.app['clients'])})")
    try:
        await ws.send_str(json.dumps({"type": "state", **request.app["state"].snapshot(time.time())}))
        async for _ in ws:
            pass
    finally:
        request.app["clients"].discard(ws)
        log(f"client disconnected ({len(request.app['clients'])})")
    return ws


async def api_state(request: web.Request) -> web.Response:
    return web.json_response(request.app["state"].snapshot(time.time()))


async def index(request: web.Request) -> web.StreamResponse:
    idx = WEB_DIST / "index.html"
    if not idx.exists():
        return web.Response(
            text="web/dist not built. Run: cd web && pnpm install && pnpm build\n(or use `pnpm dev` and open the Vite URL)",
            status=503,
        )
    return web.FileResponse(idx)


async def on_startup(app: web.Application) -> None:
    state: State = app["state"]
    pool = ThreadPoolExecutor(max_workers=20)
    app["pool"] = pool
    app["tasks"] = [
        asyncio.create_task(capture_loop(state, app["bpf"])),
        asyncio.create_task(discovery_loop(state, pool)),
        asyncio.create_task(cert_probe_loop(state, pool)),
        asyncio.create_task(housekeeping_loop(state)),
        asyncio.create_task(broadcast_loop(app)),
    ]


async def on_cleanup(app: web.Application) -> None:
    for t in app["tasks"]:
        t.cancel()
    for t in app["tasks"]:
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await t
    app["state"].save()
    app["pool"].shutdown(wait=False, cancel_futures=True)


def make_app(state: State, bpf: str) -> web.Application:
    app = web.Application()
    app["state"], app["bpf"], app["clients"] = state, bpf, set()
    app.router.add_get("/", index)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/api/state", api_state)
    if WEB_DIST.exists():
        app.router.add_static("/", WEB_DIST, show_index=False)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--iface", action="append", metavar="IFACE",
                   help="capture only these interfaces (repeatable; default: every up interface except lo and veth*)")
    p.add_argument("--bind", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("-f", "--filter", default="", help="BPF capture filter, e.g. 'not port 22'")
    p.add_argument("--fresh", action="store_true", help="ignore persisted state")
    args = p.parse_args()

    iface, local_ip, cidr, gw = netviz.default_iface()
    state = State(iface, local_ip, cidr, gw, only_ifaces=args.iface)
    if not state.ifaces:
        sys.exit(f"[monitor] no capturable interfaces" + (f" among {args.iface}" if args.iface else ""))
    if not args.fresh:
        state.load()
    log(f"primary={iface} ip={local_ip} net={cidr} gw={gw}")
    log("capturing: " + ", ".join(f"{i} [{', '.join(c) or 'no addr'}]" for i, c in sorted(state.ifaces.items())))
    log(f"UI: http://{args.bind}:{args.port}/   WS: /ws   JSON: /api/state")
    web.run_app(make_app(state, args.filter), host=args.bind, port=args.port, print=None, access_log=None)


if __name__ == "__main__":
    main()
