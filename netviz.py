#!/usr/bin/env python3
"""netviz: discover home-network devices, capture traffic, and draw the connection graph.

Subcommands
  discover   arp-scan + nmap ping sweep + mDNS + NetBIOS  -> data/devices.json
  capture    dumpcap/tshark on the LAN interface           -> data/capture-<ts>.pcapng
  analyse    tshark conversation/endpoint stats            -> data/flows-<ts>.json
  graph      devices + flows -> out/network.html (interactive), out/network.svg (graphviz)
  all        discover -> capture -> analyse -> graph

All external tools are invoked via subprocess so each step can also be run by hand.
"""
from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = ROOT / "out"

# --------------------------------------------------------------------------- helpers


def log(msg: str) -> None:
    print(f"[netviz] {msg}", file=sys.stderr)


def die(msg: str, code: int = 1) -> None:
    log(f"error: {msg}")
    sys.exit(code)


def run(cmd: list[str], *, check: bool = True, timeout: int | None = None, quiet: bool = False) -> str:
    if not quiet:
        log("$ " + " ".join(cmd))
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        die(f"{cmd[0]} not found on PATH")
    except subprocess.TimeoutExpired as e:
        return (e.stdout or b"").decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
    if res.returncode != 0:
        if check:
            log(res.stderr.strip())
            die(f"{cmd[0]} exited {res.returncode}")
        err = res.stderr.strip().splitlines()
        if err:
            log(f"warning: {cmd[0]} exited {res.returncode}: {err[0]}")
    return res.stdout


def need(tool: str) -> None:
    # shutil.which requires X_OK for *this* process; dumpcap is 750 root:wireshark and may not be
    # executable by a shell that predates `usermod -aG wireshark`, so also accept mere existence.
    if shutil.which(tool) is None and not any((Path(p) / tool).exists() for p in os.get_exec_path()):
        die(f"required tool '{tool}' is not installed")


_SUDO_OK: bool | None = None


def sudo_prefix() -> list[str]:
    """['sudo'] when root privileges are obtainable, else [] (with one warning)."""
    global _SUDO_OK
    if os.geteuid() == 0:
        return []
    if _SUDO_OK is None:
        cached = subprocess.run(["sudo", "-n", "true"], capture_output=True).returncode == 0
        _SUDO_OK = cached or sys.stdin.isatty()
        if not _SUDO_OK:
            log("WARNING: no sudo (no tty, no cached credentials); running privileged steps unprivileged")
    return ["sudo"] if _SUDO_OK else []


_OUI: dict[str, str] | None = None


def vendor_for(mac: str) -> str:
    """Look up the OUI vendor from nmap's or arp-scan's bundled prefix tables."""
    global _OUI
    if _OUI is None:
        _OUI = {}
        for path, sep in (("/usr/share/nmap/nmap-mac-prefixes", " "), ("/usr/share/arp-scan/ieee-oui.txt", "\t")):
            try:
                for line in Path(path).read_text(errors="replace").splitlines():
                    if not line or line.startswith("#"):
                        continue
                    prefix, _, name = line.partition(sep)
                    if len(prefix) == 6:
                        _OUI.setdefault(prefix.upper(), name.strip())
            except OSError:
                continue
    return _OUI.get(mac.replace(":", "").upper()[:6], "")


def group_active(name: str) -> bool:
    """True if the running process already carries the group (login-time membership)."""
    import grp

    try:
        return grp.getgrnam(name).gr_gid in os.getgroups()
    except KeyError:
        return False


def group_member(name: str) -> bool:
    """True if /etc/group lists the user, even if this shell predates the usermod."""
    import grp
    import pwd

    try:
        user = pwd.getpwuid(os.getuid()).pw_name
        return user in grp.getgrnam(name).gr_mem
    except KeyError:
        return False


def default_iface() -> tuple[str, str, str, str]:
    """Return (iface, local_ip, cidr, gateway) for the default route."""
    out = run(["ip", "-j", "route", "show", "default"], quiet=True)
    routes = json.loads(out or "[]")
    if not routes:
        die("no default route; are you connected?")
    iface = routes[0]["dev"]
    gw = routes[0].get("gateway", "")
    addrs = json.loads(run(["ip", "-j", "-4", "addr", "show", "dev", iface], quiet=True))
    for a in addrs:
        for ai in a.get("addr_info", []):
            if ai.get("family") == "inet":
                cidr = str(ipaddress.ip_interface(f"{ai['local']}/{ai['prefixlen']}").network)
                return iface, ai["local"], cidr, gw
    die(f"no IPv4 address on {iface}")


def latest(pattern: str) -> Path | None:
    files = sorted(DATA.glob(pattern), key=lambda p: p.stat().st_mtime)
    return files[-1] if files else None


def ts() -> str:
    return dt.datetime.now().strftime("%Y%m%d-%H%M%S")


def warn_warp() -> None:
    out = run(["ip", "-br", "link"], quiet=True)
    if "CloudflareWARP" in out and "UP" in [l.split()[1] for l in out.splitlines() if l.startswith("CloudflareWARP")]:
        log("WARNING: CloudflareWARP tunnel is up; this host's own traffic will appear as one flow to Cloudflare.")


# --------------------------------------------------------------------------- discover


def discover(args: argparse.Namespace) -> Path:
    for t in ("arp-scan", "nmap", "avahi-browse", "nbtscan", "fping"):
        need(t)
    iface, local_ip, cidr, gw = default_iface()
    log(f"interface={iface} ip={local_ip} net={cidr} gw={gw}")

    devices: dict[str, dict] = defaultdict(lambda: {"ip": "", "mac": "", "vendor": "", "hostnames": [], "sources": [], "ports": []})

    def add(ip: str, source: str, **kw) -> None:
        d = devices[ip]
        d["ip"] = ip
        if source not in d["sources"]:
            d["sources"].append(source)
        for k, v in kw.items():
            if not v:
                continue
            if k == "hostname":
                if v not in d["hostnames"]:
                    d["hostnames"].append(v)
            elif k == "ports":
                for p in v:
                    if p not in d["ports"]:
                        d["ports"].append(p)
            elif not d.get(k):
                d[k] = v

    sudo = sudo_prefix()

    # 1. arp-scan (layer 2; needs root)
    out = run(sudo + ["arp-scan", "--interface", iface, "--localnet", "--plain", "--resolve"], check=False, timeout=120) if sudo else ""
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 3 and re.match(r"^\d+\.\d+\.\d+\.\d+", parts[0]):
            ip, mac, vendor = parts[0], parts[1], "\t".join(parts[2:])
            hostname = ""
            m = re.match(r"^(\S+)\s+\((\d+\.\d+\.\d+\.\d+)\)$", ip)
            if m:
                hostname, ip = m.group(1), m.group(2)
            add(ip, "arp-scan", mac=mac.lower(), vendor=vendor.strip(), hostname=hostname)

    # 2. fping sweep (populates the kernel neighbour cache, catches hosts that ARP missed)
    run(["fping", "-a", "-q", "-g", cidr], check=False, timeout=120, quiet=True)

    # 3. nmap ping sweep with reverse DNS (root: ARP probes + MAC; non-root: ICMP/TCP probes)
    # non-root nmap can only do TCP-connect pings
    probes = ["-PR", "-PE"] if sudo else ["-PS22,80,443,8008,8009,8443,62078"]
    out = run(sudo + ["nmap", "-sn", *probes, "-R", "-oX", "-", cidr], check=False, timeout=300)
    import xml.etree.ElementTree as ET

    try:
        root = ET.fromstring(out)
        for h in root.iter("host"):
            if h.find("status") is None or h.find("status").get("state") != "up":
                continue
            ip = mac = vendor = ""
            for a in h.findall("address"):
                if a.get("addrtype") == "ipv4":
                    ip = a.get("addr")
                elif a.get("addrtype") == "mac":
                    mac, vendor = a.get("addr", "").lower(), a.get("vendor", "")
            hn = h.find("hostnames/hostname")
            if ip:
                add(ip, "nmap", mac=mac, vendor=vendor, hostname=hn.get("name") if hn is not None else "")
    except ET.ParseError:
        log("nmap produced no parseable XML")

    # 4. mDNS / Bonjour names
    out = run(["avahi-browse", "-a", "-t", "-r", "-p"], check=False, timeout=30)
    for line in out.splitlines():
        # =;iface;proto;name;type;domain;host;address;port;txt
        f = line.split(";")
        if len(f) >= 9 and f[0] == "=" and f[2] == "IPv4":
            ip, host, name, svc = f[7], f[6], f[3].replace("\\032", " "), f[4]
            add(ip, "mdns", hostname=host.rstrip("."), mdns_name=name, mdns_service=svc)

    # 5. NetBIOS names
    out = run(["nbtscan", "-q", "-s", ";", cidr], check=False, timeout=60)
    for line in out.splitlines():
        f = [x.strip() for x in line.split(";")]
        if len(f) >= 2 and re.match(r"^\d+\.\d+\.\d+\.\d+$", f[0]):
            add(f[0], "netbios", hostname=f[1], mac=f[4].lower() if len(f) > 4 and f[4] != "00:00:00:00:00:00" else "")

    # 6. kernel neighbour table: free IP->MAC for everything the sweeps touched (no root needed)
    for n in json.loads(run(["ip", "-j", "-4", "neigh", "show", "dev", iface], quiet=True) or "[]"):
        if n.get("lladdr") and n.get("state", [""])[0] not in ("FAILED", "INCOMPLETE"):
            add(n["dst"], "neigh", mac=n["lladdr"].lower())

    # 7. fill in vendors from the OUI tables for any MAC we learned without one
    for d in devices.values():
        if d["mac"] and not d["vendor"]:
            d["vendor"] = vendor_for(d["mac"])

    # 8. optional quick port/service fingerprint
    if args.ports and devices:
        targets = sorted(devices)
        scan = ["-sS"] if sudo else ["-sT"]
        out = run(sudo + ["nmap", *scan, "-F", "-T4", "--open", "-oX", "-"] + targets, check=False, timeout=900)
        try:
            root = ET.fromstring(out)
            for h in root.iter("host"):
                ip = next((a.get("addr") for a in h.findall("address") if a.get("addrtype") == "ipv4"), "")
                ports = [f"{p.get('portid')}/{p.get('protocol')}" for p in h.findall("ports/port") if p.find("state") is not None and p.find("state").get("state") == "open"]
                if ip and ports:
                    add(ip, "nmap-ports", ports=ports)
        except ET.ParseError:
            pass

    # local host + gateway annotations
    own_mac = next((l.get("address", "") for l in json.loads(run(["ip", "-j", "link", "show", iface], quiet=True) or "[]")), "")
    add(local_ip, "self", hostname=os.uname().nodename, role="self", mac=own_mac.lower(), vendor=vendor_for(own_mac))
    if gw:
        add(gw, "route", role="gateway")

    DATA.mkdir(exist_ok=True)
    result = {
        "scanned_at": dt.datetime.now().isoformat(timespec="seconds"),
        "interface": iface,
        "network": cidr,
        "local_ip": local_ip,
        "gateway": gw,
        "devices": sorted(devices.values(), key=lambda d: ipaddress.ip_address(d["ip"])),
    }
    path = DATA / "devices.json"
    path.write_text(json.dumps(result, indent=2))
    log(f"{len(result['devices'])} devices -> {path}")
    return path


# --------------------------------------------------------------------------- capture


def capture(args: argparse.Namespace) -> Path:
    need("dumpcap")
    iface, *_ = default_iface()
    warn_warp()
    DATA.mkdir(exist_ok=True)
    path = DATA / f"capture-{ts()}.pcapng"
    cmd = ["dumpcap", "-i", iface, "-a", f"duration:{args.seconds}", "-w", str(path), "-q"]
    if args.filter:
        cmd += ["-f", args.filter]
    # dumpcap is setgid-ish via capabilities + wireshark group; new group membership needs a re-login,
    # so fall back to `sg wireshark` and then to sudo.
    if os.geteuid() == 0 or group_active("wireshark"):
        full = cmd
    elif shutil.which("sg") and group_member("wireshark"):
        full = ["sg", "wireshark", "-c", " ".join(cmd)]
    else:
        full = sudo_prefix() + cmd
    log(f"capturing {args.seconds}s on {iface} -> {path}")
    res = subprocess.run(full)
    if res.returncode != 0 or not path.exists():
        die("capture failed (try: sudo -E ./netviz.py capture)")
    if os.geteuid() != 0:
        subprocess.run(sudo_prefix() + ["chown", f"{os.getuid()}:{os.getgid()}", str(path)], check=False, capture_output=True)
    return path


# --------------------------------------------------------------------------- analyse

# tshark 4.x prints human-readable sizes: "422 2,039 kB   289 20 kB   711 2,060 kB   9.14  0.97"
_SIZE = r"(\d+)\s+([\d,]+)\s+(bytes|kB|MB|GB|TB)"
_CONV_RE = re.compile(rf"^(\S+)\s+<->\s+(\S+)\s+{_SIZE}\s+{_SIZE}\s+{_SIZE}\s+([\d.]+)\s+([\d.]+)\s*$")
_UNIT = {"bytes": 1, "kB": 1000, "MB": 1_000_000, "GB": 1_000_000_000, "TB": 1_000_000_000_000}


def _size(num: str, unit: str) -> int:
    return int(num.replace(",", "")) * _UNIT[unit]


def _split_endpoint(ep: str, kind: str) -> tuple[str, str]:
    if kind not in ("tcp", "udp"):
        return ep, ""
    ip, _, port = ep.rpartition(":")
    return ip, port


def _parse_conv(text: str, kind: str) -> list[dict]:
    """Parse `tshark -z conv,<kind>` output into a list of flow dicts."""
    flows = []
    for line in text.splitlines():
        m = _CONV_RE.match(line.strip())
        if not m:
            continue
        g = m.groups()
        a_ip, a_port = _split_endpoint(g[0], kind)
        b_ip, b_port = _split_endpoint(g[1], kind)
        flows.append(
            {
                "kind": kind,
                "a": a_ip,
                "a_port": a_port,
                "b": b_ip,
                "b_port": b_port,
                "frames_b_to_a": int(g[2]),
                "bytes_b_to_a": _size(g[3], g[4]),
                "frames_a_to_b": int(g[5]),
                "bytes_a_to_b": _size(g[6], g[7]),
                "frames": int(g[8]),
                "bytes": _size(g[9], g[10]),
                "start": float(g[11]),
                "duration": float(g[12]),
            }
        )
    return flows


def analyse(args: argparse.Namespace) -> Path:
    need("tshark")
    pcap = Path(args.pcap) if args.pcap else latest("capture-*.pcapng")
    if not pcap or not pcap.exists():
        die("no capture found; run `netviz.py capture` first")
    log(f"analysing {pcap}")

    stats = {}
    for kind in ("eth", "ip", "tcp", "udp"):
        out = run(["tshark", "-r", str(pcap), "-q", "-z", f"conv,{kind}"], quiet=True)
        stats[kind] = _parse_conv(out, kind)

    # protocol hierarchy (what kinds of traffic are present)
    phs = run(["tshark", "-r", str(pcap), "-q", "-z", "io,phs"], quiet=True)

    # DNS answers and mDNS/SSDP/DHCP names seen in the capture: cheap extra hostname evidence
    names: dict[str, set[str]] = defaultdict(set)
    fields = [
        "-e", "ip.src", "-e", "dns.resp.name", "-e", "dns.a",
        "-e", "dhcp.option.hostname", "-e", "nbns.name", "-e", "ssdp.server",
    ]
    out = run(
        ["tshark", "-r", str(pcap), "-Y", "dns.a || dhcp.option.hostname || nbns.name", "-T", "fields", "-E", "separator=|", "-E", "occurrence=a"] + fields,
        check=False, quiet=True,
    )
    for line in out.splitlines():
        src, dns_names, dns_as, dhcp_host, nb_name, _ = (line.split("|") + [""] * 6)[:6]
        if dns_names and dns_as:
            for n, a in zip(dns_names.split(","), dns_as.split(",")):
                names[a].add(n)
        if dhcp_host:
            names[src.split(",")[0]].add(dhcp_host)
        if nb_name:
            names[src.split(",")[0]].add(nb_name.split("<")[0].strip())

    # TLS ClientHello SNI (QUIC's inner TLS shares these fields): the only hostname evidence left when
    # DNS runs over HTTPS (e.g. WARP)
    out = run(
        ["tshark", "-r", str(pcap), "-Y", "tls.handshake.type == 1", "-T", "fields",
         "-e", "ip.dst", "-e", "tls.handshake.extensions_server_name"],
        check=False, quiet=True,
    )
    for line in out.splitlines():
        dst, sni = (line.split("\t") + [""])[:2]
        if dst and sni:
            for n in sni.split(","):
                names[dst].add(n)

    # MAC <-> IP pairs actually observed on the wire
    out = run(["tshark", "-r", str(pcap), "-Y", "ip", "-T", "fields", "-e", "eth.src", "-e", "ip.src"], check=False, quiet=True)
    mac_ip = defaultdict(set)
    for line in out.splitlines():
        mac, ip = (line.split("\t") + [""])[:2]
        if mac and ip and "," not in ip:
            mac_ip[mac.lower()].add(ip)

    DATA.mkdir(exist_ok=True)
    path = DATA / f"flows-{pcap.stem.replace('capture-', '')}.json"
    path.write_text(
        json.dumps(
            {
                "pcap": str(pcap),
                "analysed_at": dt.datetime.now().isoformat(timespec="seconds"),
                "conversations": stats,
                "protocol_hierarchy": phs,
                "names_seen": {k: sorted(v) for k, v in names.items()},
                "mac_to_ips": {k: sorted(v) for k, v in mac_ip.items()},
            },
            indent=2,
        )
    )
    log(
        f"eth={len(stats['eth'])} ip={len(stats['ip'])} tcp={len(stats['tcp'])} udp={len(stats['udp'])} conversations, "
        f"{len(names)} endpoints named via DNS/DHCP/NBNS/SNI -> {path}"
    )
    return path


# --------------------------------------------------------------------------- graph


def _is_local(ip: str, net: ipaddress.IPv4Network | None) -> bool:
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if net and a in net:
        return True
    return a.is_private or a.is_link_local or a.is_loopback


def _label(ip: str, dev: dict | None, names: dict) -> str:
    parts = [ip]
    if dev:
        hn = dev.get("hostnames") or []
        if hn:
            parts.insert(0, hn[0])
        elif dev.get("mdns_name"):
            parts.insert(0, dev["mdns_name"])
        if dev.get("vendor"):
            parts.append(dev["vendor"])
    elif ip in names:
        parts.insert(0, names[ip][0])
    return "\n".join(parts)


def graph(args: argparse.Namespace) -> None:
    import networkx as nx

    dev_path = DATA / "devices.json"
    devices = json.loads(dev_path.read_text()) if dev_path.exists() else {"devices": [], "network": None, "local_ip": "", "gateway": ""}
    flow_path = Path(args.flows) if args.flows else latest("flows-*.json")
    flows = json.loads(flow_path.read_text()) if flow_path and flow_path.exists() else None
    if not devices["devices"] and not flows:
        die("nothing to draw; run discover and/or analyse first")

    net = ipaddress.ip_network(devices["network"]) if devices.get("network") else None
    by_ip = {d["ip"]: d for d in devices["devices"]}
    names = flows["names_seen"] if flows else {}

    # MACs seen on the wire fill gaps in discovery (and add LAN hosts discovery never saw)
    if flows:
        for mac, ips in flows["mac_to_ips"].items():
            for ip in ips:
                if not _is_local(ip, net):
                    continue
                d = by_ip.setdefault(ip, {"ip": ip, "mac": "", "vendor": "", "hostnames": [], "sources": [], "ports": []})
                if not d.get("mac"):
                    d["mac"] = mac
                if "capture" not in d["sources"]:
                    d["sources"].append("capture")
                if d["mac"] and not d.get("vendor"):
                    d["vendor"] = vendor_for(d["mac"])

    G = nx.Graph()

    def node(ip: str) -> None:
        if ip in G:
            return
        dev = by_ip.get(ip)
        local = _is_local(ip, net)
        role = (dev or {}).get("role", "")
        if ip == devices.get("gateway"):
            role = "gateway"
        elif ip == devices.get("local_ip"):
            role = "self"
        multicast = ip.startswith(("224.", "239.", "255.")) or ip.endswith(".255") or ip.startswith("ff")
        if multicast:
            group, color, shape = "multicast", "#bdbdbd", "triangle"
        elif role == "gateway":
            group, color, shape = "gateway", "#ff7043", "diamond"
        elif role == "self":
            group, color, shape = "self", "#42a5f5", "star"
        elif local:
            group, color, shape = "lan", "#66bb6a", "dot"
        else:
            group, color, shape = "internet", "#ab47bc", "square"
        title = [f"<b>{ip}</b>"]
        if dev:
            title += [f"MAC: {dev.get('mac') or '?'}", f"Vendor: {dev.get('vendor') or '?'}"]
            if dev.get("hostnames"):
                title.append("Names: " + ", ".join(dev["hostnames"]))
            if dev.get("mdns_service"):
                title.append(f"mDNS: {dev['mdns_name']} ({dev['mdns_service']})")
            if dev.get("ports"):
                title.append("Open: " + ", ".join(dev["ports"]))
            title.append("Seen by: " + ", ".join(dev.get("sources", [])))
        elif ip in names:
            title.append("Names (DNS/SNI): " + ", ".join(names[ip][:5]))
        G.add_node(ip, label=_label(ip, dev, names), group=group, color=color, shape=shape, title="<br>".join(title), local=local)

    for d in devices["devices"]:
        node(d["ip"])
    if devices.get("gateway"):
        node(devices["gateway"])

    if flows:
        # IP conversations become edges; TCP/UDP ports enrich the tooltip
        ports: dict[tuple[str, str], set[str]] = defaultdict(set)
        for kind in ("tcp", "udp"):
            for f in flows["conversations"][kind]:
                key = tuple(sorted((f["a"], f["b"])))
                svc_port = f["b_port"] if f["b_port"] and int(f["b_port"]) < int(f["a_port"] or 65535) else f["a_port"]
                if svc_port:
                    ports[key].add(f"{kind}/{svc_port}")
        for f in flows["conversations"]["ip"]:
            a, b = f["a"], f["b"]
            if a == b:
                continue
            if args.lan_only and not (_is_local(a, net) and _is_local(b, net)):
                continue
            node(a)
            node(b)
            key = tuple(sorted((a, b)))
            if G.has_edge(a, b):
                G[a][b]["bytes"] += f["bytes"]
                G[a][b]["frames"] += f["frames"]
            else:
                G.add_edge(a, b, bytes=f["bytes"], frames=f["frames"], ports=sorted(ports.get(key, [])))

    # every LAN device hangs off the gateway unless traffic to it was observed, so the topology reads as a star
    gw = devices.get("gateway")
    if gw and gw in G:
        for n, data in list(G.nodes(data=True)):
            if n != gw and data.get("group") in ("lan", "self") and not G.has_edge(n, gw):
                G.add_edge(n, gw, bytes=0, frames=0, ports=[], inferred=True)

    OUT.mkdir(exist_ok=True)

    # ---- interactive HTML (pyvis)
    from pyvis.network import Network

    nt = Network(height="100vh", width="100%", bgcolor="#111", font_color="#eee", select_menu=True, filter_menu=True)
    nt.barnes_hut(gravity=-6000, central_gravity=0.3, spring_length=180, spring_strength=0.02, damping=0.6)
    maxb = max((d["bytes"] for _, _, d in G.edges(data=True)), default=1) or 1
    for n, d in G.nodes(data=True):
        nt.add_node(n, label=d["label"], title=d["title"], color=d["color"], shape=d["shape"], group=d["group"],
                    size=28 if d["group"] in ("gateway", "self") else 18)
    for a, b, d in G.edges(data=True):
        if d.get("inferred"):
            nt.add_edge(a, b, color="#555", dashes=True, width=1, title="no traffic observed; assumed via gateway")
        else:
            w = 1 + 8 * (d["bytes"] / maxb) ** 0.5
            title = f"{d['bytes']:,} bytes, {d['frames']:,} frames"
            if d["ports"]:
                title += "<br>" + ", ".join(d["ports"][:12])
            nt.add_edge(a, b, width=w, title=title, color="#90caf9")
    html = OUT / "network.html"
    nt.write_html(str(html), notebook=False, open_browser=False)

    # ---- static SVG (graphviz)
    dot = OUT / "network.dot"
    lines = ["graph net {", '  layout=sfdp; overlap=prism; splines=true; bgcolor="#ffffff";', '  node [style=filled, fontname="Helvetica", fontsize=9];']
    shape_map = {"dot": "ellipse", "square": "box", "diamond": "diamond", "star": "doublecircle", "triangle": "triangle"}
    for n, d in G.nodes(data=True):
        lbl = d["label"].replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        lines.append(f'  "{n}" [label="{lbl}", fillcolor="{d["color"]}", shape={shape_map[d["shape"]]}];')
    for a, b, d in G.edges(data=True):
        if d.get("inferred"):
            lines.append(f'  "{a}" -- "{b}" [style=dashed, color="#999999"];')
        else:
            pw = 0.5 + 4 * (d["bytes"] / maxb) ** 0.5
            lines.append(f'  "{a}" -- "{b}" [penwidth={pw:.2f}, color="#1e88e5", tooltip="{d["bytes"]:,} bytes"];')
    lines.append("}")
    dot.write_text("\n".join(lines))
    svg = OUT / "network.svg"
    if shutil.which("dot"):
        run(["dot", "-Tsvg", str(dot), "-o", str(svg)], check=False, quiet=True)

    # ---- summary
    lan = [n for n, d in G.nodes(data=True) if d["group"] in ("lan", "self", "gateway")]
    ext = [n for n, d in G.nodes(data=True) if d["group"] == "internet"]
    log(f"graph: {len(lan)} LAN nodes, {len(ext)} internet endpoints, {G.number_of_edges()} edges")
    log(f"interactive -> {html}")
    log(f"static      -> {svg if svg.exists() else dot}")
    if flows:
        top = sorted(G.edges(data=True), key=lambda e: -e[2]["bytes"])[:10]
        log("top conversations by bytes:")
        for a, b, d in top:
            if d["bytes"]:
                log(f"  {G.nodes[a]['label'].splitlines()[0]:<28} <-> {G.nodes[b]['label'].splitlines()[0]:<28} {d['bytes']:>12,} B  {' '.join(d['ports'][:4])}")


# --------------------------------------------------------------------------- main


def main() -> None:
    p = argparse.ArgumentParser(prog="netviz", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("discover", help="enumerate devices on the LAN")
    d.add_argument("--ports", action="store_true", help="also run a fast nmap port scan on each host (slower)")
    d.set_defaults(fn=discover)

    c = sub.add_parser("capture", help="capture packets on the default interface")
    c.add_argument("-s", "--seconds", type=int, default=120)
    c.add_argument("-f", "--filter", default="", help="BPF capture filter, e.g. 'not port 22'")
    c.set_defaults(fn=capture)

    a = sub.add_parser("analyse", help="extract conversations from a pcap")
    a.add_argument("pcap", nargs="?", help="pcap/pcapng path (default: newest in data/)")
    a.set_defaults(fn=analyse)

    g = sub.add_parser("graph", help="render device/connection graph")
    g.add_argument("--flows", help="flows json (default: newest in data/)")
    g.add_argument("--lan-only", action="store_true", help="hide internet endpoints")
    g.set_defaults(fn=graph)

    al = sub.add_parser("all", help="discover -> capture -> analyse -> graph")
    al.add_argument("-s", "--seconds", type=int, default=120)
    al.add_argument("-f", "--filter", default="")
    al.add_argument("--ports", action="store_true")
    al.add_argument("--lan-only", action="store_true")

    args = p.parse_args()
    if args.cmd == "all":
        discover(args)
        pcap = capture(args)
        args.pcap = str(pcap)
        flows = analyse(args)
        args.flows = str(flows)
        graph(args)
    else:
        args.fn(args)


if __name__ == "__main__":
    main()
