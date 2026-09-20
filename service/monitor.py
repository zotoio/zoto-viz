#!/usr/bin/env python3
"""zoto-viz monitor: continuous capture + discovery, streamed to the Three.js UI over WebSocket.

    python -m service.monitor                 # http://127.0.0.1:7020  (or bind from ~/.zoto-viz/sys-config.yml)
    python -m service.monitor --port 9000 --iface wlan0
    python -m service.monitor --bind 0.0.0.0 --insecure-lan   # LAN bind; anyone on the network can use the UI

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
from collections import Counter, defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Iterable

from aiohttp import WSCloseCode, web

from . import access
from . import agent
from . import agent_assets
from . import cursor_agent
from . import cursor_stats
from . import hn_rain_stills
from . import live
from . import logbuf
from . import mcp as plugin_mcp
from . import plugin_local
from . import plugin_migration
from . import cpu
from . import sys as hostsys
from . import forensics
from . import hooks
from . import paths
from . import plugin_datasource as plugin_ds
from . import plugin_instances
from . import plugins
from . import profiles
from . import repo_sync
from . import rf
from . import sdm
from . import sources
from . import idle
from . import sysconfig

zotoviz = paths.load_cli()

REPO = Path(__file__).resolve().parents[1]
DATA = REPO / "data"
WEB_DIST = REPO / "web" / "dist"
STATE_FILE = DATA / "monitor-state.json"

FIELDS = [
    "frame.time_epoch", "frame.len", "eth.src", "eth.dst", "ip.src", "ip.dst", "ipv6.src", "ipv6.dst",
    "ip.proto", "tcp.srcport", "tcp.dstport", "udp.srcport", "udp.dstport",
    "tls.handshake.extensions_server_name", "dns.qry.name", "dns.a", "dhcp.option.hostname", "_ws.col.Protocol",
    "frame.interface_name", "ip.ttl",
    # 802.11 frames from a monitor-mode radio: their MACs, and enough of the IP/transport header to recognise the
    # same packet seen twice (once on the wire, once in the air; or client→AP and AP→client on a wireless relay)
    "wlan.sa", "wlan.da", "ip.id", "ip.len", "ipv6.plen", "tcp.seq_raw", "udp.checksum",
    "dns.resp.name",  # pair with dns.a; qry.name on every A record is mDNS glue (Android.local on every Cast box)
    "wlan.bssid", "wlan.ssid", "wlan.fc.type_subtype", "radiotap.dbm_antsignal", "wlan_radio.channel",
    "tcp.payload", "udp.payload",  # the head of each is kept per conversation so the trace modal can decode a packet
    "_ws.col.Info",  # keep last: free text that may itself contain the field separator
]
BT_FIELDS = [
    "frame.time_epoch", "frame.len", "bluetooth.addr", "btle.advertising_address",
    "btcommon.eir_ad.entry.device_name", "btcommon.eir_ad.entry.uuid_16",
    "btcommon.eir_ad.entry.company_id", "btcommon.eir_ad.entry.power_level",
    "_ws.col.Protocol", "_ws.col.Info",
]
BT_INFO = len(BT_FIELDS) - 1
INFO_FIELD = len(FIELDS) - 1
RECENT_PACKETS = 250       # per-device ring of recent packets served by /api/traffic
FLOW_PACKETS = 300         # per-conversation ring (feeds the trace modal), so a quiet peer of a busy host keeps history
PAYLOAD_BYTES = 512        # head of the transport payload kept with each conversation-ring packet (/api/payload)
CAPTURE_LINE_LIMIT = 1 << 20  # one tshark output line; a 64 KB GSO frame's payload is ~190 KB of hex
GROUP_PACKETS = 2000       # cap on one /api/traffic?since= answer for a group (NetPong polling every LAN device at once)
COUNTER_CAP = 400          # distinct keys kept per device counter (protocols, ports, names, peers)
IFACE_RESCAN_S = 15        # how often to check for interfaces appearing/disappearing
IFACE_SKIP_PREFIXES = ("lo", "veth")  # veth traffic is already visible on its bridge
ARPHRD_IEEE80211_RADIOTAP = 803  # /sys/class/net/<if>/type of a Wi-Fi interface in monitor mode
IFF_UP = 0x1               # /sys/class/net/<if>/flags bit: administratively up
LINK_IDLE_S = 15           # an interface that captured nothing this long shows amber in the header
GATEWAY_PROBE_S = 5        # how often the gateway is pinged for the header indicator
GATEWAY_PING_WAIT_S = 2    # ping -W: one lost reply on Wi-Fi must not flip the light, so two misses count
DEDUPE_S = 1.0             # the same packet seen again within this long on another path is one packet
WIFI_KEYS_FILE = paths.config_dir() / "wifi-keys"   # `SSID = passphrase` per line, mode 600
WIRESHARK_PROFILE = "zoto-viz"                                        # tshark -C profile carrying the 802.11 keys
FLOW_IDLE_S = 300          # flows silent this long drop out of the live set
DEVICE_OFFLINE_S = 600     # devices silent this long are shown as offline
RATE_WINDOW_S = 5          # bytes/s smoothing window
DISCOVERY_EVERY_S = 60
PERSIST_EVERY_S = 30
TLS_PORTS = {"443", "8443", "853", "993", "995", "465", "5223", "5228"}


def log(msg: str) -> None:
    print(f"[monitor] {time.strftime('%H:%M:%S')} {msg}", file=sys.stderr, flush=True)
    logbuf.record(str(msg))


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


def is_wifi_radio(name: str) -> bool:
    """True for a Wi-Fi netdev (managed or monitor). Monitor-mode radios often have no Ethernet carrier."""
    p = Path(f"/sys/class/net/{name}")
    if (p / "wireless").is_dir():
        return True
    try:
        return int((p / "type").read_text().strip()) == ARPHRD_IEEE80211_RADIOTAP
    except (OSError, ValueError):
        return False


def wifi_radios() -> set[str]:
    root = Path("/sys/class/net")
    try:
        return {p.name for p in root.iterdir() if is_wifi_radio(p.name)}
    except OSError:
        return set()


def list_interfaces(only: list[str] | None = None) -> dict[str, list[str]]:
    """Capturable interfaces -> their IPv4/IPv6 CIDRs. Link must be UP; lo and veth* are skipped.
    Ethernet needs LOWER_UP (a carrier). Wi-Fi radios need only UP: a monitor-mode stick often has
    no carrier flag, and we still want both the associated radio and the monitor radio in the capture."""
    links = json.loads(zotoviz.run(["ip", "-j", "link"], quiet=True) or "[]")
    addrs = {a["ifname"]: a.get("addr_info", []) for a in json.loads(zotoviz.run(["ip", "-j", "addr"], quiet=True) or "[]")}
    out: dict[str, list[str]] = {}
    for l in links:
        name, flags = l["ifname"], set(l.get("flags", []))
        if only is not None:
            if name not in only:
                continue
        elif name.startswith(IFACE_SKIP_PREFIXES) or "UP" not in flags:
            continue
        elif "LOWER_UP" not in flags and not is_wifi_radio(name):
            continue
        out[name] = [
            str(ipaddress.ip_interface(f"{ai['local']}/{ai['prefixlen']}").network)
            for ai in addrs.get(name, []) if ai.get("scope") != "host"
        ]
    return out


def monitor_ifaces(ifaces: Iterable[str]) -> set[str]:
    """The interfaces among `ifaces` that are Wi-Fi radios in monitor mode (raw 802.11 + radiotap, no address)."""
    out = set()
    for i in ifaces:
        try:
            if int(Path(f"/sys/class/net/{i}/type").read_text().strip()) == ARPHRD_IEEE80211_RADIOTAP:
                out.add(i)
        except (OSError, ValueError):
            pass
    return out


def link_kind(name: str) -> str:
    """monitor | wifi | bridge | tunnel | ethernet, from sysfs."""
    p = Path(f"/sys/class/net/{name}")
    if is_wifi_radio(name):
        return "monitor" if monitor_ifaces([name]) else "wifi"
    if (p / "bridge").is_dir():
        return "bridge"
    if (p / "tun_flags").exists() or name.startswith(("tun", "tap", "wg", "tailscale", "zt")):
        return "tunnel"
    return "ethernet"


def sysfs_link(name: str) -> dict | None:
    """Live link flags without a subprocess: up (administratively), carrier and operstate. None when the netdev
    is gone (USB radio unplugged, container bridge removed). sysfs `flags` leaves out LOWER_UP, so the carrier
    comes from its own file, which reads as an error while the link is down."""
    p = Path(f"/sys/class/net/{name}")
    try:
        flags = int((p / "flags").read_text().strip(), 16)
        operstate = (p / "operstate").read_text().strip()
    except (OSError, ValueError):
        return None
    carrier = False
    with contextlib.suppress(OSError, ValueError):
        carrier = (p / "carrier").read_text().strip() == "1"
    return {"up": bool(flags & IFF_UP), "carrier": carrier, "operstate": operstate}


def neighbour_of(ip: str) -> dict:
    """The kernel's neighbour-cache entry for `ip`: {"state", "dev", "mac"}; empty strings when there is none."""
    out = {"state": "", "dev": "", "mac": ""}
    if not ip:
        return out
    try:
        rows = json.loads(zotoviz.run(["ip", "-j", "neigh", "show", ip], quiet=True, check=False) or "[]")
    except (ValueError, OSError):
        return out
    for n in rows:
        st = (n.get("state") or [""])[0]
        if st and st != "FAILED" or not out["state"]:
            out = {"state": st, "dev": n.get("dev", ""), "mac": n.get("lladdr", "")}
    return out


def wifi_keys_profile(path: Path) -> tuple[str | None, int]:
    """Turn the `SSID = passphrase` file into a Wireshark profile holding the 802.11 decryption keys, so tshark
    gets them with `-C <profile>` and the passphrases never appear on a command line. A 64-hex value is taken as
    a raw PSK. Returns (profile name or None, number of networks)."""
    try:
        path.chmod(0o600)
    except OSError:
        pass
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return None, 0
    keys: list[str] = []
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        ssid, sep, secret = line.partition(" = ")
        if not sep:
            ssid, sep, secret = line.partition(":")
        ssid, secret = ssid.strip(), secret.strip()
        if not ssid or not secret:
            continue
        if len(secret) == 64 and all(c in "0123456789abcdefABCDEF" for c in secret):
            keys.append(f'"wpa-psk","{secret}"')
        else:
            keys.append(f'"wpa-pwd","{secret}:{ssid}"')
    if not keys:
        return None, 0
    conf = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "wireshark" / "profiles" / WIRESHARK_PROFILE
    conf.mkdir(parents=True, exist_ok=True)
    uat = conf / "80211_keys"
    uat.write_text("# generated by zoto-viz monitor from " + str(path) + "\n" + "\n".join(keys) + "\n")
    uat.chmod(0o600)
    return WIRESHARK_PROFILE, len(keys)


def is_multicast(ip: str) -> bool:
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return a.is_multicast or ip.endswith(".255") or ip == "255.255.255.255"


def unescape_dns(name: str) -> str:
    """DNS-SD / avahi escaping: \\032 space, \\091 '[', \\. a literal dot."""
    name = name.replace("\\032", " ").replace("\\.", ".")
    return re.sub(r"\\(\d{3})", lambda m: chr(int(m.group(1)) % 256), name)


_PTR_NAME = re.compile(r"\.(in-addr|ip6)\.arpa$", re.I)
_MDNS_TYPE = re.compile(r"(?:^_|.*\.)_[a-z0-9-]+\._(tcp|udp|tls)\.", re.I)
# dest ports we will call "serves"; everything else is treated as a client/ephemeral port
_SERVICE_PORTS = {int(p) for p in (
    "21 22 23 25 53 67 68 80 88 110 123 137 138 139 143 161 389 443 445 465 500 515 548 587 631 636 853 "
    "993 995 1433 1521 1723 1883 1900 2049 2375 2376 3000 3306 3389 3478 4070 5000 5060 5222 5223 5228 "
    "5353 5355 5357 5432 5900 8008 8009 8080 8081 8443 8843 8883 9000 9090 9100 9443 9999 10001 32400 62078"
).split()}


def useful_name(name: str) -> bool:
    """Hostnames worth showing; drop PTR names, mDNS service types, and service-instance FQDNs."""
    n = name.strip().rstrip(".")
    if not n or n in (".", "*"):
        return False
    if n.startswith("*") and not n.startswith("*."):
        return False
    if _PTR_NAME.search(n) or n.lower().endswith(".arpa"):
        return False
    if n.startswith("_") and "._" in n:
        return False
    if _MDNS_TYPE.search(n) or re.search(r"\._(tcp|udp|tls)\.", n, re.I):
        return False
    if re.fullmatch(r"[\d.]+", n):
        return False
    # Cast/Nest mesh IDs and 32-hex googlezone hosts show up as additional records on every speaker
    if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.local)?", n, re.I):
        return False
    if re.fullmatch(r"[0-9a-f]{32}(?:\.local)?", n, re.I):
        return False
    return True


def useful_alias(ip: str) -> bool:
    if ip in ("::", "0.0.0.0", "::1") or ip.startswith("127."):
        return False
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return not a.is_unspecified and not a.is_loopback


def parse_payload(field: str) -> tuple[bytes, int]:
    """tshark prints a bytes field as `16:03:03:…` (older builds without the colons). Returns the first
    PAYLOAD_BYTES as bytes plus the payload's full length, so a truncated dump can say so."""
    if not field:
        return b"", 0
    colons = field[2:3] == ":"
    total = (len(field) + 1) // 3 if colons else len(field) // 2
    head = field[: PAYLOAD_BYTES * 3 - 1] if colons else field[: PAYLOAD_BYTES * 2]
    try:
        return bytes.fromhex(head.replace(":", "")), total
    except ValueError:
        return b"", 0


def is_service_port(port: int) -> bool:
    return port in _SERVICE_PORTS


def is_service_tag(tag: str) -> bool:
    try:
        return is_service_port(int(tag.split("/", 1)[1]))
    except (IndexError, ValueError):
        return False


def own_nodenames() -> set[str]:
    n = os.uname().nodename.strip().rstrip(".").lower()
    return {n, f"{n}.local", f"{n}.lan"} if n else set()


# --------------------------------------------------------------------------- state


class State:
    def __init__(self, iface: str, local_ip: str, net: str, gateway: str, only_ifaces: list[str] | None = None) -> None:
        self.iface, self.local_ip, self.net_str, self.gateway = iface, local_ip, net, gateway
        self.net = ipaddress.ip_network(net)
        self.only_ifaces = only_ifaces
        self.ifaces: dict[str, list[str]] = {}
        self.wlan: set[str] = set()              # monitor-mode radios among ifaces: raw 802.11 frames
        self.local_nets: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
        self.own_ips: set[str] = set()
        self._seen: dict[str, tuple[float, str]] = {}  # packet fingerprint -> (time, iface) for de-duplication
        # header indicators: every interface that has captured this run stays listed (red once it goes away),
        # with the time of its last frame and a per-second frame rate; the gateway gets pinged by gateway_probe_loop
        self.known_links: set[str] = set()
        self.link_seen: dict[str, float] = {}
        self.link_count: Counter = Counter()
        self._link_prev: dict[str, int] = {}
        self.link_pps: dict[str, int] = {}
        self.gw_probe: dict = {"rtt_ms": None, "neigh": "", "dev": "", "mac": "", "checked": 0.0, "last_ok": 0.0, "misses": 0}
        self.radio = rf.Radio()
        self.radio.load_watch()
        self.cpu = cpu.Sampler()
        self.hostsys = hostsys.Sampler()
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
        self._flow_ab: dict[str, dict[int, int]] = defaultdict(dict)            # flow -> sec -> bytes a→b
        self._flow_ba: dict[str, dict[int, int]] = defaultdict(dict)            # flow -> sec -> bytes b→a
        # per-device captured-traffic detail for the panel: a ring of recent packets and rolling counters
        self.recent: dict[str, deque] = defaultdict(lambda: deque(maxlen=RECENT_PACKETS))
        self.recent_flow: dict[str, deque] = defaultdict(lambda: deque(maxlen=FLOW_PACKETS))  # "a|b" -> packets
        self.ttl: dict[str, Counter] = defaultdict(Counter)   # on-segment device -> observed IPv4 TTLs (passive OS hint)
        self.forensics: dict[str, dict] = {}                   # ip -> deep-analysis job (persisted when done)
        self.traffic: dict[str, dict[str, Counter]] = defaultdict(
            lambda: {"protos": Counter(), "ports": Counter(), "queries": Counter(), "sni": Counter(), "peers": Counter()})

    # ---- interfaces
    def refresh_interfaces(self) -> bool:
        """Re-read capturable interfaces and this host's addresses. Returns True when the interface set changed."""
        ifaces = list_interfaces(self.only_ifaces)
        changed = set(ifaces) != set(self.ifaces)
        self.ifaces = ifaces
        self.known_links |= set(ifaces)
        self.wlan = monitor_ifaces(ifaces)
        self.local_nets = [ipaddress.ip_network(c) for cidrs in ifaces.values() for c in cidrs]
        own = {self.local_ip}
        for a in json.loads(zotoviz.run(["ip", "-j", "addr"], quiet=True) or "[]"):
            for ai in a.get("addr_info", []):
                loc = ai.get("local", "")
                if ai.get("scope") != "host" and useful_alias(loc):
                    own.add(loc)
        self.own_ips = own
        self._refresh_radio_link()
        return changed

    def _refresh_radio_link(self) -> None:
        """Tell the RF graph which Wi-Fi / Bluetooth addresses are this host."""
        managed = next((n for n in self.ifaces if is_wifi_radio(n) and n not in self.wlan), "")
        if managed:
            mac = ""
            with contextlib.suppress(OSError):
                mac = Path(f"/sys/class/net/{managed}/address").read_text().strip()
            bssid, ssid, chan = rf.read_wifi_link(managed)
            self.radio.set_wifi_self(mac, bssid, ssid, chan)
        bt_mac, bt_name = rf.read_bt_self()
        if bt_mac:
            self.radio.set_bt_self(bt_mac, bt_name or os.uname().nodename)

    def air_only(self, ifaces: Iterable[str]) -> bool:
        """Seen on monitor-mode radios only: when the radio hops to another channel nothing else hears it."""
        ifs = set(ifaces)
        return bool(ifs) and bool(self.wlan) and ifs <= self.wlan

    # ---- header indicators
    def link_status(self, now: float) -> list[dict]:
        """One row per interface for the header lights: the capture set, anything that captured earlier this run,
        and every Wi-Fi radio present (a stick the root unit has not put into monitor mode shows amber, not
        nothing). state: up = link up and frames in the last LINK_IDLE_S; idle = up but quiet, or up and not in
        the capture; down = no carrier / not associated / gone."""
        names = set(self.ifaces) | self.known_links
        if self.only_ifaces is None:
            names |= wifi_radios()
        rows = []
        for name in sorted(names, key=lambda n: (n != self.iface, n)):
            live = sysfs_link(name)
            kind = link_kind(name) if live else "gone"
            last = self.link_seen.get(name, 0.0)
            capturing = name in self.ifaces
            why = ""
            if live is None:
                state, why = "down", "interface gone"
            elif not live["up"]:
                state, why = "down", "link down"
            elif not live["carrier"] and kind != "monitor":
                state, why = "down", "not associated" if kind == "wifi" else "no carrier"
            elif live["operstate"] == "down":
                state, why = "down", "operstate down"
            elif not capturing:
                state, why = "idle", "not capturing"
            elif not last:
                state, why = "idle", "nothing captured yet"
            elif now - last > LINK_IDLE_S:
                state, why = "idle", f"quiet for {int(now - last)} s"
            else:
                state = "up"
            row = {
                "name": name, "kind": kind, "state": state, "why": why, "capturing": capturing,
                "up": bool(live and live["up"]), "carrier": bool(live and live["carrier"]),
                "operstate": live["operstate"] if live else "",
                "addrs": list(dict.fromkeys(self.ifaces.get(name, []))), "pps": self.link_pps.get(name, 0), "last_packet": last,
            }
            if kind == "wifi" and name not in self.wlan and self.radio.assoc_ssid:
                row["ssid"], row["chan"] = self.radio.assoc_ssid, self.radio.assoc_chan
            elif kind == "monitor" and self.radio.tuned_chan:
                row["chan"] = self.radio.tuned_chan
            rows.append(row)
        return rows

    def set_gateway_probe(self, now: float, rtt_ms: float | None, neigh: dict) -> None:
        g = self.gw_probe
        g.update(rtt_ms=rtt_ms, neigh=neigh["state"], dev=neigh["dev"], mac=neigh["mac"], checked=now)
        if rtt_ms is None:
            g["misses"] += 1
        else:
            g["misses"], g["last_ok"] = 0, now

    def gateway_status(self, now: float) -> dict:
        """The gateway light. up = answered ping (one miss is forgiven), or the neighbour cache says REACHABLE and
        its traffic is flowing; degraded = no ping reply but the entry is only stale, or traffic in the last minute
        (ICMP filtered, or a wobbly link); down = nothing answers and nothing has been heard; unknown = not probed yet."""
        g = self.gw_probe
        last_packet = float((self.devices.get(self.gateway) or {}).get("last_seen") or 0)
        pinged = g["rtt_ms"] is not None or (g["misses"] < 2 and g["last_ok"] > 0)
        if not g["checked"]:
            state = "unknown"
        elif pinged or (g["neigh"] == "REACHABLE" and now - last_packet < LINK_IDLE_S):
            state = "up"
        elif g["neigh"] in ("REACHABLE", "STALE", "DELAY", "PROBE") or now - last_packet < 60:
            state = "degraded"
        else:
            state = "down"
        return {"ip": self.gateway, "state": state, "rtt_ms": g["rtt_ms"], "neigh": g["neigh"], "dev": g["dev"],
                "mac": g["mac"], "checked": g["checked"], "last_ok": g["last_ok"], "last_packet": last_packet}

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
                if d is not None and useful_alias(ip) and ip not in d["aliases"]:
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
                d["vendor"] = zotoviz.vendor_for(mac)
        if d["mac"] and ":" not in ip and self.is_local(ip) and d["mac"] not in self.mac_to_v4:
            self.mac_to_v4[d["mac"]] = ip
            self.fold_v6()
        return d

    def add_name(self, ip: str, name: str, source: str = "") -> None:
        name = unescape_dns(name.strip().rstrip("."))
        ip = self.alias_to_ip.get(ip, ip)
        if not name or name == ip or re.fullmatch(r"[\d.]+", name) or not useful_name(name):
            return
        # this host's nodename on the gateway (or anyone else) is glue from DNS additional records / NetBIOS
        if ip != self.local_ip and name.lower() in own_nodenames():
            return
        self.names[ip].add(name)
        if ip in self.devices and name not in self.devices[ip]["hostnames"]:
            self.devices[ip]["hostnames"].append(name)
        if source and ip in self.devices and source not in self.devices[ip]["sources"]:
            self.devices[ip]["sources"].append(source)

    def fold_v6(self) -> None:
        """Fold IPv6-only nodes onto the IPv4 device with the same MAC (or EUI-64), and drop unspecified addresses."""
        for junk in [k for k in self.devices if not useful_alias(k) and not is_multicast(k) and k != self.local_ip]:
            self.devices.pop(junk, None)
            self.names.pop(junk, None)
        for v6 in [k for k in self.devices if ":" in k and not is_multicast(k)]:
            other = self.devices[v6]
            v4 = self.alias_to_ip.get(v6) or self.mac_to_v4.get(other["mac"]) or self.mac_to_v4.get(mac_from_eui64(v6))
            if not (v4 and v4 != v6 and v4 in self.devices):
                continue
            d = self.devices[v4]
            self.devices.pop(v6)
            if useful_alias(v6) and v6 not in d["aliases"]:
                d["aliases"].append(v6)
            d["bytes_in"] += other["bytes_in"]; d["bytes_out"] += other["bytes_out"]; d["packets"] += other["packets"]
            d["last_seen"] = max(d["last_seen"], other["last_seen"])
            for n in self.names.pop(v6, ()):
                self.names[v4].add(n)
                if n not in d["hostnames"] and useful_name(n):
                    d["hostnames"].append(n)
            self.alias_to_ip[v6] = v4
            for key in [k for k in self.flows if v6 in k.split("|")]:
                del self.flows[key]
                self._flow_buckets.pop(key, None)
                self._flow_ab.pop(key, None)
                self._flow_ba.pop(key, None)
                self.recent_flow.pop(key, None)

    def scrub_device(self, d: dict) -> None:
        """Drop PTR / mDNS-type names, unspecified aliases, and ephemeral 'serves' ports from a live device."""
        ip = d["ip"]
        mine = own_nodenames()
        keep = {n for n in self.names.get(ip, ()) if useful_name(n) and (ip == self.local_ip or n.lower() not in mine)}
        if keep or ip in self.names:
            self.names[ip] = keep
        d["hostnames"] = [n for n in d.get("hostnames", []) if n in keep]
        d["aliases"] = [a for a in d.get("aliases", []) if useful_alias(a)]
        d["ports"] = [p for p in d.get("ports", []) if is_service_tag(p)][:16]
        if d.get("mdns_name"):
            d["mdns_name"] = unescape_dns(d["mdns_name"])

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
        self.link_seen[iface] = t  # before de-duplication: the interface carried the frame either way
        self.link_count[iface] += 1
        ttl = f[19] if len(f) > 19 else ""
        wlan_sa, wlan_da, ip_id, ip_len, v6_plen, tcp_seq, udp_ck = (f[20:27] + [""] * 7)[:7]
        dns_resp = f[27] if len(f) > 27 else ""
        wlan_bssid, wlan_ssid, wlan_sub, wlan_sig, wlan_ch = (f[28:33] + [""] * 5)[:5]
        payload_hex = (f[33] or f[34]) if len(f) > 34 else ""
        info = "|".join(f[INFO_FIELD:]) if len(f) > INFO_FIELD else ""
        sec = int(t)

        # a frame from a monitor-mode radio: 802.11 addresses stand in for the Ethernet ones, and its length is
        # taken as the Ethernet frame it would be on the wire (no radiotap / 802.11 / CCMP overhead), so bytes
        # agree with the copies the wired path counts
        is_wlan = iface in self.wlan or (not eth_src and bool(wlan_sa or wlan_bssid))
        if is_wlan:
            eth_src, eth_dst = eth_src or wlan_sa.lower(), eth_dst or wlan_da.lower()
            self.radio.wlan_frame(
                t, size, iface, wlan_sa, wlan_da, wlan_bssid, wlan_ssid, wlan_sub, wlan_sig, wlan_ch,
                proto, info,
            )
            with contextlib.suppress(ValueError):
                if ip_len or v6_plen:
                    size = (int(ip_len) if ip_len else int(v6_plen) + 40) + 14
        elif is_wifi_radio(iface) and self.radio.assoc_bssid:
            # associated client radio: no beacons, but this host's own frames still belong to the AP
            self.radio.wlan_frame(
                t, size, iface, eth_src, eth_dst, self.radio.assoc_bssid, self.radio.assoc_ssid,
                "0x28", "", str(self.radio.assoc_chan or ""), proto, info,
            )
        if src and dst:
            # the same packet again on another path within a second: this host's traffic seen on its own radio and
            # in the air, or a wireless relay (client → AP, AP → client) heard twice on the monitor radio
            fp = f"{src}>{dst}|{tsp or usp}>{tdp or udp_}|{ip_id}|{ip_len or v6_plen}|{tcp_seq}|{udp_ck}"
            prev = self._seen.get(fp)
            self._seen[fp] = (t, iface)
            if prev and t - prev[0] < DEDUPE_S and (prev[1] != iface or is_wlan):
                return
        elif is_wlan:
            return  # an air frame we cannot read (not decrypted, no handshake yet) or without IP: not counted

        self.packets += 1
        self.bytes += size
        b = self._rate_buckets[sec]
        b[0] += 1
        b[1] += size

        if not src or not dst:
            return
        if src in ("0.0.0.0", "::"):  # DHCP discover/request: attribute to the sender's known IPv4, else skip
            src = self.mac_to_v4.get(eth_src, "")
            if not src:
                return
        if not useful_alias(src) or not (useful_alias(dst) or is_multicast(dst)):
            return

        # a frame's MAC only identifies the IP when that IP is on this segment; otherwise it is the gateway's
        src = self.canonical(src, eth_src if self.is_local(src) else "")
        dst = self.canonical(dst, eth_dst if self.is_local(dst) and not is_multicast(dst) else "")
        if self.forensics and self._is_probe(src, dst):
            return  # our own deep-analysis probes: keep the scan out of the passive picture of the target
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
        if ttl and self.is_local(src) and not is_multicast(src) and not is_multicast(dst) and ds["mac"] and ds["mac"] == eth_src:
            # unicast from a sender on this segment: the TTL is its initial TTL (unforwarded), a passive OS hint.
            # multicast is excluded because mDNS / LLMNR mandate TTL 255 and SSDP uses small TTLs regardless of OS.
            try:
                self.ttl[src][int(ttl)] += 1
            except ValueError:
                pass
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
                                    "first_seen": t, "last_seen": t, "rate": 0.0, "rate_ab": 0.0, "rate_ba": 0.0}
        if iface and iface not in fl["ifaces"]:
            fl["ifaces"].append(iface)
        fl["bytes"] += size
        fl["packets"] += 1
        fl["last_seen"] = t
        fb = self._flow_buckets[key]
        fb[sec] = fb.get(sec, 0) + size
        side = self._flow_ab[key] if src == a else self._flow_ba[key]
        side[sec] = side.get(sec, 0) + size
        port_kind = "tcp" if tsp else ("udp" if usp else "")
        tag = ""
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
            if self.is_local(dst) and not is_multicast(dst) and str(dp) == str(svc) and is_service_port(svc):
                if tag not in dd["ports"]:
                    dd["ports"].append(tag)
                    if len(dd["ports"]) > 16:
                        dd["ports"] = dd["ports"][:16]
        if proto and proto not in fl["protos"]:
            fl["protos"].append(proto)
            if len(fl["protos"]) > 8:
                fl["protos"].pop(0)

        # names
        if sni:
            for n in sni.split(","):
                self.add_name(dst, n, "sni")
        # pair each A record with its response name. Applying the first query name to every answer is how
        # Android.local / Cast mesh IDs landed on every speaker in an mDNS packet.
        if dns_resp and dns_a:
            for n, ip in zip(dns_resp.split(","), dns_a.split(",")):
                ip = ip.strip()
                if ip and ip != dst:
                    self.add_name(ip, n, "dns")
        if dhcp_host:
            self.add_name(src, dhcp_host, "dhcp")

        # captured-traffic detail (both endpoints; local devices are what the panel is for, but a
        # remote host's view is useful too). Multicast hubs are skipped: they would collect everything.
        info = info[:300]
        ports = f"{sp}→{dp}" if port_kind else ""  # real source→destination ports; `tag` is the service side
        q = dns_q.split(",")[0].rstrip(".") if dns_q else ""
        s_ = sni.split(",")[0] if sni else ""
        payload, payload_len = parse_payload(payload_hex)
        self.recent_flow[key].append([round(t, 3), src, proto, tag, size, iface, info, q, s_, ports, payload, payload_len])
        for dev, direction, peer in ((src, "out", dst), (dst, "in", src)):
            if is_multicast(dev):
                continue
            self.recent[dev].append([round(t, 3), direction, peer, proto, tag, size, iface, info, ports])
            c = self.traffic[dev]
            if proto:
                c["protos"][proto] += 1
            if tag:
                c["ports"][tag] += 1
            c["peers"][peer] += size
            if direction == "out":
                if q:  # what this device asks for (DNS, and mDNS service browsing such as _googlecast._tcp.local)
                    c["queries"][q] += 1
                if s_:
                    c["sni"][s_] += 1
            for k, cnt in c.items():
                if len(cnt) > COUNTER_CAP:
                    c[k] = Counter(dict(cnt.most_common(COUNTER_CAP // 2)))

    def expand_group(self, token: str) -> list[str]:
        """`@any`, `@internet` or `@lan` (this host, the gateway, LAN and local devices) -> every matching device;
        `@wifi` / `@bluetooth` are the RF picture; anything else is one address, aliases folded onto the canonical IPv4."""
        if token == "@any":
            return list(self.devices)
        if token == "@internet":
            return [x for x in self.devices if self.role(x) == "internet"]
        if token == "@lan":
            return [x for x in self.devices if self.role(x) in ("self", "gateway", "lan", "local")]
        if token in ("@wifi", "@bluetooth", "@bt", "@air", "@rf"):
            return self.radio.expand(token)
        return [self.alias_to_ip.get(token, token)]

    def _ring(self, ip: str) -> deque:
        return self.radio.recent[ip] if self.radio.known(ip) else self.recent[ip]

    def _counters(self, ip: str) -> dict[str, Counter] | None:
        if self.radio.known(ip):
            return self.radio.traffic.get(ip)
        return self.traffic.get(ip)

    def _flow_ring(self, key: str) -> deque:
        return self.radio.recent_flow[key] if key in self.radio.recent_flow else self.recent_flow[key]

    def payload_of(self, ip: str, peer: str, t: float, size: int) -> dict | None:
        """The captured head of one packet's transport payload, found in the conversation ring by its
        timestamp and size (what a trace row carries). None once the ring has rolled past it."""
        ip, peer = self.alias_to_ip.get(ip, ip), self.alias_to_ip.get(peer, peer)
        ring = self.recent_flow.get("|".join(sorted((ip, peer))))
        if not ring:
            return None
        for p in reversed(ring):
            if abs(p[0] - t) < 0.0005 and p[4] == size:
                payload = p[10] if len(p) > 10 else b""
                return {
                    "t": p[0], "src": p[1], "proto": p[2], "size": size, "ports": p[9], "info": p[6],
                    "payload": payload.hex(), "captured": len(payload), "total": p[11] if len(p) > 11 else len(payload),
                }
        return None

    def traffic_detail(self, ip: str, now: float, peer: str = "", since: float = 0.0) -> dict | None:
        """Recent packets and rolling counters for one device, or for one conversation when `peer` is given.
        Aliases fold onto the canonical IPv4. Both may be comma-separated groups (the UI's "merge names" option
        collapses devices sharing a hostname) or a role token (`@lan`, `@internet`, `@any`, `@wifi`, `@bluetooth`);
        rings and counters are then merged and every packet carries the member it belongs to as a trailing
        element. `since` returns only packets newer than that time (a poll cursor: cheap even for a large group,
        and not capped at the ring size).
        Packets are newest first: [t, dir, peer, proto, port, size, iface, info, src→dst ports, member?]."""
        ips = [x for tok in ip.split(",") if tok for x in self.expand_group(tok)]
        ips = list(dict.fromkeys(x for x in ips if x in self.devices or self.radio.known(x)))
        if not ips:
            return None
        ip = ips[0]
        group = len(ips) > 1
        cap = GROUP_PACKETS if since else RECENT_PACKETS
        peers = list(dict.fromkeys(y for x in peer.split(",") if x for y in self.expand_group(x)))
        if peers:
            recent, c = [], {"protos": Counter(), "ports": Counter(), "queries": Counter(), "sni": Counter(), "peers": Counter()}
            for me in ips:
                for pr in peers:
                    if pr == me:
                        continue
                    for t, src, proto, tag, size, iface, info, q, s_, ports, *_ in reversed(self._flow_ring("|".join(sorted((me, pr))))):
                        if t <= since:
                            break
                        out = src == me  # relative to this member, even when the peer is a member too
                        recent.append([t, "out" if out else "in", pr, proto, tag, size, iface, info, ports] + ([me] if group else []))
                        if proto:
                            c["protos"][proto] += 1
                        if tag:
                            c["ports"][tag] += 1
                        c["peers"][pr] += size
                        if out and q:
                            c["queries"][q] += 1
                        if out and s_:
                            c["sni"][s_] += 1
            recent.sort(key=lambda p: p[0])
            recent = recent[-cap:]
            peer = peers[0]
        elif not group:
            ring = self._ring(ip)
            if since:
                recent = []
                for p in reversed(ring):
                    if p[0] <= since:
                        break
                    recent.append(p)
                recent.reverse()
            else:
                recent = list(ring)
            c = self._counters(ip)
        else:
            recent = []
            for x in ips:
                for p in reversed(self._ring(x)):
                    if p[0] <= since:
                        break
                    recent.append(p + [x])
            recent.sort(key=lambda p: p[0])
            recent = recent[-cap:]
            c = None
            if not since:  # a poll cursor wants packets only; merging hundreds of counters every second is not free
                c = {"protos": Counter(), "ports": Counter(), "queries": Counter(), "sni": Counter(), "peers": Counter()}
                for x in ips:
                    extra = self._counters(x)
                    if extra:
                        for k, cnt in extra.items():
                            c[k].update(cnt)
                for x in ips:  # conversations between members of the same group are not "peers"
                    c["peers"].pop(x, None)
        top = (lambda k, n: c[k].most_common(n)) if c else (lambda k, n: [])
        return {
            "ip": ip,
            "peer": peer or None,
            "ts": now,
            "packets": recent[::-1],
            "window": {"first": recent[0][0], "last": recent[-1][0], "count": len(recent)} if recent else None,
            "summary": {
                "protos": top("protos", 12), "ports": top("ports", 12), "queries": top("queries", 20),
                "sni": top("sni", 20), "peers": top("peers", 12),
            },
        }

    # ---- periodic
    def tick(self, now: float) -> None:
        if len(self._seen) > 20000:
            self._seen = {k: v for k, v in self._seen.items() if now - v[0] < DEDUPE_S * 2}
        for name, c in self.link_count.items():  # frames since the last tick (~1 s): the header tooltip's rate
            self.link_pps[name] = c - self._link_prev.get(name, c)
            self._link_prev[name] = c
        cutoff = int(now) - RATE_WINDOW_S
        for s in [s for s in self._rate_buckets if s < cutoff - 1]:
            del self._rate_buckets[s]
        away = self.radio.away
        for key, fl in list(self.flows.items()):
            if away and self.air_only(fl["ifaces"]):
                # the monitor radio is off on another network's channel: a conversation only ever heard in the air
                # keeps its last rate instead of decaying to nothing while nobody is listening
                if now - fl["last_seen"] > rf.HELD_MAX_S:
                    del self.flows[key]
                    self._flow_buckets.pop(key, None)
                    self._flow_ab.pop(key, None)
                    self._flow_ba.pop(key, None)
                    self.recent_flow.pop(key, None)
                continue
            fb = self._flow_buckets[key]
            for s in [s for s in fb if s < cutoff - 1]:
                del fb[s]
            fl["rate"] = sum(v for s, v in fb.items() if s >= cutoff) / RATE_WINDOW_S
            ab, ba = self._flow_ab[key], self._flow_ba[key]
            for bucket in (ab, ba):
                for s in [s for s in bucket if s < cutoff - 1]:
                    del bucket[s]
            fl["rate_ab"] = sum(v for s, v in ab.items() if s >= cutoff) / RATE_WINDOW_S
            fl["rate_ba"] = sum(v for s, v in ba.items() if s >= cutoff) / RATE_WINDOW_S
            if now - fl["last_seen"] > FLOW_IDLE_S:
                del self.flows[key]
                del self._flow_buckets[key]
                self._flow_ab.pop(key, None)
                self._flow_ba.pop(key, None)
                self.recent_flow.pop(key, None)
        self.radio.tick(now)

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
        away = self.radio.away
        for d in self.devices.values():
            self.scrub_device(d)
            dd = dict(d)
            dd["role"] = self.role(d["ip"])  # interfaces/subnets can change at runtime
            # a device only ever heard in the air is judged as of the moment the radio left its channel
            ref = self.radio.home_left_at if away and self.air_only(d.get("ifaces") or []) else now
            dd["online"] = (ref - d["last_seen"]) < DEVICE_OFFLINE_S if d["last_seen"] else False
            dd["names"] = sorted(self.names.get(d["ip"], ()), key=lambda n: (n.startswith("*"), len(n)))
            ttl = forensics.most_common_ttl(self.ttl[d["ip"]]) if d["ip"] in self.ttl else None
            dd["ttl"] = ttl
            job = self.forensics.get(d["ip"])
            if job and ttl and job.get("facts") and job["facts"].get("ttl") != ttl:
                facts = {**job["facts"], "ttl": ttl}
                job["facts"] = facts
                ident = (job.get("steps") or {}).get("identity")
                if ident and ident.get("data"):
                    job["steps"] = {**(job.get("steps") or {}), "identity": {**ident, "data": {**ident["data"], "ttl_hint": forensics.ttl_hint(ttl)}}}
                if job.get("status") == "done":
                    job["summary"] = forensics.summarise(job.get("steps") or {}, facts)
            dd["analysis"] = job["status"] if job else None  # running | done | error; lets the panel show a badge
            devices.append(dd)
        return {
            "ts": now,
            "iface": self.iface,
            "interfaces": sorted(self.ifaces),
            "links": self.link_status(now),
            "network": self.net_str,
            "local_ip": self.local_ip,
            "gateway": self.gateway,
            "gateway_status": self.gateway_status(now),
            "uptime": now - self.started,
            "stats": {"pps": pk, "bps": bp, "packets": self.packets, "bytes": self.bytes,
                      "devices": len(self.devices), "online": sum(1 for d in devices if d["online"]),
                      "flows": len(self.flows), "active_flows": sum(1 for f in self.flows.values() if f["rate"] > 0)},
            "devices": devices,
            "flows": list(self.flows.values()),
            "views": {
                **self.radio.views(now),
                "cpu": self.hostsys.decorate_cpu(self.cpu.snapshot(now)),
                **self.hostsys.views(now),
            },
        }

    # ---- deep analysis (forensics.py)
    @property
    def probing(self) -> set[str]:
        """Devices with a running analysis job (their traffic with this host is ignored while it runs)."""
        return {ip for ip, j in self.forensics.items() if j["status"] == "running"}

    def _is_probe(self, src: str, dst: str) -> bool:
        own = self.own_ips | {self.local_ip}
        probing = self.probing
        return (src in own and dst in probing) or (dst in own and src in probing)

    def analysis_facts(self, ip: str) -> dict:
        """Passive knowledge handed to a forensics job: locality, aliases, TTL, ports we saw it use."""
        d = self.devices[ip]
        ports_seen = sorted({p for f in self.flows.values() if ip in (f["a"], f["b"]) for p in f["ports"]})
        return {
            "local": self.is_local(ip) and not is_multicast(ip), "role": self.role(ip), "aliases": d.get("aliases", []),
            "mac": d.get("mac", ""), "vendor": d.get("vendor", ""), "names": sorted(self.names.get(ip, ())),
            "ttl": forensics.most_common_ttl(self.ttl[ip]) if ip in self.ttl else None,
            "ports_seen": ports_seen, "serves": d.get("ports", []), "ifaces": d.get("ifaces", []),
        }

    def start_analysis(self, ip: str, pool: ThreadPoolExecutor, loop: asyncio.AbstractEventLoop) -> dict | None:
        """Kick off a deep-analysis job for a known device. Returns the job, or None when the ip is unknown."""
        ip = self.alias_to_ip.get(ip, ip)
        if ip not in self.devices or is_multicast(ip):
            return None
        cur = self.forensics.get(ip)
        if cur and cur["status"] == "running":
            return cur
        facts = self.analysis_facts(ip)
        job: dict = {"ip": ip, "status": "running", "started": time.time(), "finished": None, "facts": facts, "steps": {}, "summary": None}
        self.forensics[ip] = job

        def progress(step: str, res: dict) -> None:
            # replace, never mutate, so a snapshot being serialised on the event loop never sees a half-updated dict
            job["steps"] = {**job["steps"], step: res}

        def work() -> None:
            try:
                steps = forensics.run_job(ip, facts, progress)
                job["summary"] = forensics.summarise(steps, facts)
                job["status"] = "done"
                for n in job["summary"]["names"]:
                    loop.call_soon_threadsafe(self.add_name, ip, n, "analysis")
            except Exception as e:  # noqa: BLE001
                job["status"] = "error"
                job["error"] = f"{type(e).__name__}: {e}"
            finally:
                job["finished"] = time.time()
                log(f"analysis of {ip}: {job['status']} in {job['finished'] - job['started']:.0f}s")

        log(f"analysis of {ip} started ({'local' if facts['local'] else 'remote'})")
        pool.submit(work)
        return job

    # ---- persistence
    def save(self) -> None:
        DATA.mkdir(exist_ok=True)
        tmp = STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps({
            "devices": self.devices,
            "names": {k: sorted(v) for k, v in self.names.items()},
            "cert_tried": sorted(self.cert_tried),
            "forensics": {ip: j for ip, j in self.forensics.items() if j["status"] != "running"},
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
            if not useful_alias(ip) or (ip in self.own_ips and ip != self.local_ip):
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
                if useful_alias(a):
                    self.alias_to_ip[a] = ip
        for ip, ns in s.get("names", {}).items():
            self.names[ip].update(n for n in ns if useful_name(n))
        self.cert_tried.update(s.get("cert_tried", []))
        for ip, j in s.get("forensics", {}).items():
            if ip in self.devices:
                if j.get("status") == "done":  # summary logic may have improved since the job ran
                    j["summary"] = forensics.summarise(j.get("steps", {}), j.get("facts", {}))
                self.forensics[ip] = j
        self.fold_v6()
        for d in self.devices.values():
            self.scrub_device(d)
            d["aliases"] = list(dict.fromkeys(d["aliases"]))
        log(f"restored {len(self.devices)} devices from {STATE_FILE.name}")


# --------------------------------------------------------------------------- capture


def tshark_cmd(ifaces: list[str], bpf: str, wlan: set[str] = frozenset(), profile: str | None = None) -> list[str]:
    """One tshark over every interface. A `-f` filter applies to the `-i` before it: monitor-mode radios take
    802.11 data and management frames (beacons, probes, assoc — control/ACKs stay out), the others the user's
    BPF. With a key profile the radios' WPA frames are decrypted (per client, once its 4-way handshake has
    been heard)."""
    cmd = ["tshark"]
    if profile:
        cmd += ["-C", profile, "-o", "wlan.enable_decryption:TRUE"]
    for i in ifaces:
        cmd += ["-i", i]
        if i in wlan:
            cmd += ["-f", "type data or type mgt"]
        elif bpf:
            cmd += ["-f", bpf]
    cmd += ["-l", "-q", "-n", "-T", "fields", "-E", "separator=|", "-E", "occurrence=f"]
    for f in FIELDS:
        cmd += ["-e", f]
    return cmd


def bt_tshark_cmd() -> list[str]:
    cmd = ["tshark", "-i", "bluetooth0", "-l", "-q", "-n", "-T", "fields", "-E", "separator=|", "-E", "occurrence=f"]
    for f in BT_FIELDS:
        cmd += ["-e", f]
    return cmd


def wrap_privileged(cmd: list[str]) -> list[str]:
    """Capture as the wireshark group without interpolating argv into a shell.

    `sg -c` is not used: a quote in --filter would break that string. sudo's argv
    form (`sudo -n -- tshark …`) keeps every flag a separate argument.
    Skip sudo when ``sudo -n`` cannot run (no cached credentials): a password
    prompt would fail every restart and fill the log.
    """
    if os.geteuid() == 0 or zotoviz.group_active("wireshark"):
        return cmd
    if not zotoviz.sudo_n_ok():
        return cmd
    sudo = shutil.which("sudo")
    if not sudo:
        return cmd
    extra = ["-g", "wireshark"] if zotoviz.group_member("wireshark") else []
    return [sudo, "-n", *extra, "--"] + cmd


async def _close_proc(proc: asyncio.subprocess.Process) -> None:
    """Reap a child and close its pipes so asyncio does not GC them after the loop dies."""
    with contextlib.suppress(Exception):
        if proc.stdout:
            proc.stdout.close()
        if proc.stderr:
            proc.stderr.close()
    with contextlib.suppress(Exception):
        await asyncio.wait_for(proc.wait(), 1)


async def _kill_group(proc: asyncio.subprocess.Process) -> None:
    with contextlib.suppress(ProcessLookupError):
        os.killpg(proc.pid, signal.SIGTERM)
    with contextlib.suppress(Exception):
        await asyncio.wait_for(proc.wait(), 3)
    with contextlib.suppress(ProcessLookupError):
        os.killpg(proc.pid, signal.SIGKILL)
    await _close_proc(proc)


async def capture_loop(state: State, bpf: str, wifi_keys: Path) -> None:
    backoff = 2
    while True:
        # re-read before every start: an interface that vanished while tshark was down (a USB radio re-plugged)
        # would otherwise stay in the list and make every start fail
        state.refresh_interfaces()
        ifaces = sorted(state.ifaces) or [state.iface]
        missed = sorted(wifi_radios() - set(ifaces))
        if missed:
            log("wifi radios present but not capturing: " + ", ".join(missed)
                + " (interface down; start zoto-viz-wifi-monitor@<iface> for a second radio)")
        profile, nkeys = wifi_keys_profile(wifi_keys) if state.wlan else (None, 0)
        cmd = wrap_privileged(tshark_cmd(ifaces, bpf, state.wlan, profile))
        log(f"starting capture on {', '.join(ifaces)} via {cmd[0]}" + (f" (filter: {bpf})" if bpf else "")
            + (f"; monitor-mode {', '.join(sorted(state.wlan))}: " + (f"decrypting {nkeys} network(s) from {wifi_keys}" if profile else f"no keys in {wifi_keys}, encrypted frames will not be read") if state.wlan else ""))
        # own process group so sudo/tshark/dumpcap die together on shutdown. The line limit
        # must hold a 64 KB GSO frame's payload as colon-separated hex (~190 KB); asyncio's default is 64 KiB.
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, start_new_session=True,
                limit=CAPTURE_LINE_LIMIT,
            )
        except FileNotFoundError:
            log(f"capture: {cmd[0]} not found on PATH; install tshark (`zoto-viz install --yes`)")
            await asyncio.sleep(60)
            continue
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
        oversize = bad = 0
        try:
            while True:
                try:
                    raw = await proc.stdout.readline()
                except ValueError:
                    # a line past the limit: readline() has dropped it and reading continues with the next
                    oversize += 1
                    if oversize in (1, 100, 10000):
                        log(f"capture: dropped {oversize} line(s) longer than {CAPTURE_LINE_LIMIT // 1024} KiB")
                    continue
                if not raw:
                    break
                line = raw.decode(errors="replace").rstrip("\n")
                if not line:
                    continue
                try:
                    state.packet(line.split("|"))
                except Exception as e:  # one odd line must not take the capture down with it
                    bad += 1
                    if bad in (1, 100, 10000):
                        log(f"capture: packet #{n} not parsed ({e!r})")
                n += 1
                if n % 2000 == 0:
                    await asyncio.sleep(0)  # yield to the server under heavy load
        except asyncio.CancelledError:
            watcher.cancel()
            await _kill_group(proc)
            raise
        except Exception as e:
            # anything else escaping the reader would end this task silently while tshark blocks on a full pipe
            log(f"capture: reader failed after {n} packets ({e!r}); restarting tshark")
            await _kill_group(proc)
        restarted_by_watcher = watcher.done() and not watcher.cancelled()
        watcher.cancel()
        err = (await proc.stderr.read()).decode(errors="replace").strip() if proc.stderr else ""
        rc = await proc.wait()
        await _close_proc(proc)
        if restarted_by_watcher:
            backoff = 1
        else:
            # the last stderr line is usually just "N packets captured"; the reason comes before it
            reasons = [l for l in err.splitlines() if l.strip() and not l.endswith("packets captured")]
            reason = reasons[-1].strip() if reasons else ""
            log(f"tshark exited rc={rc} after {n} packets" + (f": {reason}" if reason else ""))
            low = reason.lower()
            if any(s in low for s in ("password is required", "a terminal is required", "permission denied", "you do not have permission")):
                log("capture: dumpcap needs the wireshark group (sudo usermod -aG wireshark $USER, then log out)")
            backoff = 2 if time.time() - t0 > 60 else min(backoff * 2, 60)
        await asyncio.sleep(backoff)


async def wifi_scan_loop(state: State) -> None:
    """Periodic NetworkManager scan fills in SSIDs/APs on every channel; monitor-mode frames decode the current one."""
    rescan = True
    while True:
        try:
            rows = await asyncio.to_thread(rf.nmcli_scan, rescan)
            iface = next((n for n in state.ifaces if is_wifi_radio(n) and n not in state.wlan), "")
            for row in rows:
                state.radio.ingest_scan_row(row, iface)
            if rows:
                log(f"wifi scan: {len(rows)} access points")
                # channel widths for the hop plan come from the managed radio's cached scan (no rescan, unprivileged)
                ext = await asyncio.to_thread(rf.iw_scan_dump, iface) if state.wlan else {}
                state.radio.set_scan(rows, ext)
                refresh_hop_plan(state)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log(f"wifi scan failed: {e}")
        rescan = True
        await asyncio.sleep(45)


def refresh_hop_plan(state: State) -> None:
    """Rebuild the channel plan from the watch list and the last scan; log when the file for the hopper changes."""
    if state.radio.refresh_plan():
        plan = state.radio.plan
        if plan:
            log("wifi hop plan: " + " → ".join(f"ch{s['chan']}/{s['width']} ({', '.join(s['ssids'])})" for s in plan)
                + f", {plan[0]['dwell']} s each · {rf.PLAN_FILE}")
        else:
            log("wifi hop plan cleared (radio stays on the primary link's channel)")


async def gateway_probe_loop(state: State) -> None:
    """Ping the gateway for the header light and read its neighbour-cache entry; State.gateway_status folds in
    captured traffic so a gateway that filters ICMP still shows green while packets flow through it. `ping` runs
    unprivileged (cap_net_raw or ICMP datagram sockets); without it only the neighbour cache and traffic count."""
    ping = shutil.which("ping")
    if not ping:
        log("ping not found: the gateway light will follow the neighbour cache and captured traffic only")
    last_state = ""
    while True:
        now = time.time()
        rtt: float | None = None
        if ping and state.gateway:
            proc = None
            try:
                proc = await asyncio.create_subprocess_exec(
                    ping, "-n", "-c", "1", "-W", str(GATEWAY_PING_WAIT_S), state.gateway,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                )
                out, _ = await asyncio.wait_for(proc.communicate(), GATEWAY_PING_WAIT_S + 3)
                if proc.returncode == 0:
                    m = re.search(rb"time[=<]([\d.]+) ?ms", out)
                    rtt = float(m.group(1)) if m else 0.0
            except asyncio.CancelledError:
                if proc is not None:
                    await _kill_group(proc)
                raise
            except (OSError, asyncio.TimeoutError):
                if proc is not None:
                    await _kill_group(proc)
        neigh = await asyncio.to_thread(neighbour_of, state.gateway)
        state.set_gateway_probe(now, rtt, neigh)
        st = state.gateway_status(now)["state"]
        if st != last_state and last_state:
            log(f"gateway {state.gateway}: {st}" + (f" ({rtt:.1f} ms)" if rtt is not None else "")
                + (f" · neighbour {neigh['state']} via {neigh['dev']}" if neigh["state"] else " · no neighbour entry"))
        last_state = st
        await asyncio.sleep(GATEWAY_PROBE_S)


async def hop_status_loop(state: State) -> None:
    """Where is the monitor radio tuned. The root hopper retunes it; we only read `iw dev <radio> info`, so this
    works whether the radio is hopping, parked, or being retuned by hand."""
    while True:
        try:
            mon = min(state.wlan) if state.wlan else ""
            if mon:
                chan, freq, width = await asyncio.to_thread(rf.read_monitor_channel, mon)
                now = time.time()
                if state.radio.set_tuned(chan, freq, width, now, mon) and chan:
                    st = state.radio.watch_status(now)
                    what = ", ".join(st["slot"]) or ("home" if chan == state.radio.assoc_chan else "unplanned")
                    log(f"radio {mon}: ch{chan} ({freq} MHz, {width} MHz wide) · {what}")
            elif state.radio.tuned_chan:
                state.radio.set_tuned(0, 0, 0, time.time())
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log(f"radio status failed: {e}")
        await asyncio.sleep(2)


def _bt_addr(raw: str) -> str:
    for part in (raw or "").replace(",", " ").split():
        if part.count(":") == 5:
            return part
    return ""


async def bluetooth_loop(state: State) -> None:
    """HCI capture (decoded advertisements) in parallel with bluetoothctl inquiry (names)."""
    tshark_task = asyncio.create_task(_bt_tshark_loop(state))
    scan_task = asyncio.create_task(_bt_scan_loop(state))
    try:
        await asyncio.gather(tshark_task, scan_task)
    except asyncio.CancelledError:
        tshark_task.cancel()
        scan_task.cancel()
        await asyncio.gather(tshark_task, scan_task, return_exceptions=True)
        raise


async def _bt_tshark_loop(state: State) -> None:
    backoff, warned = 2, False
    while True:
        cmd = wrap_privileged(bt_tshark_cmd())
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, start_new_session=True,
            )
        except FileNotFoundError:
            if not warned:
                log(f"bluetooth0 capture unavailable ({cmd[0]} not found); names still come from bluetoothctl")
                warned = True
            await asyncio.sleep(60)
            continue
        assert proc.stdout
        n = 0
        try:
            async for raw in proc.stdout:
                line = raw.decode(errors="replace").rstrip("\n")
                if not line:
                    continue
                f = line.split("|")
                if len(f) < 4:
                    continue
                try:
                    t = float(f[0]); size = int(f[1] or 0)
                except ValueError:
                    continue
                addr = _bt_addr(f[3] or f[2])
                name = f[4] if len(f) > 4 else ""
                uuids = f[5] if len(f) > 5 else ""
                company = f[6] if len(f) > 6 else ""
                txp = f[7] if len(f) > 7 else ""
                proto = f[8] if len(f) > 8 else "BTLE"
                info = "|".join(f[BT_INFO:]) if len(f) > BT_INFO else ""
                addr = addr or _bt_addr(info)
                if addr:
                    state.radio.bt_frame(t, size, "bluetooth0", addr, name, uuids, company, txp, proto, info)
                    n += 1
        except asyncio.CancelledError:
            await _kill_group(proc)
            raise
        err = (await proc.stderr.read()).decode(errors="replace").strip() if proc.stderr else ""
        await proc.wait()
        await _close_proc(proc)
        if n == 0 and not warned:
            log("bluetooth0 capture unavailable" + (f" ({err.splitlines()[-1][:160]})" if err else "") + "; names still come from bluetoothctl")
            warned = True
        backoff = 2 if n else min(backoff * 2, 60)
        await asyncio.sleep(backoff)


async def _bt_scan_loop(state: State) -> None:
    if not shutil.which("bluetoothctl"):
        log("bluetoothctl not found; Bluetooth plugin will stay empty without HCI capture")
        return
    while True:
        try:
            await _bluetoothctl_scan(state)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log(f"bluetoothctl scan failed: {e}")
        await asyncio.sleep(8)


async def _bluetoothctl_scan(state: State) -> None:
    proc = await asyncio.create_subprocess_exec(
        "bluetoothctl", "--timeout", "14", "scan", "on",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    assert proc.stdout
    try:
        now = time.time()
        async for raw in proc.stdout:
            rec = rf.parse_bluetoothctl_line(raw.decode(errors="replace"))
            if not rec:
                continue
            addr = rec.get("addr", "")
            if rec.get("name") or rec.get("paired") or rec.get("connected"):
                state.radio.bt_named(addr, rec.get("name", ""), bool(rec.get("paired")), bool(rec.get("connected")))
            if rec.get("rssi") or rec.get("name"):
                state.radio.bt_frame(
                    now, 0, "hci0", addr, rec.get("name", ""), "", "", "",
                    "BTLE", rec.get("name") or "advertisement", rec.get("rssi", ""),
                )
                now = time.time()
        await proc.wait()
    except asyncio.CancelledError:
        await _kill_group(proc)
        raise
    finally:
        await _close_proc(proc)


# --------------------------------------------------------------------------- discovery


def discover_once(state: State) -> None:
    """Root-less discovery pass: kernel neighbour table, mDNS, NetBIOS. Runs in a worker thread."""
    for family in ("-4", "-6"):
        try:
            for n in json.loads(zotoviz.run(["ip", "-j", family, "neigh", "show"], quiet=True) or "[]"):
                dst, mac = n.get("dst", ""), (n.get("lladdr") or "").lower()
                if not dst or not mac or n.get("state", [""])[0] in ("FAILED", "INCOMPLETE") or n.get("dev") not in state.ifaces:
                    continue
                if not useful_alias(dst):
                    continue
                ip = state.canonical(dst, mac)
                d = state.device(ip, mac)
                if "neigh" not in d["sources"]:
                    d["sources"].append("neigh")
                if n.get("dev") and n["dev"] not in d["ifaces"]:
                    d["ifaces"].append(n["dev"])
        except Exception as e:  # noqa: BLE001
            log(f"neigh {family} failed: {e}")
    state.fold_v6()

    out = zotoviz.run(["avahi-browse", "-a", "-t", "-r", "-p"], check=False, timeout=15, quiet=True)
    for line in out.splitlines():
        f = line.split(";")
        if len(f) >= 9 and f[0] == "=" and f[2] == "IPv4" and ":" not in f[7]:
            ip, host, name, svc = f[7], f[6], unescape_dns(f[3]), f[4]
            d = state.device(ip)
            state.add_name(ip, host, "mdns")
            if not d.get("mdns_name"):
                d["mdns_name"], d["mdns_service"] = name, svc

    out = zotoviz.run(["nbtscan", "-q", "-s", ";", state.net_str], check=False, timeout=30, quiet=True)
    for line in out.splitlines():
        f = [x.strip() for x in line.split(";")]
        if len(f) >= 2 and re.match(r"^\d+\.\d+\.\d+\.\d+$", f[0]):
            mac = f[4].lower() if len(f) > 4 and f[4] != "00:00:00:00:00:00" else ""
            state.device(f[0], mac)
            state.add_name(f[0], f[1], "netbios")

    own = json.loads(zotoviz.run(["ip", "-j", "link", "show", state.iface], quiet=True) or "[]")
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
            results = await asyncio.gather(*(loop.run_in_executor(pool, zotoviz._probe_cert, ip, 443) for ip in peers))
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


def publish_state(state: State) -> dict:
    """1 Hz snapshot after plugin service hooks have had a chance to decorate it."""
    msg = plugin_ds.apply_snapshot(hooks.on_snapshot(state.snapshot(time.time())))
    sources.apply(msg)
    sdm.apply(msg)
    msg["live"] = live.snapshot()
    rev = repo_sync.repo_rev()
    if rev:
        msg["repoRev"] = rev
    return msg


async def local_drop_watch_loop(app: web.Application) -> None:
    """Pick up ``~/.zoto-viz/plugins/local/*.zip`` without waiting on ``hooks.sync``.

    Catalog compile can take longer than a filesystem drop; keep this loop short
    so a new zip activates on the open UI within a second.
    """
    while True:
        try:
            from . import plugin_local
            plugin_local.sync_local_drop()
        except Exception as e:  # noqa: BLE001
            log(f"local plugin watch: {e}")
        await asyncio.sleep(0.5)


async def sources_poll_loop(app: web.Application) -> None:
    """Refresh due RSS / HTTP / file sources without blocking the 1 Hz snapshot."""
    sources.ensure()
    while True:
        try:
            await sources.poll()
        except Exception as e:  # noqa: BLE001
            log(f"sources poll: {e}")
        await asyncio.sleep(2)


async def sdm_poll_loop(app: web.Application) -> None:
    """List Nest devices and pull Pub/Sub events when Device Access is linked."""
    sdm.ensure()
    while True:
        try:
            await sdm.poll()
        except Exception as e:  # noqa: BLE001
            log(f"sdm poll: {e}")
        await asyncio.sleep(4)


async def repo_sync_loop(app: web.Application) -> None:
    """Fast-forward the install checkout; bounce this process and the open UI."""
    delay = repo_sync.startup_delay_s()
    if repo_sync.disabled():
        return
    if delay > 0:
        await asyncio.sleep(delay)
    while True:
        try:
            info = await asyncio.to_thread(repo_sync.tick)
            action = info.get("action")
            if action == "pulled":
                log(
                    f"repo sync: pulled {(info.get('from') or '')[:7]}.."
                    f"{(info.get('to') or '')[:7]} ({len(info.get('files') or [])} files)"
                )
            elif action == "error":
                log(f"repo sync: {info.get('error') or 'pull failed'}")
        except Exception as e:  # noqa: BLE001
            log(f"repo sync: {e}")
        wait = repo_sync.interval_s()
        if wait <= 0:
            return
        await asyncio.sleep(wait)


async def plugin_watch_loop(app: web.Application) -> None:
    """Reload plugin Python when YAML or the service module's mtime changes."""
    while True:
        try:
            hooks.sync(plugins.scan().get("plugins") or [], allow=plugins.python_allow)
        except Exception as e:  # noqa: BLE001
            log(f"plugin watch: {e}")
        await asyncio.sleep(2.5)


async def broadcast_loop(app: web.Application) -> None:
    state: State = app["state"]
    while True:
        clients: set[web.WebSocketResponse] = app["clients"]
        if clients:
            msg = json.dumps({"type": "state", **publish_state(state)})
            await asyncio.gather(*(ws.send_str(msg) for ws in list(clients)), return_exceptions=True)
        await asyncio.sleep(1)


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    request.app["clients"].add(ws)
    log(f"client connected ({len(request.app['clients'])})")
    try:
        await ws.send_str(json.dumps({"type": "state", **publish_state(request.app["state"])}))
        async for _ in ws:
            pass
    finally:
        request.app["clients"].discard(ws)
        log(f"client disconnected ({len(request.app['clients'])})")
    return ws


async def api_session(request: web.Request) -> web.Response:
    from . import typesafe_proxy
    return web.json_response({
        "csrf": request.app.get("csrf") or "",
        "aiControl": agent.ai_control_on(),
        "pluginService": plugins.python_enabled(),
        "insecureLan": bool(request.app.get("insecure_lan")),
        "typesafeConfigured": typesafe_proxy.api_key_configured(),
    })


async def api_state(request: web.Request) -> web.Response:
    return web.json_response(publish_state(request.app["state"]))


async def api_traffic(request: web.Request) -> web.Response:
    """Captured traffic for one device (/api/traffic?ip=…), a group (`ip=@lan`, `@internet`, `@any` or a comma list)
    or one conversation (…&peer=…); `since=<t>` returns only packets newer than that time."""
    ip = request.query.get("ip", "").strip()
    if not ip:
        return web.json_response({"error": "ip parameter required"}, status=400)
    try:
        since = float(request.query.get("since", "0") or 0)
    except ValueError:
        since = 0.0
    detail = request.app["state"].traffic_detail(ip, time.time(), request.query.get("peer", "").strip(), since)
    if detail is None:
        return web.json_response({"error": "unknown device"}, status=404)
    return web.json_response(detail)


async def api_payload(request: web.Request) -> web.Response:
    """One packet's captured payload head: /api/payload?ip=…&peer=…&t=<epoch>&size=<bytes>, the values a
    trace row carries. The bytes are hex; `total` is the payload's real length when the head was truncated."""
    q = request.query
    ip, peer = q.get("ip", "").strip(), q.get("peer", "").strip()
    try:
        t, size = float(q.get("t", "")), int(q.get("size", ""))
    except ValueError:
        return web.json_response({"error": "t and size parameters required"}, status=400)
    if not ip or not peer:
        return web.json_response({"error": "ip and peer parameters required"}, status=400)
    found = request.app["state"].payload_of(ip, peer, t, size)
    if found is None:
        return web.json_response({"error": "packet no longer buffered"}, status=404)
    return web.json_response(found)


async def api_rf_watch(request: web.Request) -> web.Response:
    """GET /api/rf/watch -> the SSID watch list, the channel plan and where the monitor radio is tuned.
       PUT /api/rf/watch {"ssids": [...] | "a, b", "other": bool, "dwell": s, "rotate": bool} -> adopt it
       (the Air SSIDs plugin cog sends its config here), persist it and rewrite the hopper's plan file."""
    state: State = request.app["state"]
    if request.method == "PUT":
        try:
            body = await request.json()
        except (ValueError, UnicodeDecodeError):
            return web.json_response({"error": "JSON body required"}, status=400)
        if not isinstance(body, dict):
            return web.json_response({"error": "JSON object required"}, status=400)
        if state.radio.set_watch(body):
            log(f"wifi watch: {', '.join(state.radio.watch['ssids']) or '(none)'}"
                + (" + other networks" if state.radio.watch["other"] else "")
                + f", {state.radio.watch['dwell']} s each" + ("" if state.radio.watch["rotate"] else ", rotation off"))
        refresh_hop_plan(state)
    return web.json_response(state.radio.watch_status(time.time()))


async def api_forensics(request: web.Request) -> web.Response:
    """GET  /api/forensics?ip=…  -> the latest deep-analysis job for a device (or {"status": "none"})
       POST /api/forensics?ip=…  -> start one (returns the running job; 409 if one is already running)"""
    state: State = request.app["state"]
    ip = request.query.get("ip", "").strip()
    if not ip:
        return web.json_response({"error": "ip parameter required"}, status=400)
    ip = state.alias_to_ip.get(ip, ip)
    if request.method == "POST":
        cur = state.forensics.get(ip)
        if cur and cur["status"] == "running":
            return web.json_response(cur, status=409)
        job = state.start_analysis(ip, request.app["pool"], asyncio.get_running_loop())
        if job is None:
            return web.json_response({"error": "unknown device or multicast group"}, status=404)
        return web.json_response(job, status=202)
    job = state.forensics.get(ip)
    return web.json_response(job if job else {"ip": ip, "status": "none"})


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
    hooks.bind(lambda pid: hooks.Host(pid, state=state))
    try:
        hooks.sync(plugins.scan().get("plugins") or [], allow=plugins.python_allow)
    except Exception as e:  # noqa: BLE001
        log(f"plugin service load: {e}")
    app["tasks"] = [
        asyncio.create_task(capture_loop(state, app["bpf"], app["wifi_keys"])),
        asyncio.create_task(wifi_scan_loop(state)),
        asyncio.create_task(hop_status_loop(state)),
        asyncio.create_task(gateway_probe_loop(state)),
        asyncio.create_task(bluetooth_loop(state)),
        asyncio.create_task(discovery_loop(state, pool)),
        asyncio.create_task(cert_probe_loop(state, pool)),
        asyncio.create_task(housekeeping_loop(state)),
        asyncio.create_task(broadcast_loop(app)),
        asyncio.create_task(plugin_watch_loop(app)),
        asyncio.create_task(local_drop_watch_loop(app)),
        asyncio.create_task(sources_poll_loop(app)),
        asyncio.create_task(sdm_poll_loop(app)),
        asyncio.create_task(repo_sync_loop(app)),
    ]


async def on_shutdown(app: web.Application) -> None:
    """Runs before aiohttp waits for in-flight handlers. Open WebSockets would otherwise hold that wait
    (60 s by default) and systemd would SIGKILL us at TimeoutStopSec; close them and stop the background work."""
    log("shutting down")
    hooks.unload_all()
    for t in app["tasks"]:
        t.cancel()
    forensics.cancel_all()  # kills nmap & co. so the pool threads finish and do not block interpreter exit
    clients = list(app["clients"])
    app["clients"].clear()
    await asyncio.gather(*(ws.close(code=WSCloseCode.GOING_AWAY, message=b"server shutdown") for ws in clients),
                         return_exceptions=True)


async def on_cleanup(app: web.Application) -> None:
    for t in app["tasks"]:
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await asyncio.wait_for(t, 5)
    for j in app["state"].forensics.values():
        if j["status"] == "running":
            j.update(status="error", error="monitor stopped while the analysis was running", finished=time.time())
    app["state"].save()
    app["pool"].shutdown(wait=False, cancel_futures=True)
    await sources.close()
    await sdm.close()
    log("stopped")


def make_app(state: State, bpf: str, wifi_keys: Path = WIFI_KEYS_FILE, *, insecure_lan: bool = False) -> web.Application:
    app = web.Application(middlewares=[access.middleware], client_max_size=agent.MAX_BODY)
    app["state"], app["bpf"], app["clients"], app["wifi_keys"] = state, bpf, set(), wifi_keys
    app["csrf"] = access.new_token()
    app["insecure_lan"] = insecure_lan
    app.router.add_get("/", index)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/api/session", api_session)
    app.router.add_get("/api/logs", logbuf.api_logs)
    app.router.add_get("/api/state", api_state)
    app.router.add_get("/api/traffic", api_traffic)
    app.router.add_get("/api/payload", api_payload)
    app.router.add_get("/api/rf/watch", api_rf_watch)
    app.router.add_put("/api/rf/watch", api_rf_watch)
    app.router.add_get("/api/forensics", api_forensics)
    app.router.add_post("/api/forensics", api_forensics)
    app.router.add_get("/api/profiles", profiles.api_list)
    app.router.add_put("/api/profiles/default", profiles.api_default)
    app.router.add_post("/api/profiles/shipped", profiles.api_shipped)
    app.router.add_post("/api/profiles", profiles.api_create)
    app.router.add_get("/api/profiles/{id}", profiles.api_get)
    app.router.add_put("/api/profiles/{id}", profiles.api_put)
    app.router.add_delete("/api/profiles/{id}", profiles.api_delete)
    from . import typesafe_proxy
    app.router.add_get("/api/typesafe/status", typesafe_proxy.api_status)
    app.router.add_post("/api/typesafe/sense", typesafe_proxy.api_sense)
    app.router.add_get("/api/plugins", plugins.api_list)
    app.router.add_get("/api/plugins/{id}/module.js", plugins.api_module)
    app.router.add_get("/api/plugins/{id}/sky/fragment.glsl", plugins.api_sky)
    app.router.add_get("/api/plugins/hn-rain/still", hn_rain_stills.api_still)
    app.router.add_put("/api/plugins/{id}/consent", plugins.api_consent)
    app.router.add_get("/mcp", plugin_mcp.api_mcp)
    app.router.add_post("/mcp", plugin_mcp.api_mcp)
    app.router.add_get("/api/ai/status", agent.api_status)
    app.router.add_get("/api/ai/control", agent.api_control)
    app.router.add_put("/api/ai/control", agent.api_control)
    app.router.add_get("/api/ai/temper", agent.api_temper)
    app.router.add_put("/api/ai/temper", agent.api_temper)
    app.router.add_post("/api/ai/chat", agent.api_chat)
    app.router.add_post("/api/ai/ollama/pull", agent.api_ollama_pull)
    app.router.add_get("/api/ai/cursor", cursor_agent.api_key)
    app.router.add_put("/api/ai/cursor", cursor_agent.api_key)
    app.router.add_delete("/api/ai/cursor", cursor_agent.api_key)
    app.router.add_get("/api/ai/cursor-stats", cursor_stats.api_stats)
    app.router.add_get("/api/ai/history", agent.api_history)
    app.router.add_delete("/api/ai/history", agent.api_history)
    app.router.add_get("/api/ai/memories", agent.api_memories)
    app.router.add_post("/api/ai/memories", agent.api_memories)
    app.router.add_delete("/api/ai/memories", agent.api_memories)
    app.router.add_post("/api/ai/plugin", agent.api_draft_plugin)
    app.router.add_post("/api/ai/plugin/local", plugin_local.api_publish_local)
    app.router.add_post("/api/ai/sky", agent.api_sky)
    app.router.add_post("/api/ai/speak", agent.api_speak)
    app.router.add_delete("/api/ai/speak", agent.api_speak)
    app.router.add_get("/api/ai/assets", agent_assets.api_assets)
    app.router.add_post("/api/ai/asset", agent_assets.api_assets)
    app.router.add_delete("/api/ai/assets", agent_assets.api_assets)
    app.router.add_get("/api/ai/assets/{id}", agent_assets.api_asset)
    app.router.add_get("/api/sdm", sdm.api_sdm)
    app.router.add_post("/api/sdm", sdm.api_sdm)
    app.router.add_get("/api/sdm/devices", sdm.api_devices)
    app.router.add_post("/api/sdm/devices/{id}/webrtc", sdm.api_webrtc)
    app.router.add_get("/api/sdm/still", sdm.api_still)
    app.router.add_get("/api/sources/image", sources.api_image)
    app.router.add_get("/api/sources", sources.api_sources)
    app.router.add_put("/api/sources", sources.api_sources)
    app.router.add_post("/api/sources", sources.api_sources)
    app.router.add_put("/api/sources/{id}", sources.api_source)
    app.router.add_delete("/api/sources/{id}", sources.api_source)
    app.router.add_get("/api/plugin-instances", plugin_instances.api_instances)
    app.router.add_put("/api/plugin-instances", plugin_instances.api_instances)
    app.router.add_post("/api/plugin-instances", plugin_instances.api_instances)
    app.router.add_put("/api/plugin-instances/{plugin}/{id}", plugin_instances.api_instance)
    app.router.add_delete("/api/plugin-instances/{plugin}/{id}", plugin_instances.api_instance)
    if WEB_DIST.exists():
        app.router.add_static("/", WEB_DIST, show_index=False)
    app.on_startup.append(on_startup)
    app.on_shutdown.append(on_shutdown)
    app.on_cleanup.append(on_cleanup)
    return app


def main() -> None:
    from . import typesafe_proxy

    typesafe_proxy.load_dotenv()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--iface", action="append", metavar="IFACE",
                   help="capture only these interfaces (repeatable; default: every up interface except lo and veth*)")
    p.add_argument("--bind", default=None,
                   help="listen address (default: sys-config.yml bind, else 127.0.0.1)")
    p.add_argument("--insecure-lan", action="store_true",
                   help="allow --bind on a non-loopback address (no password; anyone who can reach the port can read captures and trigger scans)")
    p.add_argument("--port", type=int, default=None, help="listen port (default: sys-config.yml port, else 7020)")
    p.add_argument("--inhibit-screensaver", action="store_true",
                   help="hold idle/sleep so the display does not blank (also sys-config.yml inhibit_screensaver)")
    p.add_argument("-f", "--filter", default="", help="BPF capture filter, e.g. 'not port 22'")
    p.add_argument("--fresh", action="store_true", help="ignore persisted state")
    p.add_argument("--wifi-keys", type=Path, default=WIFI_KEYS_FILE, metavar="FILE",
                   help="`SSID = passphrase` per line for decrypting monitor-mode radios (default: %(default)s)")
    args = p.parse_args()
    cfg = sysconfig.ensure()
    listen = sysconfig.resolve_listen(
        cfg,
        bind=args.bind,
        port=args.port,
        insecure_lan=args.insecure_lan,
        inhibit_screensaver=args.inhibit_screensaver,
    )
    if args.bind is not None and not access.bind_is_loopback(args.bind) and not args.insecure_lan:
        sys.exit("[monitor] refusing non-loopback --bind (pass --insecure-lan or set bind in ~/.zoto-viz/sys-config.yml)")

    iface, local_ip, cidr, gw = zotoviz.default_iface()
    state = State(iface, local_ip, cidr, gw, only_ifaces=args.iface)
    if not state.ifaces:
        sys.exit(f"[monitor] no capturable interfaces" + (f" among {args.iface}" if args.iface else ""))
    if not args.fresh:
        state.load()
    log(f"primary={iface} ip={local_ip} net={cidr} gw={gw}")
    log("capturing: " + ", ".join(f"{i} [{'monitor mode' if i in state.wlan else ', '.join(c) or 'no addr'}]" for i, c in sorted(state.ifaces.items())))
    migrated = plugin_migration.migrate_home_plugins()
    if migrated.get("copied"):
        log("plugin src migrated: " + ", ".join(migrated["copied"]))
    plugins.seed()
    log(f"UI: http://{listen['bind']}:{listen['port']}/   WS: /ws   JSON: /api/state, /api/logs, /api/traffic?ip=…, /api/payload, /api/rf/watch, /api/profiles")
    if listen["insecure_lan"]:
        log("WARNING: insecure-lan: the UI is reachable beyond loopback with no password")
    hold = idle.ScreensaverHold()
    if listen["inhibit_screensaver"]:
        for line in hold.start():
            log(line)
    if plugins.python_enabled():
        log("plugin Python: enabled (ZOTO_VIZ_PLUGIN_SERVICE) — only consented plugins are loaded")
    else:
        log("plugin Python: off (set ZOTO_VIZ_PLUGIN_SERVICE=1 to load backend/service.py after source review)")
    if state.radio.watch["ssids"] or state.radio.watch["other"]:
        w = state.radio.watch
        log(f"wifi watch: {', '.join(w['ssids']) or '(none)'}" + (" + other networks" if w["other"] else "")
            + f", {w['dwell']} s each" + ("" if w["rotate"] else ", rotation off"))
    # shutdown_timeout bounds the wait for in-flight requests; the unit gives us 10 s in total
    try:
        web.run_app(
            make_app(state, args.filter, args.wifi_keys, insecure_lan=listen["insecure_lan"]),
            host=listen["bind"],
            port=listen["port"],
            print=None,
            access_log=None,
            shutdown_timeout=3,
        )
    finally:
        hold.stop()


if __name__ == "__main__":
    main()
