"""Deep analysis of one host, run on demand from the live UI's detail panel.

A job is a sequence of steps; each step returns a JSON-shaped dict and is reported as it finishes so the
panel can show progress. Everything is best effort: a missing tool or a timeout marks the step and the
job carries on.

    identity   reverse DNS (dig), mDNS host (avahi-resolve), passive facts from the monitor state
    mdns       services this host advertises, with TXT records (model, friendly name, protocol versions)
    netbios    NetBIOS name table and workgroup (Windows, NAS, printers)
    upnp       SSDP M-SEARCH straight at the host, then its device-description XML
    ports      nmap TCP connect scan with service/version detection and default NSE scripts
    tls        certificate subject / issuer / SANs / validity on the TLS ports nmap found

Active steps (netbios, upnp, ports, tls probing) only run for hosts on local networks; for internet hosts
the job is limited to reverse DNS and the certificate on ports the capture already saw us use.
"""
from __future__ import annotations

import contextlib
import json
import os
import re
import shutil
import socket
import subprocess
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from typing import Callable
from urllib.parse import urljoin, urlparse
import ipaddress

Progress = Callable[[str, dict], None]

def location_allowed(loc: str, device_ip: str) -> bool:
    """UPnP LOCATION must be http(s) on the device we are scanning. No loopback, link-local, or metadata."""
    parsed = urlparse(loc)
    if parsed.scheme not in {"http", "https"}:
        return False
    host = (parsed.hostname or "").strip()
    if not host:
        return False
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return host == device_ip
    if addr.is_loopback or addr.is_link_local or addr.is_multicast or addr.is_unspecified:
        return False
    if addr in (ipaddress.ip_address("169.254.169.254"), ipaddress.ip_address("169.254.170.2")):
        return False
    try:
        return addr == ipaddress.ip_address(device_ip)
    except ValueError:
        return False

# well-known range plus the ports home / IoT gear actually uses (Cast, HomeKit, Plex, MQTT, Home Assistant, NAS,
# routers' admin ports, UPnP ephemeral, iOS sync ...). Ports the host advertises over mDNS or was seen serving are added.
NMAP_PORTS = (
    "1-1024,1080,1194,1433,1521,1723,1883,2000,2049,2121,2181,2222,2375,2376,3000,3001,3128,3306,3389,3478,4000,4443,"
    "4444,4567,5000-5010,5060,5061,5222,5223,5228,5353,5355,5432,5555,5557,5601,5683,5900-5902,6000,6379,6443,6668,"
    "6881,7000,7001,7070,7443,7547,8000-8010,8080-8090,8123,8181,8200,8291,8443,8444,8554,8800,8883,8888,8889,9000,"
    "9001,9080,9090,9100,9200,9443,9999,10000,10001,11211,27017,32400,32768-32800,49152-49170,50000,51413,62078,63000"
)
DISCOVERY_TIMEOUT = 150
VERSION_TIMEOUT = 200
TLS_HINT_PORTS = {443, 853, 465, 587, 993, 995, 5223, 8443, 8883, 9443}

TTL_HINT = {
    255: "network gear / BSD / Solaris (TTL 255)",
    128: "Windows (TTL 128)",
    64: "Linux, Android, macOS, iOS or embedded Linux (TTL 64)",
    60: "some embedded OS (TTL 60)",
    30: "some embedded OS (TTL 30)",
}


# every child we spawn, so a monitor shutdown can kill them: pool threads are joined at interpreter exit, and a
# thread blocked on a five-minute nmap would otherwise keep the process alive past systemd's stop timeout
_procs: set[subprocess.Popen] = set()
_procs_lock = threading.Lock()
_cancelled = threading.Event()


class Cancelled(Exception):
    pass


def cancel_all() -> None:
    """Stop every running probe; jobs end with status error. Called from the monitor's shutdown hook."""
    _cancelled.set()
    with _procs_lock:
        procs = list(_procs)
    for p in procs:
        with contextlib.suppress(ProcessLookupError, OSError):
            p.kill()


def _popen(cmd: list[str], stdin: bytes | None, timeout: float) -> tuple[int, bytes, bytes]:
    if _cancelled.is_set():
        raise Cancelled("shutting down")
    if not shutil.which(cmd[0]):
        raise FileNotFoundError(f"{cmd[0]} is not installed")
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    with _procs_lock:
        _procs.add(p)
    try:
        try:
            out, err = p.communicate(stdin, timeout=timeout)
        except subprocess.TimeoutExpired:
            p.kill()
            out, err = p.communicate()
            return 124, out or b"", f"timed out after {timeout:.0f}s".encode()
        if _cancelled.is_set():
            raise Cancelled("shutting down")
        return p.returncode, out or b"", err or b""
    finally:
        with _procs_lock:
            _procs.discard(p)


def _run(cmd: list[str], timeout: float) -> tuple[int, str, str]:
    rc, out, err = _popen(cmd, None, timeout)
    return rc, out.decode(errors="replace"), err.decode(errors="replace")


def ttl_hint(ttl: int | None) -> str:
    """Guess an OS family from the initial TTL, inferred from the most common TTL seen on this segment."""
    if not ttl:
        return ""
    for init in (255, 128, 64, 60, 30):
        if init - 32 < ttl <= init:
            return TTL_HINT[init] + ("" if ttl == init else f", seen {ttl}")
    return f"unusual TTL {ttl}"


# --------------------------------------------------------------------------- steps


def step_identity(ip: str, facts: dict) -> dict:
    out: dict = {"rdns": [], "mdns_host": "", "passive": facts}
    if shutil.which("dig"):
        rc, o, _ = _run(["dig", "+short", "+time=2", "+tries=1", "-x", ip], 8)
        out["rdns"] = [l.rstrip(".") for l in o.split() if l and not l.startswith(";")]
    else:
        try:
            out["rdns"] = [socket.gethostbyaddr(ip)[0]]
        except (socket.herror, socket.gaierror, OSError):
            pass
    if shutil.which("avahi-resolve") and facts.get("local"):
        rc, o, _ = _run(["avahi-resolve", "-a", ip], 5)
        parts = o.split()
        if len(parts) >= 2:
            out["mdns_host"] = parts[1].rstrip(".")
    out["ttl_hint"] = ttl_hint(facts.get("ttl"))
    return out


def step_mdns(ip: str, aliases: list[str]) -> dict:
    """Every mDNS service whose resolved address is this host. TXT records often name the model."""
    rc, o, err = _run(["avahi-browse", "-a", "-t", "-r", "-p"], 12)
    mine = {ip, *aliases}
    services: list[dict] = []
    seen = set()
    for line in o.splitlines():
        f = line.split(";")
        if len(f) < 10 or f[0] != "=" or f[7] not in mine:
            continue
        key = (f[4], f[3], f[8])
        if key in seen:
            continue
        seen.add(key)
        txt = re.findall(r'"((?:[^"\\]|\\.)*)"', f[9])
        services.append({
            "type": f[4], "name": re.sub(r"\\(\d{3})", lambda m: chr(int(m.group(1))), f[3]), "host": f[6].rstrip("."),
            "port": int(f[8]) if f[8].isdigit() else 0, "txt": txt,
        })
    services.sort(key=lambda s: (s["type"], s["name"]))
    # TXT keys that identify hardware, gathered across services
    hints = {}
    for s in services:
        for t in s["txt"]:
            k, _, v = t.partition("=")
            k = k.lower()
            if k in ("md", "model", "fn", "manufacturer", "ty", "product", "am", "deviceid", "usb_mfg", "usb_mdl", "ve", "osxvers", "rpmd", "rpvr", "srcvers", "ca", "ic") and v and k not in hints:
                hints[k] = v.strip("()")
    return {"services": services, "hints": hints}


def step_netbios(ip: str) -> dict:
    rc, o, err = _run(["nbtscan", "-v", "-t", "2000", ip], 15)
    names, groups, raw = [], [], []
    for line in o.splitlines():
        s = line.strip()
        if not s or s.startswith(("Doing", "NetBIOS", "-")) or s.startswith(ip):
            continue
        raw.append(s)
        m = re.match(r"^(\S+)\s+<(\w\w)>\s+(UNIQUE|GROUP)", s)
        if m:
            (groups if m.group(3) == "GROUP" else names).append({"name": m.group(1), "suffix": m.group(2)})
        elif re.match(r"^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$", s, re.I):
            pass
    mac = next((l for l in raw if re.match(r"^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$", l, re.I)), "")
    return {"names": names, "groups": groups, "mac": mac.lower().replace("-", ":"), "raw": raw[:30]}


def step_upnp(ip: str) -> dict:
    """Unicast SSDP discovery, then fetch each device description for make / model / serial / services."""
    msg = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n").encode()
    responses: list[dict] = []
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.settimeout(2.5)
        try:
            s.sendto(msg, (ip, 1900))
            s.sendto(msg, (ip, 1900))
            end = time.time() + 2.5
            while time.time() < end:
                try:
                    data, addr = s.recvfrom(65535)
                except socket.timeout:
                    break
                hdrs = {}
                for line in data.decode(errors="replace").split("\r\n")[1:]:
                    k, _, v = line.partition(":")
                    if _:
                        hdrs[k.strip().upper()] = v.strip()
                if hdrs and not any(r["headers"].get("USN") == hdrs.get("USN") and r["headers"].get("ST") == hdrs.get("ST") for r in responses):
                    responses.append({"headers": hdrs})
        except OSError as e:
            return {"responses": [], "devices": [], "error": str(e)}
    devices: list[dict] = []
    fetched = set()
    for r in responses:
        loc = r["headers"].get("LOCATION", "")
        if not loc or loc in fetched:
            continue
        fetched.add(loc)
        if not location_allowed(loc, ip):
            devices.append({"location": loc, "error": "LOCATION rejected (not this host / not http(s))"})
            continue
        try:
            with urllib.request.urlopen(urllib.request.Request(loc, headers={"User-Agent": "zoto-viz/1.0"}), timeout=5) as resp:
                body = resp.read(262144)
        except Exception as e:  # noqa: BLE001
            devices.append({"location": loc, "error": str(e)})
            continue
        try:
            root = ET.fromstring(body)
        except ET.ParseError:
            devices.append({"location": loc, "error": "description is not XML"})
            continue
        ns = re.match(r"\{(.*)\}", root.tag)
        pre = f"{{{ns.group(1)}}}" if ns else ""
        def text(el: ET.Element | None, tag: str) -> str:
            x = el.find(f"{pre}{tag}") if el is not None else None
            return (x.text or "").strip() if x is not None and x.text else ""
        dev = root.find(f"{pre}device")
        info = {"location": loc}
        if dev is not None:
            for tag in ("deviceType", "friendlyName", "manufacturer", "manufacturerURL", "modelName", "modelNumber", "modelDescription", "modelURL", "serialNumber", "UDN", "presentationURL"):
                v = text(dev, tag)
                if v:
                    if tag == "presentationURL":
                        href = urljoin(loc, v)
                        if urlparse(href).scheme not in {"http", "https"}:
                            continue
                        info[tag] = href
                    else:
                        info[tag] = v
            info["services"] = [text(s, "serviceType").replace("urn:schemas-upnp-org:service:", "") for s in dev.findall(f"{pre}serviceList/{pre}service")]
            info["embedded"] = [
                {k: text(d, k) for k in ("deviceType", "friendlyName", "modelName") if text(d, k)}
                for d in dev.findall(f"{pre}deviceList/{pre}device")
            ]
        devices.append(info)
    return {"responses": [r["headers"] for r in responses], "devices": devices}


def _nmap(args: list[str], ip: str, timeout: int) -> tuple[ET.Element | None, str, str]:
    """Run nmap -oX and return (host element or None, command shown to the user, error)."""
    cmd = ["nmap", "-Pn", "-n", *args, "-oX", "-", ip]
    shown = " ".join(cmd[:-3])
    rc, o, err = _run(cmd, timeout)
    if rc == 124:
        return None, shown, err
    try:
        x = ET.fromstring(o)
    except ET.ParseError:
        return None, shown, err.strip().splitlines()[-1] if err.strip() else "nmap produced no XML"
    host = x.find("host")
    if host is None:
        return None, shown, "host did not answer"
    return host, shown, ""


def _port_entries(host: ET.Element) -> list[dict]:
    out = []
    for p in host.findall("ports/port"):
        st = p.find("state")
        if st is None or st.get("state") not in ("open", "open|filtered"):
            continue
        svc = p.find("service")
        g = (lambda k: svc.get(k, "")) if svc is not None else (lambda k: "")
        out.append({
            "port": int(p.get("portid", 0)), "proto": p.get("protocol", "tcp"), "state": st.get("state"),
            "service": g("name"), "product": g("product"), "version": g("version"), "extra": g("extrainfo"), "tunnel": g("tunnel"),
            "cpe": [c.text for c in svc.findall("cpe") if c.text] if svc is not None else [],
            "scripts": {s.get("id"): (s.get("output") or "").strip() for s in p.findall("script")},
        })
    return out


def step_ports(ip: str, extra_ports: list[int]) -> dict:
    """Two passes: a fast connect scan to find open ports, then version detection and default scripts on those only,
    so a host that drops SYNs (long timeouts) still yields whatever was found before nmap's host-timeout hits."""
    root_ok = os.geteuid() == 0
    ports = NMAP_PORTS + "".join(f",{p}" for p in sorted(set(extra_ports)) if 0 < p < 65536)
    t0 = time.time()
    scan = ["-sS"] if root_ok else ["-sT"]
    host, cmd1, err = _nmap([*scan, "-T4", "-p", ports, "--max-retries", "1", "--max-rtt-timeout", "1500ms",
                             "--host-timeout", f"{DISCOVERY_TIMEOUT - 10}s"], ip, DISCOVERY_TIMEOUT)
    result: dict = {"command": cmd1, "took": 0.0, "ports": [], "hostscripts": {}, "os": [], "privileged": root_ok}
    if host is None:
        result.update(error=err, took=round(time.time() - t0, 1))
        return result
    result["state"] = host.find("status").get("state") if host.find("status") is not None else ""
    found = _port_entries(host)
    ex = host.find("ports/extraports")
    if ex is not None:
        result["closed"] = {"state": ex.get("state"), "count": int(ex.get("count", 0))}
    result["ports"] = found
    if found:
        plist = ",".join(str(p["port"]) for p in found)
        args = [*scan, "-T4", "-p", plist, "-sV", "--version-light", "-sC", "--host-timeout", f"{VERSION_TIMEOUT - 10}s"]
        if root_ok:
            args.append("-O")
        host2, cmd2, err2 = _nmap(args, ip, VERSION_TIMEOUT)
        result["command"] = f"{cmd1}  ▸  {cmd2}"
        if host2 is None:
            result["error"] = f"version detection: {err2}"
        else:
            detail = {p["port"]: p for p in _port_entries(host2)}
            result["ports"] = [detail.get(p["port"], p) for p in found]
            result["hostscripts"] = {s.get("id"): (s.get("output") or "").strip() for s in host2.findall("hostscript/script")}
            result["os"] = [{"name": m.get("name"), "accuracy": int(m.get("accuracy", 0))} for m in host2.findall("os/osmatch")]
            up = host2.find("uptime")
            if up is not None:
                result["uptime"] = {"seconds": int(up.get("seconds", 0)), "lastboot": up.get("lastboot", "")}
    result["took"] = round(time.time() - t0, 1)
    return result


def cert_info(ip: str, port: int, timeout: float = 6.0) -> dict:
    cmd = ["openssl", "s_client", "-connect", f"{ip}:{port}", "-servername", ip, "-showcerts"]
    try:
        rc, stdout, _ = _popen(cmd, b"", timeout)
    except FileNotFoundError as e:
        return {"port": port, "error": str(e)}
    if rc == 124:
        return {"port": port, "error": f"handshake timed out after {timeout:.0f}s"}
    pem = re.search(rb"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", stdout, re.S)
    if not pem:
        return {"port": port, "error": "no certificate presented"}
    _, xout, _ = _popen(["openssl", "x509", "-noout", "-subject", "-issuer", "-dates", "-serial", "-ext", "subjectAltName", "-nameopt", "RFC2253"],
                        pem.group(0), timeout)
    out: dict = {"port": port, "sans": []}
    for line in xout.decode(errors="replace").splitlines():
        s = line.strip()
        if s.startswith("subject="):
            out["subject"] = s[8:]
        elif s.startswith("issuer="):
            out["issuer"] = s[7:]
        elif s.startswith("notBefore="):
            out["not_before"] = s[10:]
        elif s.startswith("notAfter="):
            out["not_after"] = s[9:]
        elif s.startswith("serial="):
            out["serial"] = s[7:]
        elif "DNS:" in s or "IP Address:" in s:
            out["sans"] += [p.split(":", 1)[1].strip() for p in s.split(",") if ":" in p]
    m = re.search(rb"Protocol\s*:\s*(\S+)", stdout)
    if m:
        out["protocol"] = m.group(1).decode()
    m = re.search(rb"Cipher\s*:\s*(\S+)", stdout)
    if m:
        out["cipher"] = m.group(1).decode()
    out["self_signed"] = out.get("subject") == out.get("issuer") and bool(out.get("subject"))
    return out


def step_tls(ip: str, ports: list[int]) -> dict:
    return {"certs": [cert_info(ip, p) for p in sorted(set(ports))[:8]]}


# --------------------------------------------------------------------------- job


def run_job(ip: str, facts: dict, progress: Progress) -> dict:
    """Run every applicable step, calling progress(step, result) after each. Returns the full result."""
    local = bool(facts.get("local"))
    aliases = facts.get("aliases", [])
    steps: dict[str, dict] = {}

    def do(name: str, fn: Callable[[], dict]) -> dict:
        t0 = time.time()
        if _cancelled.is_set():
            raise Cancelled("shutting down")
        progress(name, {"status": "running", "started": t0})
        try:
            data = fn()
            res = {"status": "done", "took": round(time.time() - t0, 1), "data": data}
        except Cancelled:
            raise
        except FileNotFoundError as e:
            res = {"status": "skipped", "took": round(time.time() - t0, 1), "reason": str(e)}
        except Exception as e:  # noqa: BLE001
            res = {"status": "error", "took": round(time.time() - t0, 1), "reason": f"{type(e).__name__}: {e}"}
        steps[name] = res
        progress(name, res)
        return res

    def skip(name: str, why: str) -> None:
        steps[name] = {"status": "skipped", "took": 0, "reason": why}
        progress(name, steps[name])

    do("identity", lambda: step_identity(ip, facts))
    if local:
        mdns_res = do("mdns", lambda: step_mdns(ip, aliases))
        do("netbios", lambda: step_netbios(ip))
        upnp_res = do("upnp", lambda: step_upnp(ip))
        # ports the host itself told us about, or that the capture saw it serve, always make the scan list
        extra = [s["port"] for s in mdns_res.get("data", {}).get("services", []) if s["port"]]
        extra += [int(p.split("/")[1]) for p in (*facts.get("serves", []), *facts.get("ports_seen", [])) if p.startswith("tcp/") and p.split("/")[1].isdigit()]
        for d in upnp_res.get("data", {}).get("devices", []):
            m = re.search(r":(\d+)/", d.get("location", ""))
            if m:
                extra.append(int(m.group(1)))
        ports_res = do("ports", lambda: step_ports(ip, extra))
        tls_ports = [p["port"] for p in ports_res.get("data", {}).get("ports", [])
                     if p["tunnel"] == "ssl" or p["service"] in ("https", "ssl", "https-alt") or p["port"] in TLS_HINT_PORTS]
        if tls_ports:
            do("tls", lambda: step_tls(ip, tls_ports))
        else:
            skip("tls", "no TLS ports found")
    else:
        why = "active probing is limited to local networks"
        for n in ("mdns", "netbios", "upnp", "ports"):
            skip(n, why)
        seen_tls = [int(p.split("/")[1]) for p in facts.get("ports_seen", []) if p.startswith("tcp/") and int(p.split("/")[1]) in TLS_HINT_PORTS]
        if seen_tls:
            do("tls", lambda: step_tls(ip, seen_tls))
        else:
            skip("tls", "no TLS conversation with this host observed")
    return steps


def summarise(steps: dict[str, dict], facts: dict) -> dict:
    """Best single answers pulled from all steps, for the top of the panel."""
    g = lambda n: steps.get(n, {}).get("data", {}) or {}
    ident, mdns, nb, upnp, ports, tls = g("identity"), g("mdns"), g("netbios"), g("upnp"), g("ports"), g("tls")
    names = []
    names += ident.get("rdns", [])
    if ident.get("mdns_host"):
        names.append(ident["mdns_host"])
    names += [n["name"] for n in nb.get("names", [])]
    for d in upnp.get("devices", []):
        if d.get("friendlyName"):
            names.append(d["friendlyName"])
    hints = mdns.get("hints", {})
    make_model = []
    for d in upnp.get("devices", []):
        mm = " ".join(x for x in (d.get("manufacturer"), d.get("modelName"), d.get("modelNumber")) if x)
        if mm:
            make_model.append(mm)
    for k in ("manufacturer", "usb_mfg"):
        if hints.get(k):
            make_model.append(hints[k])
    for k in ("md", "model", "ty", "product", "usb_mdl", "am"):
        if hints.get(k):
            make_model.append(hints[k])
    make_model = list(dict.fromkeys(make_model))
    # "HP" and "OfficeJet Pro 7740 series" are both inside "HP OfficeJet Pro 7740 series": keep the most complete
    make_model = [m for m in make_model if not any(o != m and m.lower() in o.lower() for o in make_model)]
    os_guess = [o["name"] for o in ports.get("os", [])[:2]]
    for k, v in ports.get("hostscripts", {}).items():
        if k == "smb-os-discovery":
            m = re.search(r"OS:\s*(.+)", v)
            if m:
                os_guess.append(m.group(1).strip())
    if not os_guess and ident.get("ttl_hint"):
        os_guess.append(ident["ttl_hint"])
    if hints.get("osxvers"):
        os_guess.append(f"macOS (osxvers {hints['osxvers']})")
    open_ports = [f"{p['port']}/{p['proto']} {p['service']}".strip() for p in ports.get("ports", [])]
    cert_names = sorted({n for c in tls.get("certs", []) for n in c.get("sans", [])} | {c["subject"] for c in tls.get("certs", []) if c.get("subject")})
    return {
        "names": list(dict.fromkeys(n for n in names if n)),
        "make_model": list(dict.fromkeys(make_model)),
        "os": list(dict.fromkeys(os_guess)),
        "open_ports": open_ports,
        "services_advertised": sorted({s["type"] for s in mdns.get("services", [])}),
        "cert_names": cert_names[:12],
        "counts": {"open_ports": len(open_ports), "mdns": len(mdns.get("services", [])), "upnp": len(upnp.get("devices", [])), "certs": len(tls.get("certs", []))},
    }


def most_common_ttl(counter: Counter) -> int | None:
    """Most common IPv4 TTL, ignoring 255 (mDNS/SSDP-mandated) when a host TTL is also present."""
    if not counter:
        return None
    items = counter.most_common()
    rest = [(t, n) for t, n in items if t != 255]
    return (rest or items)[0][0]
