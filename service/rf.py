"""Air picture: 802.11 access points / stations and Bluetooth advertisers.

The IP graph stays on Ethernet/IP. This module keeps a parallel device/flow
set keyed `ap:<bssid>`, `sta:<mac>`, `bt:<addr>` so a plugin view can render
SSIDs and Bluetooth devices and `/api/traffic` can decode their frames.
"""
from __future__ import annotations

import contextlib
import json
import os
import re
import time
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any

from . import paths

zotoviz = paths.load_cli()

RECENT = 250
FLOW_PACKETS = 300
COUNTER_CAP = 400
RATE_WINDOW_S = 5
FLOW_IDLE_S = 300
DEVICE_OFFLINE_S = 600
BEACON_RECORD_S = 1.0  # at most one beacon line per AP per second in the traffic ring
ADV_RECORD_S = 1.0
BT_MAX_DEVICES = 64     # snapshot ceiling; the Bluetooth view slices further (default 32)
BT_UNNAMED_KEEP_S = 90  # random BLE addresses rotate; drop them quickly once idle

# Channel rotation. A monitor radio hears one channel, so the Wi-Fi view can name SSIDs to watch in turn: the plan
# (one line per channel a watched network is on) is written for the root hopper (systemd/zoto-viz-wifi-monitor.sh
# --hop), which retunes the radio every `dwell` seconds. Nodes on a channel the radio is not on right now are *held*:
# their rates and online state stay as last heard, and their idle clocks only run while the radio listens to them.
WATCH_FILE = paths.config_dir() / "wifi-watch.json"
PLAN_FILE = paths.config_dir() / "wifi-hop.plan"
DWELL_DEFAULT = 60
DWELL_MIN, DWELL_MAX = 10, 600
PLAN_MAX_SLOTS = 10        # a long cycle defeats the point; listed SSIDs come first and are never cut
HELD_MAX_S = 3600          # a held node / flow the radio has not heard for an hour of wall time is dropped anyway
WATCH_MAX_SSIDS = 16
SCAN_KEEP_S = 300          # an AP missing from a scan stays in the plan this long, so a weak one does not flicker it

# wlan.fc.type_subtype (type in the high nibble of the low byte when given as 0x0008)
WLAN_KIND = {
    0x00: "assoc",
    0x01: "assoc",
    0x04: "probe",
    0x05: "probe",
    0x08: "beacon",
    0x0A: "disassoc",
    0x0B: "auth",
    0x0C: "deauth",
    0x20: "data",
    0x24: "null",
    0x28: "data",
    0x2C: "qos",
}

COMPANY = {
    "004C": "Apple",
    "00E0": "Google",
    "00D2": "Google",
    "094F": "Signify",
    "097A": "Tuya",
    "0059": "Nordic",
    "0075": "Samsung",
    "0006": "Microsoft",
    "00D6": "Microsoft",
    "012D": "Sony",
    "00C4": "LG",
    "0087": "Garmin",
}


def _bt_rank_key(d: dict) -> tuple:
    """Lower is kept first: this host, then paired/connected, then named, then recently heard."""
    ports = d.get("ports") or []
    self_bit = 0 if d.get("role") == "self" else 1
    held = 0 if (d.get("role") == "gateway" or "connected" in ports or "paired" in ports) else 1
    named = 0 if d.get("hostnames") else 1
    return (self_bit, held, named, -d.get("last_seen", 0), -d.get("packets", 0))


def _mac(s: str) -> str:
    s = (s or "").strip().lower().replace("-", ":")
    if s.count(":") == 5:
        return s
    return ""


def _ssid(raw: str) -> str:
    s = (raw or "").strip()
    if not s or s.lower() in ("<missing>", "<none>", "ssid:"):
        return ""
    return s[:32]


def _ssid_field(raw: str) -> str:
    """`wlan.ssid` as tshark prints it: recent versions give the element's bytes as hex (`486f6d65` = Home), older
    ones the text. Hex that decodes to printable UTF-8 is taken as the name; anything else is used as is."""
    s = _ssid(raw)
    if len(s) >= 4 and len(s) % 2 == 0 and re.fullmatch(r"[0-9a-fA-F]+", s):
        try:
            dec = bytes.fromhex(s).decode("utf-8")
        except ValueError:
            return s
        if dec.isprintable() and dec.strip():
            return dec.strip()[:32]
    return s


_NO_BSSID = {"ff:ff:ff:ff:ff:ff", "00:00:00:00:00:00"}


def _num(raw: str) -> int | None:
    s = (raw or "").strip().split()[0] if raw else ""
    if not s:
        return None
    try:
        return int(s, 0)
    except ValueError:
        try:
            return int(float(s))
        except ValueError:
            return None


def _subtype(raw: str) -> int | None:
    s = (raw or "").strip()
    if not s:
        return None
    m = re.search(r"0x[0-9a-f]+", s, re.I)
    if m:
        return int(m.group(0), 16) & 0xFF
    n = _num(s)
    return None if n is None else n & 0xFF


def parse_nmcli_line(line: str) -> list[str]:
    """Split an `nmcli -t` row, honouring backslash-escaped colons in BSSIDs."""
    parts: list[str] = []
    cur: list[str] = []
    esc = False
    for ch in line:
        if esc:
            cur.append(ch)
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == ":":
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return parts


def read_bt_self() -> tuple[str, str]:
    """Adapter MAC and alias from hciconfig / bluetoothctl."""
    out = zotoviz.run(["hciconfig", "hci0"], quiet=True) or ""
    mac = ""
    m = re.search(r"BD Address:\s*([0-9A-Fa-f:]{17})", out)
    if m:
        mac = _mac(m.group(1))
    name = ""
    show = zotoviz.run(["bluetoothctl", "show"], quiet=True) or ""
    for line in show.splitlines():
        line = line.strip()
        if line.startswith("Name:"):
            name = line.split(":", 1)[1].strip()
        if not mac and line.startswith("Controller "):
            mac = _mac(line.split()[1])
    return mac, name


def read_wifi_link(iface: str) -> tuple[str, str, int]:
    """Associated BSSID, SSID, channel from `iw dev <iface> link` / `info`."""
    bssid, ssid, chan = "", "", 0
    out = zotoviz.run(["iw", "dev", iface, "link"], quiet=True) or ""
    for line in out.splitlines():
        line = line.strip()
        if line.lower().startswith("connected to "):
            bssid = _mac(line.split()[2])
        elif line.upper().startswith("SSID:"):
            ssid = _ssid(line.split(":", 1)[1])
        elif line.lower().startswith("freq:"):
            pass
    info = zotoviz.run(["iw", "dev", iface, "info"], quiet=True) or ""
    m = re.search(r"channel\s+(\d+)", info)
    if m:
        chan = int(m.group(1))
    if not ssid:
        m = re.search(r"ssid\s+(\S+)", info, re.I)
        if m:
            ssid = _ssid(m.group(1))
    return bssid, ssid, chan


_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_BT_DEV = re.compile(r"Device\s+([0-9A-Fa-f:]{17})\s*(.*)$")


def parse_bluetoothctl_line(line: str) -> dict[str, str] | None:
    """Pick name / RSSI / address out of a bluetoothctl scan line."""
    s = _ANSI.sub("", line).strip()
    m = _BT_DEV.search(s)
    if not m:
        return None
    addr, rest = m.group(1), (m.group(2) or "").strip()
    out: dict[str, str] = {"addr": addr}
    rssi = re.search(r"RSSI:\s*(-?\d+)", s)
    if rssi:
        out["rssi"] = rssi.group(1)
    name = rest
    for prefix in ("Name:", "Alias:", "RSSI:", "TxPower:", "Connected:", "Paired:"):
        if rest.upper().startswith(prefix.upper()):
            name = rest.split(":", 1)[1].strip() if prefix in ("Name:", "Alias:") else ""
            break
    if name and not name.startswith("RSSI") and ":" not in name[:4]:
        out["name"] = name
    if "Paired: yes" in s:
        out["paired"] = "1"
    if "Connected: yes" in s:
        out["connected"] = "1"
    return out


def nmcli_scan(rescan: bool = False) -> list[dict[str, Any]]:
    cmd = [
        "nmcli", "-t", "-f", "IN-USE,SSID,BSSID,MODE,CHAN,FREQ,SIGNAL,SECURITY",
        "device", "wifi", "list",
    ]
    cmd += ["--rescan", "yes" if rescan else "no"]
    raw = zotoviz.run(cmd, quiet=True) or ""
    rows = []
    for line in raw.splitlines():
        p = parse_nmcli_line(line)
        if len(p) < 8:
            continue
        in_use, ssid, bssid, mode, chan, freq, signal, sec = p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]
        mac = _mac(bssid)
        if not mac:
            continue
        rows.append({
            "in_use": in_use == "*",
            "ssid": _ssid(ssid),
            "bssid": mac,
            "mode": (mode or "Infra").strip(),
            "channel": _num(chan) or 0,
            "freq": _num(freq) or 0,
            "signal": _num(signal) or 0,
            "security": (sec or "").strip(),
        })
    return rows


def freq_to_chan(freq: int) -> int:
    if 2412 <= freq <= 2472:
        return (freq - 2407) // 5
    if freq == 2484:
        return 14
    if 5000 < freq < 5925:
        return (freq - 5000) // 5
    if 5925 <= freq <= 7125:
        return (freq - 5950) // 5
    return 0


def _seg_freq(seg: int, freq: int) -> int:
    """Centre frequency of a VHT/HE channel segment index, on the band `freq` is in."""
    if not seg:
        return 0
    return 5950 + 5 * seg if freq >= 5925 else 5000 + 5 * seg


def guess_width(freq: int) -> tuple[int, int]:
    """(width, centre) to assume when the scan carries no operation element: 5 GHz access points are almost all
    80 MHz wide on the standard blocks (36–48 → 42, 52–64 → 58, 100–112 → 106, …, 149–161 → 155), and an
    80 MHz monitor radio still hears the narrow frames on its primary channel; elsewhere 20 MHz."""
    ch = freq_to_chan(freq)
    if 5000 < freq < 5925 and 36 <= ch <= 161:
        base = 36 if ch < 100 else 100 if ch < 149 else 149
        first = base + ((ch - base) // 16) * 16
        if first + 12 <= 161:  # a full block of four 20 MHz channels
            return 80, 5000 + 5 * (first + 6)
    return 20, freq


def parse_iw_scan(text: str) -> dict[str, dict[str, Any]]:
    """`iw dev <if> scan dump` → bssid → {ssid, freq, signal, width, center}. nmcli gives no channel width; a radio
    parked at 20 MHz on an 80 MHz BSS misses every wide data frame, so the width and centre come from the
    HT / VHT operation elements here."""
    out: dict[str, dict[str, Any]] = {}
    cur: dict[str, Any] | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if raw.startswith("BSS "):
            mac = _mac(line.split()[1].split("(")[0])
            cur = out[mac] = {"ssid": "", "freq": 0, "signal": 0, "width": 20, "center": 0} if mac else None
            continue
        if cur is None:
            continue
        if line.startswith("freq:"):
            cur["freq"] = _num(line.split(":", 1)[1]) or 0
        elif line.startswith("signal:"):
            cur["signal"] = _num(line.split(":", 1)[1]) or 0
        elif line.startswith("SSID:"):
            cur["ssid"] = _ssid(line.split(":", 1)[1])
        elif line.startswith("* secondary channel offset:"):
            off = line.split(":", 1)[1].strip()
            if off in ("above", "below") and cur["width"] < 40:
                cur["width"] = 40
                cur["center"] = cur["freq"] + (10 if off == "above" else -10)
        elif line.startswith("* channel width:"):
            m = re.search(r"\((\d+)\s*MHz\)", line)
            w = int(m.group(1)) if m else 0
            if w >= 80:
                cur["width"] = max(cur["width"], w)
        elif line.startswith("* center freq segment 1:"):
            seg = _num(line.split(":", 1)[1]) or 0
            if seg and cur["width"] >= 80:
                cur["center"] = _seg_freq(seg, cur["freq"])
    for d in out.values():
        if not d["center"]:
            d["center"] = d["freq"]
    return out


def iw_scan_dump(iface: str) -> dict[str, dict[str, Any]]:
    """Cached scan results of the managed radio (no rescan; unprivileged)."""
    if not iface:
        return {}
    return parse_iw_scan(zotoviz.run(["iw", "dev", iface, "scan", "dump"], quiet=True, check=False) or "")


def read_monitor_channel(iface: str) -> tuple[int, int, int]:
    """(channel, MHz, width) the radio is tuned to, from `iw dev <iface> info`; zeros when it is not up."""
    if not iface:
        return 0, 0, 0
    out = zotoviz.run(["iw", "dev", iface, "info"], quiet=True, check=False) or ""
    m = re.search(r"channel\s+(\d+)\s*\((\d+)\s*MHz\)(?:,\s*width:\s*(\d+))?", out)
    if not m:
        return 0, 0, 0
    return int(m.group(1)), int(m.group(2)), int(m.group(3) or 20)


def normalise_watch(cfg: dict[str, Any] | None) -> dict[str, Any]:
    """Watch-list config as the plugin sends it (strings from the cog) or as stored on disk, made well-typed."""
    cfg = cfg or {}
    raw = cfg.get("ssids", [])
    if isinstance(raw, str):
        raw = raw.split(",")
    ssids: list[str] = []
    for s in raw:
        s = _ssid(str(s))
        if s and s not in ssids:
            ssids.append(s)
    dwell = _num(str(cfg.get("dwell", DWELL_DEFAULT))) or DWELL_DEFAULT
    truthy = lambda v: v is True or str(v).strip().lower() in ("1", "true", "yes", "on")  # noqa: E731
    return {
        "ssids": ssids[:WATCH_MAX_SSIDS],
        "other": truthy(cfg.get("other", False)),
        "dwell": max(DWELL_MIN, min(DWELL_MAX, dwell)),
        "rotate": truthy(cfg.get("rotate", True)),
    }


class Radio:
    """Parallel RF graph: APs, stations, Bluetooth devices, and their packet rings."""

    def __init__(self) -> None:
        self.aps: dict[str, dict] = {}
        self.stas: dict[str, dict] = {}
        self.bts: dict[str, dict] = {}
        self.flows: dict[str, dict] = {}
        self._flow_buckets: dict[str, dict[int, int]] = defaultdict(dict)
        self._flow_ab: dict[str, dict[int, int]] = defaultdict(dict)
        self._flow_ba: dict[str, dict[int, int]] = defaultdict(dict)
        self.recent: dict[str, deque] = defaultdict(lambda: deque(maxlen=RECENT))
        self.recent_flow: dict[str, deque] = defaultdict(lambda: deque(maxlen=FLOW_PACKETS))
        self.traffic: dict[str, dict[str, Counter]] = defaultdict(
            lambda: {"protos": Counter(), "ports": Counter(), "queries": Counter(), "sni": Counter(), "peers": Counter()})
        self._beacon_at: dict[str, float] = {}
        self._adv_at: dict[str, float] = {}
        self.assoc_bssid = ""
        self.assoc_ssid = ""
        self.assoc_chan = 0
        self.self_wifi = ""
        self.self_bt = ""
        self.bt_name = ""
        # channel rotation (see module docstring): what to watch, the plan built from scans, what is tuned now
        self.watch: dict[str, Any] = normalise_watch(None)
        self.plan: list[dict[str, Any]] = []
        self.mon_iface = ""
        self.tuned_chan = 0
        self.tuned_freq = 0
        self.tuned_width = 0
        self.tuned_at = 0.0
        self.hops = 0                 # channel changes seen on the monitor radio: proof the hopper is running
        self.home_left_at = 0.0       # when the radio last left the associated network's channel (0 = at home)
        self._scan_rows: list[dict[str, Any]] = []
        self._scan_seen: dict[str, tuple[dict[str, Any], float]] = {}
        self._scan_ext: dict[str, dict[str, Any]] = {}
        self._plan_text: str | None = None
        self._tick_at = 0.0

    # ---- identity
    def set_wifi_self(self, mac: str, bssid: str, ssid: str, channel: int) -> None:
        self.self_wifi = _mac(mac)
        self.assoc_bssid = _mac(bssid)
        self.assoc_ssid = _ssid(ssid)
        self.assoc_chan = channel
        if self.self_wifi:
            d = self._sta(self.self_wifi)
            d["role"] = "self"
            if self.assoc_ssid:
                self._name(d["ip"], self.assoc_ssid)
                d["ssid"] = self.assoc_ssid
            if channel:
                d["chan"] = channel

    def set_bt_self(self, mac: str, name: str = "") -> None:
        self.self_bt = _mac(mac)
        self.bt_name = name or "this host"
        if self.self_bt:
            d = self._bt(self.self_bt)
            d["role"] = "self"
            self._name(d["ip"], self.bt_name)

    def ids(self) -> set[str]:
        return set(self.aps) | set(self.stas) | set(self.bts)

    def known(self, ip: str) -> bool:
        return ip in self.aps or ip in self.stas or ip in self.bts

    def expand(self, token: str) -> list[str]:
        if token == "@wifi":
            return list(self.aps) + list(self.stas)
        if token in ("@bluetooth", "@bt"):
            return list(self.bts)
        if token in ("@air", "@rf"):
            return list(self.ids())
        return [token] if self.known(token) else []

    # ---- builders
    def _ap(self, bssid: str) -> dict:
        ip = f"ap:{bssid}"
        d = self.aps.get(ip)
        if d is None:
            d = self.aps[ip] = self._blank(ip, bssid, "lan")
        return d

    def _sta(self, mac: str) -> dict:
        ip = f"sta:{mac}"
        d = self.stas.get(ip)
        if d is None:
            d = self.stas[ip] = self._blank(ip, mac, "lan")
        return d

    def _bt(self, addr: str) -> dict:
        ip = f"bt:{addr}"
        d = self.bts.get(ip)
        if d is None:
            d = self.bts[ip] = self._blank(ip, addr, "lan")
        return d

    def _blank(self, ip: str, mac: str, role: str) -> dict:
        now = time.time()
        vendor = zotoviz.vendor_for(mac) if mac else ""
        return {
            "ip": ip, "mac": mac, "vendor": vendor, "hostnames": [], "aliases": [], "sources": [],
            "ports": [], "ifaces": [], "first_seen": now, "last_seen": now,
            "bytes_in": 0, "bytes_out": 0, "packets": 0, "role": role,
            # network / channel this node lives on (APs: theirs; stations: the AP they talk to) and its idle clock,
            # which only runs while the monitor radio is on that channel (see tick)
            "ssid": "", "chan": 0, "idle_s": 0.0,
        }

    def _name(self, ip: str, name: str, source: str = "") -> None:
        name = (name or "").strip()
        if not name or name == ip:
            return
        d = self.aps.get(ip) or self.stas.get(ip) or self.bts.get(ip)
        if not d:
            return
        if name not in d["hostnames"]:
            d["hostnames"].append(name)
        if source and source not in d["sources"]:
            d["sources"].append(source)

    def _port(self, d: dict, tag: str) -> None:
        if tag and tag not in d["ports"]:
            d["ports"].append(tag)
            if len(d["ports"]) > 16:
                d["ports"] = d["ports"][:16]

    def _role_ap(self, d: dict, ssid: str) -> None:
        if d["mac"] == self.assoc_bssid or (ssid and ssid == self.assoc_ssid and d["mac"] == self.assoc_bssid):
            d["role"] = "gateway"
        elif ssid and ssid == self.assoc_ssid:
            d["role"] = "lan"
        elif ssid:
            d["role"] = "internet"
        else:
            d["role"] = "lan"

    def _flow(self, a: str, b: str, t: float, size: int, iface: str, proto: str, tag: str,
              src: str, info: str, q: str = "", s_: str = "") -> None:
        if not a or not b or a == b:
            return
        x, y = sorted((a, b))
        key = f"{x}|{y}"
        fl = self.flows.get(key)
        if fl is None:
            fl = self.flows[key] = {
                "a": x, "b": y, "bytes": 0, "packets": 0, "ports": [], "protos": [], "ifaces": [],
                "first_seen": t, "last_seen": t, "rate": 0.0, "rate_ab": 0.0, "rate_ba": 0.0,
            }
        if iface and iface not in fl["ifaces"]:
            fl["ifaces"].append(iface)
        fl["bytes"] += size
        fl["packets"] += 1
        fl["last_seen"] = t
        sec = int(t)
        self._flow_buckets[key][sec] = self._flow_buckets[key].get(sec, 0) + size
        side = self._flow_ab[key] if src == x else self._flow_ba[key]
        side[sec] = side.get(sec, 0) + size
        if tag and tag not in fl["ports"]:
            fl["ports"].append(tag)
            if len(fl["ports"]) > 12:
                fl["ports"].pop(0)
        if proto and proto not in fl["protos"]:
            fl["protos"].append(proto)
            if len(fl["protos"]) > 8:
                fl["protos"].pop(0)
        info = (info or "")[:300]
        self.recent_flow[key].append([round(t, 3), src, proto, tag, size, iface, info, q, s_, ""])

    def _note(self, ip: str, direction: str, peer: str, proto: str, tag: str, size: int,
              iface: str, info: str, t: float, q: str = "", s_: str = "") -> None:
        self.recent[ip].append([round(t, 3), direction, peer, proto, tag, size, iface, info[:300], ""])
        c = self.traffic[ip]
        if proto:
            c["protos"][proto] += 1
        if tag:
            c["ports"][tag] += 1
        c["peers"][peer] += size
        if direction == "out":
            if q:
                c["queries"][q] += 1
            if s_:
                c["sni"][s_] += 1
        for k, cnt in c.items():
            if len(cnt) > COUNTER_CAP:
                c[k] = Counter(dict(cnt.most_common(COUNTER_CAP // 2)))

    # ---- 802.11
    def ingest_scan_row(self, row: dict[str, Any], iface: str = "") -> None:
        bssid = row["bssid"]
        d = self._ap(bssid)
        now = time.time()
        d["last_seen"] = now
        ssid = row.get("ssid") or ""
        if ssid:
            self._name(d["ip"], ssid, "scan")
            d["ssid"] = ssid
        if row.get("channel"):
            d["chan"] = row["channel"]
        self._role_ap(d, ssid)
        if row.get("in_use"):
            d["role"] = "gateway"
            self.assoc_bssid = bssid
            if ssid:
                self.assoc_ssid = ssid
        if iface and iface not in d["ifaces"]:
            d["ifaces"].append(iface)
        ch = row.get("channel") or 0
        if ch:
            self._port(d, f"ch{ch}")
        sec = row.get("security") or ""
        if sec:
            self._port(d, sec.split()[0].lower())
        mode = (row.get("mode") or "").lower()
        if "mesh" in mode:
            self._port(d, "mesh")
        sig = row.get("signal")
        if isinstance(sig, int) and sig:
            d["aliases"] = [a for a in d["aliases"] if not a.endswith("%")] + [f"{sig}%"]

    def wlan_frame(self, t: float, size: int, iface: str, sa: str, da: str, bssid: str,
                   ssid: str, subtype_raw: str, signal: str, channel: str, proto: str, info: str) -> None:
        sa, da, bssid = _mac(sa), _mac(da), _mac(bssid)
        if bssid in _NO_BSSID:
            bssid = ""  # wildcard / broadcast BSSID: not an access point
        ssid = _ssid_field(ssid)
        kind = WLAN_KIND.get(_subtype(subtype_raw) or -1, "")
        if not kind:
            p = (proto or "").lower()
            inf = (info or "").lower()
            if "beacon" in p or "beacon" in inf:
                kind = "beacon"
            elif "probe" in p or "probe" in inf:
                kind = "probe"
            elif "qos" in p or p in ("data", "802.11"):
                kind = "data"
            else:
                kind = "wlan"
        sig = _num(signal)
        chan = _num(channel) or self.assoc_chan
        tag = f"wlan/{kind}"
        proto = proto or "802.11"

        ap_mac = bssid or (sa if kind in ("beacon", "probe") and da.startswith("ff:ff:ff") else "")
        if kind in ("beacon", "probe") and not ap_mac and sa:
            # probe response / beacon: transmitter is the AP
            if kind == "beacon" or "response" in (info or "").lower():
                ap_mac = sa
        if kind == "probe" and "request" in (info or "").lower():
            ap_mac = bssid  # may be empty (wildcard)
            if sa:
                st = self._sta(sa)
                st["last_seen"] = t
                st["packets"] += 1
                if iface and iface not in st["ifaces"]:
                    st["ifaces"].append(iface)
                if ssid:
                    self._name(st["ip"], ssid, "probe")
                    self._port(st, tag)
                headline = f"probe {(ssid or '*')}" + (f" {sig} dBm" if sig is not None else "")
                peer = f"ap:{ap_mac}" if ap_mac else "ap:*"
                self._note(st["ip"], "out", peer, proto, tag, size, iface, headline or info, t, q=ssid)
                if ap_mac:
                    self._note(f"ap:{ap_mac}", "in", st["ip"], proto, tag, size, iface, headline or info, t)
                    self._flow(st["ip"], f"ap:{ap_mac}", t, size, iface, proto, tag, st["ip"], headline)
                return

        if ap_mac:
            ap = self._ap(ap_mac)
            ap["last_seen"] = t
            ap["packets"] += 1
            if kind == "data":
                ap["bytes_in"] += size
            if iface and iface not in ap["ifaces"]:
                ap["ifaces"].append(iface)
            if ssid:
                self._name(ap["ip"], ssid, "beacon" if kind == "beacon" else "wlan")
                ap["ssid"] = ssid
            self._role_ap(ap, ssid or (ap["hostnames"][0] if ap["hostnames"] else ""))
            if chan:
                ap["chan"] = chan
                self._port(ap, f"ch{chan}")
            self._port(ap, tag)
            if sig is not None and kind == "beacon":
                # keep a live RSSI hint in aliases so the UI can show it without a new field
                hint = f"{sig} dBm"
                ap["aliases"] = [a for a in ap["aliases"] if not a.endswith(" dBm")] + [hint]

        sta_mac = ""
        if sa and sa != ap_mac and not sa.startswith(("ff:ff:ff", "01:00:5e", "33:33")):
            sta_mac = sa
        if sta_mac:
            st = self._sta(sta_mac)
            st["last_seen"] = t
            st["packets"] += 1
            if kind == "data":
                st["bytes_out"] += size
            if iface and iface not in st["ifaces"]:
                st["ifaces"].append(iface)
            self._port(st, tag)
            if chan:
                st["chan"] = chan
            if self.self_wifi and sta_mac == self.self_wifi:
                st["role"] = "self"
            if ap_mac:
                ap_ssid = self.aps[f"ap:{ap_mac}"].get("ssid") or ssid
                if ap_ssid:
                    st["ssid"] = ap_ssid
                self._flow(st["ip"], f"ap:{ap_mac}", t, size, iface, proto, tag, st["ip"], info, q=ssid)

        if kind == "beacon" and ap_mac:
            last = self._beacon_at.get(ap_mac, 0)
            if t - last < BEACON_RECORD_S:
                return
            self._beacon_at[ap_mac] = t
            headline = f"beacon {ssid or '(hidden)'}"
            if chan:
                headline += f" ch{chan}"
            if sig is not None:
                headline += f" {sig} dBm"
            self._note(f"ap:{ap_mac}", "out", "ff:ff:ff:ff:ff:ff", proto, tag, size, iface, headline, t, q=ssid)
            return

        if ap_mac and sta_mac:
            headline = info or f"{kind} {ssid}".strip()
            self._note(f"ap:{ap_mac}", "in" if kind == "data" else "out", f"sta:{sta_mac}", proto, tag, size, iface, headline, t)
            self._note(f"sta:{sta_mac}", "out" if kind == "data" else "in", f"ap:{ap_mac}", proto, tag, size, iface, headline, t)

    # ---- Bluetooth
    def bt_frame(self, t: float, size: int, iface: str, addr: str, name: str, uuids: str,
                 company: str, txpower: str, proto: str, info: str, rssi: str = "") -> None:
        addr = _mac(addr)
        if not addr:
            return
        d = self._bt(addr)
        d["last_seen"] = t
        d["packets"] += 1
        d["bytes_in"] += max(size, 0)
        if iface and iface not in d["ifaces"]:
            d["ifaces"].append(iface)
        name = (name or "").strip()
        if name and not re.fullmatch(r"[0-9A-F-]{14,}", name, re.I):
            self._name(d["ip"], name, "bt")
        for u in (uuids or "").replace(",", " ").split():
            u = u.strip().lower()
            if u:
                self._port(d, f"uuid/{u[-4:] if len(u) > 4 else u}")
        cid = (company or "").strip().upper().replace("0X", "")
        if cid:
            pretty = COMPANY.get(cid) or COMPANY.get(cid.lstrip("0") or cid)
            if pretty:
                d["vendor"] = d["vendor"] or pretty
                self._name(d["ip"], pretty, "bt")
            self._port(d, f"mfr/{cid[-4:]}")
        if self.self_bt and addr == self.self_bt:
            d["role"] = "self"
        tag = "btle/adv"
        proto = proto or "BTLE"
        rssi_n = _num(rssi)
        headline = name or (info or "advertisement")
        if rssi_n is not None:
            headline = f"{headline} {rssi_n} dBm"
            d["aliases"] = [a for a in d["aliases"] if not a.endswith(" dBm")] + [f"{rssi_n} dBm"]
        last = self._adv_at.get(addr, 0)
        if t - last < ADV_RECORD_S and "connect" not in (info or "").lower():
            return
        self._adv_at[addr] = t
        peer = f"bt:{self.self_bt}" if self.self_bt else "bt:adapter"
        self._note(d["ip"], "out", peer, proto, tag, size, iface, headline[:300], t, q=name)
        if self.self_bt and addr != self.self_bt:
            self._note(f"bt:{self.self_bt}", "in", d["ip"], proto, tag, size, iface, headline[:300], t)
            self._flow(d["ip"], f"bt:{self.self_bt}", t, size, iface, proto, tag, d["ip"], headline)

    def bt_named(self, addr: str, name: str, paired: bool = False, connected: bool = False) -> None:
        addr = _mac(addr)
        if not addr:
            return
        d = self._bt(addr)
        d["last_seen"] = time.time()
        if name:
            self._name(d["ip"], name, "scan")
        if paired:
            self._port(d, "paired")
        if connected:
            self._port(d, "connected")
            d["role"] = "gateway" if d["role"] != "self" else "self"

    # ---- channel rotation
    def load_watch(self, path: Path = WATCH_FILE) -> None:
        try:
            self.watch = normalise_watch(json.loads(path.read_text()))
        except (OSError, ValueError):
            self.watch = normalise_watch(None)
        if not self.watch["ssids"]:
            from . import sysconfig
            ssids = sysconfig.load().get("ssids") or []
            if ssids:
                self.set_watch({**self.watch, "ssids": ssids}, path)

    def set_watch(self, cfg: dict[str, Any] | None, path: Path | None = WATCH_FILE) -> bool:
        """Adopt a watch-list config (from the plugin cog or disk). Returns True when it changed."""
        new = normalise_watch(cfg)
        changed = new != self.watch
        self.watch = new
        if changed and path is not None:
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(new, indent=1) + "\n")
            except OSError:
                pass
        return changed

    def set_scan(self, rows: list[dict[str, Any]], ext: dict[str, dict[str, Any]] | None = None,
                 now: float | None = None) -> None:
        """Remember the latest scan (nmcli rows, `iw scan dump` widths) for plan building. Rows are kept per BSSID
        for SCAN_KEEP_S after they were last seen, so the plan does not churn when a weak AP drops out of one scan."""
        now = time.time() if now is None else now
        for row in rows:
            self._scan_seen[row["bssid"]] = (row, now)
        self._scan_rows = [r for r, t in self._scan_seen.values() if now - t < SCAN_KEEP_S]
        if ext:
            self._scan_ext.update(ext)  # the kernel's BSS cache is short-lived; keep widths we learnt earlier

    def set_tuned(self, chan: int, freq: int, width: int, now: float, iface: str = "") -> bool:
        """Note where the monitor radio is. Returns True on a channel change."""
        if iface:
            self.mon_iface = iface
        if chan == self.tuned_chan and freq == self.tuned_freq:
            self.tuned_width = width
            return False
        if self.tuned_chan and chan:
            self.hops += 1
        self.tuned_chan, self.tuned_freq, self.tuned_width, self.tuned_at = chan, freq, width, now
        if chan and self.assoc_chan and chan != self.assoc_chan:
            self.home_left_at = self.home_left_at or now
        else:
            self.home_left_at = 0.0
        return True

    @property
    def away(self) -> bool:
        """The radio is on a channel other than the associated network's, so this host's own network is unheard."""
        return bool(self.tuned_chan and self.assoc_chan and self.tuned_chan != self.assoc_chan)

    def build_plan(self) -> list[dict[str, Any]]:
        """Channels the radio should cycle through: every channel a watched SSID was heard on, in watch-list order
        then by frequency (a stable order: signal strength wobbles between scans and a reordered plan would restart
        the hopper's cycle); with `other`, every remaining network after them, strongest first up to the cap.
        Networks sharing a channel share its slot. Empty when rotation is off or nothing is watched."""
        cfg = self.watch
        want = cfg["ssids"]
        if not cfg["rotate"] or not (want or cfg["other"]):
            return []
        slots: dict[int, dict[str, Any]] = {}
        for row in self._scan_rows:
            ssid, freq = row.get("ssid") or "", row.get("freq") or 0
            if not ssid or not freq:
                continue
            listed = ssid in want
            if not listed and not cfg["other"]:
                continue
            rank = want.index(ssid) if listed else len(want)
            ext = self._scan_ext.get(row["bssid"])
            width, center = (int(ext["width"]), int(ext["center"] or freq)) if ext else guess_width(freq)
            s = slots.get(freq)
            if s is None:
                s = slots[freq] = {"freq": freq, "chan": row.get("channel") or freq_to_chan(freq), "width": width,
                                   "center": center, "signal": row.get("signal") or 0, "ssids": [], "rank": rank}
            else:
                if width > s["width"]:  # a 20 MHz radio on an 80 MHz BSS misses the wide data frames
                    s["width"], s["center"] = width, center
                s["signal"] = max(s["signal"], row.get("signal") or 0)
                s["rank"] = min(s["rank"], rank)
            if ssid not in s["ssids"]:
                s["ssids"].append(ssid)
        listed = sorted((s for s in slots.values() if s["rank"] < len(want)), key=lambda s: (s["rank"], s["freq"]))
        others = sorted((s for s in slots.values() if s["rank"] >= len(want)), key=lambda s: (-s["signal"], s["freq"]))
        others = sorted(others[:max(0, PLAN_MAX_SLOTS - len(listed))], key=lambda s: s["freq"])
        out = listed[:PLAN_MAX_SLOTS] + others
        for s in out:
            s["ssids"].sort(key=lambda x: (want.index(x) if x in want else len(want), x))
            s["dwell"] = cfg["dwell"]
        return out

    def plan_text(self) -> str:
        if not self.plan:
            return ""
        lines = [
            "# zoto-viz Wi-Fi hop plan: written by the monitor from the Air SSIDs watch list, read by",
            "# systemd/zoto-viz-wifi-monitor.sh --hop (root), which tunes the monitor radio to each line in turn.",
            "# freq_MHz width_MHz centre_MHz dwell_s ssids",
        ]
        for s in self.plan:
            lines.append(f"{s['freq']} {s['width']} {s['center']} {s['dwell']} {','.join(s['ssids'])}")
        return "\n".join(lines) + "\n"

    def refresh_plan(self, path: Path | None = PLAN_FILE) -> bool:
        """Rebuild the plan from the latest scan and (re)write the plan file when it changed. An empty plan removes
        the file, which sends the hopper back to the primary link's channel. Returns True when the file changed."""
        self.plan = self.build_plan()
        text = self.plan_text()
        first = self._plan_text is None
        if text == self._plan_text:
            return False
        self._plan_text = text
        if first and not text:
            # nothing to hop through and nothing announced yet: only make sure no stale file from an earlier run remains
            if path is not None:
                with contextlib.suppress(OSError):
                    path.unlink(missing_ok=True)
            return False
        if path is None:
            return True
        try:
            if not text:
                path.unlink(missing_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix(".tmp")
                tmp.write_text(text)
                os.replace(tmp, path)
        except OSError:
            return False
        return True

    def watch_status(self, now: float) -> dict[str, Any]:
        """What the UI shows in the legend: the list, the plan, what is tuned now and what comes next."""
        idx = next((i for i, s in enumerate(self.plan) if s["freq"] == self.tuned_freq or s["chan"] == self.tuned_chan), -1)
        cur = self.plan[idx] if idx >= 0 else None
        nxt = self.plan[(idx + 1) % len(self.plan)] if len(self.plan) > 1 and idx >= 0 else None
        return {
            **self.watch,
            "iface": self.mon_iface,
            "tuned": self.tuned_chan,
            "freq": self.tuned_freq,
            "width": self.tuned_width,
            "since": self.tuned_at,
            "hops": self.hops,
            "home": self.assoc_chan,
            "slot": cur["ssids"] if cur else [],
            "next": {"chan": nxt["chan"], "ssids": nxt["ssids"]} if nxt else None,
            "plan": [{"chan": s["chan"], "freq": s["freq"], "width": s["width"], "ssids": s["ssids"]} for s in self.plan],
        }

    def _held(self, d: dict) -> bool:
        """The radio is not listening to this node's channel right now, so its state is as last heard. This host
        itself is never held: its own radio keeps reporting it."""
        ch = d.get("chan") or 0
        return bool(ch and self.tuned_chan and ch != self.tuned_chan and d.get("role") != "self")

    def _flow_held(self, fl: dict) -> bool:
        for end in (fl["a"], fl["b"]):
            d = self.aps.get(end) or self.stas.get(end)
            if d is not None:
                return self._held(d)
        return False

    # ---- snapshot / housekeeping
    def tick(self, now: float) -> None:
        dt = min(5.0, max(0.0, now - self._tick_at)) if self._tick_at else 1.0
        self._tick_at = now
        cutoff = int(now) - RATE_WINDOW_S
        for key, fl in list(self.flows.items()):
            if self._flow_held(fl):
                # held: rates stay as last heard; only an hour of silence removes it
                if now - fl["last_seen"] > HELD_MAX_S:
                    self._drop_flow(key)
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
            # idle time counts only while the radio can hear the flow's channel
            fl["idle_s"] = 0.0 if fl["last_seen"] > fl.get("seen_mark", 0.0) else fl.get("idle_s", 0.0) + dt
            fl["seen_mark"] = fl["last_seen"]
            if fl["idle_s"] > FLOW_IDLE_S:
                self._drop_flow(key)
        for d in list(self.aps.values()) + list(self.stas.values()) + list(self.bts.values()):
            if d["last_seen"] > d.get("seen_mark", 0.0):
                d["idle_s"] = 0.0
                d["seen_mark"] = d["last_seen"]
            elif not self._held(d):
                d["idle_s"] = d.get("idle_s", 0.0) + dt
        self._prune_bts(now)

    def _drop_flow(self, key: str) -> None:
        self.flows.pop(key, None)
        self._flow_buckets.pop(key, None)
        self._flow_ab.pop(key, None)
        self._flow_ba.pop(key, None)
        self.recent_flow.pop(key, None)

    def _drop_bt(self, ip: str) -> None:
        d = self.bts.pop(ip, None)
        if d is None:
            return
        addr = d.get("mac") or ip.removeprefix("bt:")
        self._adv_at.pop(addr, None)
        for key, fl in list(self.flows.items()):
            if fl["a"] == ip or fl["b"] == ip:
                self._drop_flow(key)

    def _bt_keep_s(self, d: dict) -> float:
        ports = d.get("ports") or []
        if d.get("role") == "self" or "connected" in ports or "paired" in ports:
            return HELD_MAX_S
        if d.get("hostnames"):
            return DEVICE_OFFLINE_S
        return BT_UNNAMED_KEEP_S

    def _prune_bts(self, now: float) -> None:
        for ip, d in list(self.bts.items()):
            silent = max(d.get("idle_s", 0.0), now - d.get("last_seen", now))
            if silent > self._bt_keep_s(d):
                self._drop_bt(ip)
        if len(self.bts) <= BT_MAX_DEVICES:
            return
        ranked = sorted(self.bts.values(), key=_bt_rank_key)
        for d in ranked[BT_MAX_DEVICES:]:
            if d.get("role") == "self":
                continue
            self._drop_bt(d["ip"])

    def _snap_dev(self, d: dict, now: float) -> dict:
        dd = dict(d)
        held = self._held(d)
        # online: idle for less than the offline limit, counting only listened time; an hour unheard is offline anyway
        dd["online"] = bool(d["last_seen"]) and d.get("idle_s", 0.0) < DEVICE_OFFLINE_S and not (
            held and now - d["last_seen"] > HELD_MAX_S)
        dd["held"] = held
        dd["names"] = list(d.get("hostnames") or [])
        dd["ttl"] = None
        dd["analysis"] = None
        dd.pop("seen_mark", None)
        return dd

    def views(self, now: float) -> dict[str, Any]:
        self._prune_bts(now)
        wifi_devs = [self._snap_dev(d, now) for d in list(self.aps.values()) + list(self.stas.values())]
        bt_devs = [self._snap_dev(d, now) for d in self.bts.values()]
        wifi_ids = {d["ip"] for d in wifi_devs}
        bt_ids = {d["ip"] for d in bt_devs}
        wifi_flows = [f for f in self.flows.values() if f["a"] in wifi_ids and f["b"] in wifi_ids]
        bt_flows = [f for f in self.flows.values() if f["a"] in bt_ids and f["b"] in bt_ids]
        wifi_hub = f"ap:{self.assoc_bssid}" if self.assoc_bssid and f"ap:{self.assoc_bssid}" in wifi_ids else (
            next((d["ip"] for d in wifi_devs if d["role"] == "gateway"), wifi_devs[0]["ip"] if wifi_devs else ""))
        wifi_self = f"sta:{self.self_wifi}" if self.self_wifi and f"sta:{self.self_wifi}" in wifi_ids else wifi_hub
        bt_self = f"bt:{self.self_bt}" if self.self_bt and f"bt:{self.self_bt}" in bt_ids else (
            next((d["ip"] for d in bt_devs if d["role"] == "self"), bt_devs[0]["ip"] if bt_devs else ""))
        return {
            "wifi": {"devices": wifi_devs, "flows": wifi_flows, "hub": wifi_hub, "self": wifi_self,
                     "watch": self.watch_status(now)},
            "bluetooth": {"devices": bt_devs, "flows": bt_flows, "hub": bt_self, "self": bt_self},
        }
