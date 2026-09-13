import { categorize } from "../core/modes";
import { rIp, rName, rText } from "../core/redact";
import type { NetScene } from "../graph/scene";
import { displayName, type Packet } from "../core/types";

/**
 * Turn a captured packet into a short, colour-coded headline a viewer would actually read.
 * Wireshark's Info column is kept as a fallback; noise (ACK-only, TLS app data) is marked skip.
 */

export type FeedKind = "dns" | "mdns" | "tls" | "quic" | "http" | "dhcp" | "ssdp" | "media" | "remote" | "plain" | "wifi" | "bt" | "other";

export interface Decoded {
  kind: FeedKind;
  /** short tag shown as a colour chip */
  label: string;
  color: string;
  /** one-line headline, already redacted */
  text: string;
  skip: boolean;
  host?: string;
  peer?: string;
}

const KIND_COLOR: Record<FeedKind, string> = {
  dns: "#26a69a",
  mdns: "#ffca28",
  tls: "#7e57c2",
  quic: "#29b6f6",
  http: "#ef5350",
  dhcp: "#ffca28",
  ssdp: "#ffca28",
  media: "#26c6da",
  remote: "#ff7043",
  plain: "#ef5350",
  wifi: "#66bb6a",
  bt: "#29b6f6",
  other: "#8a93a6",
};

const KIND_LABEL: Record<FeedKind, string> = {
  dns: "DNS", mdns: "mDNS", tls: "TLS", quic: "QUIC", http: "HTTP",
  dhcp: "DHCP", ssdp: "SSDP", media: "media", remote: "remote", plain: "plain",
  wifi: "Wi-Fi", bt: "BT", other: "pkt",
};

const NOISE = /Application Data|Continuation Data|Keep-Alive|Encrypted Alert|Ignored Unknown Record/i;

export function decodePacket(p: Packet, scene: NetScene): Decoded {
  const [, dir, peer, proto, tag, , , info, ports, member] = p;
  const who = hostName(scene, member || null, dir === "out");
  const them = hostName(scene, peer, false);
  const base = kindFrom(proto, tag, info);
  const cat = categorize(tag ? [tag] : []);
  if (cat.id !== "other" && base.kind === "other") {
    base.kind = cat.id === "discovery" ? "ssdp" : cat.id === "tls" ? "tls" : cat.id === "quic" ? "quic"
      : cat.id === "dns" ? "dns" : cat.id === "media" ? "media" : cat.id === "remote" ? "remote"
      : cat.id === "plain" ? "plain" : "other";
  }
  const skip = isNoise(info, proto);
  const detail = headline(proto, tag, info, ports, dir) || rawFallback(proto, tag, info);
  const arrow = dir === "out" ? "→" : "←";
  const text = rText(`${who} ${arrow} ${them}  ${detail}`);
  return {
    kind: base.kind,
    label: KIND_LABEL[base.kind],
    color: KIND_COLOR[base.kind],
    text,
    skip,
    host: member,
    peer,
  };
}

function hostName(scene: NetScene, ip: string | null, preferSelf: boolean): string {
  if (!ip) return preferSelf ? "this host" : "?";
  const d = scene.deviceOf(ip);
  if (!d) return rIp(ip);
  const n = displayName(d);
  return n === d.ip ? rIp(ip) : rName(n);
}

export function kindFrom(proto: string, tag: string, info: string): { kind: FeedKind } {
  const p = proto.toLowerCase();
  const blob = `${p} ${info}`;
  if (tag.startsWith("wlan/") || p.includes("802.11") || /beacon|probe req|probe resp|association/i.test(blob)) return { kind: "wifi" };
  if (tag.startsWith("btle/") || tag.startsWith("uuid/") || /^(btle|bluetooth|hci)/i.test(p)) return { kind: "bt" };
  if (p.includes("mdns") || /_tcp\.local|_udp\.local/i.test(info)) return { kind: "mdns" };
  if (p === "dns" || p.startsWith("dns") || tag === "udp/53" || tag === "tcp/53" || tag === "tcp/853") return { kind: "dns" };
  if (p.includes("quic")) return { kind: "quic" };
  if (p.includes("tls") || p.includes("ssl") || /client hello|server hello/i.test(info)) return { kind: "tls" };
  if (p.includes("http") && !p.includes("ssdp")) return { kind: "http" };
  if (p.includes("dhcp") || /dhcp/i.test(info)) return { kind: "dhcp" };
  if (p.includes("ssdp") || /m-search|ssdp:/i.test(info)) return { kind: "ssdp" };
  if (/^(ssh|rdp|vnc|rfb)/i.test(p) || tag === "tcp/22" || tag === "tcp/3389") return { kind: "remote" };
  if (/rtsp|rtp|cast/i.test(p) || tag === "tcp/8009" || tag === "tcp/554") return { kind: "media" };
  return { kind: "other" };
}

export function isNoise(info: string, proto: string): boolean {
  if (NOISE.test(info)) return true;
  if (/\[ACK\]/.test(info) && !/\[(SYN|FIN|RST|PSH)/.test(info)) return true;
  if (/^tcp$/i.test(proto) && /\[TCP/i.test(info) && /retransmission|out-of-order|dup ack|fast retransmission|spurious/i.test(info)) return true;
  // tshark's default UDP/TCP info is just ports and length — not worth a ticker line
  if (/^(UDP|TCP)$/i.test(proto) && /^[\d\s→\->Len=]+$/i.test(info.replace(/\s+/g, " ").trim())) return true;
  return false;
}

function headline(proto: string, tag: string, info: string, ports: string, dir: string): string {
  if (tag.startsWith("wlan/") || /beacon|probe /i.test(info) || /802\.11|wlan/i.test(proto)) {
    const clip = info.replace(/\s+/g, " ").trim();
    if (clip) return clip.slice(0, 80);
  }
  if (tag.startsWith("btle/") || /^(BTLE|Bluetooth)/i.test(proto)) {
    const clip = info.replace(/\s+/g, " ").trim();
    if (clip) return clip.slice(0, 80);
    return "advertisement";
  }
  const sni = info.match(/SNI[=:]?\s*([a-z0-9._-]+\.[a-z0-9.-]+)/i)?.[1];
  if (sni) return dir === "out" ? `TLS ${rName(sni)}` : `TLS from ${rName(sni)}`;

  const q = info.match(/Standard query(?: response)?(?:\s+0x[0-9a-f]+)?(?:\s+(PTR|A|AAAA|SRV|TXT|HTTPS|SVCB|NSEC|ANY|CNAME|MX|SOA|NS|OPT))*\s+(\S+)/i);
  if (q) {
    const typ = (q[1] || "A").toUpperCase();
    const name = tidyName(q[2] ?? "");
    const ans = info.match(/\bA(?:AAA)?\s+(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]+)/i);
    const isResp = /response/i.test(info);
    if (/_tcp\.|_udp\.|_tls\./i.test(name) || proto.toLowerCase().includes("mdns")) {
      return isResp ? `advertises ${name}` : `browses ${name}`;
    }
    if (isResp) return ans ? `${typ} ${name} → ${rIp(ans[1]!)}` : `${typ} ${name}`;
    return `asks ${typ} ${name}`;
  }

  const http = info.match(/^(GET|POST|PUT|HEAD|DELETE|PATCH|OPTIONS|CONNECT)\s+(\S+)/i);
  if (http) return `${http[1]!.toUpperCase()} ${http[2]}`;
  const httpSt = info.match(/^HTTP\/[\d.]+\s+(\d{3})(?:\s+(.+))?/i);
  if (httpSt) return `HTTP ${httpSt[1]}${httpSt[2] ? ` ${httpSt[2]}` : ""}`;

  if (/Client Hello/i.test(info)) return tag ? `TLS hello ${tag}` : "TLS Client Hello";
  if (/Server Hello/i.test(info)) return "TLS Server Hello";
  if (/Certificate/i.test(info) && /tls/i.test(proto)) return "TLS certificate";

  const dhcp = info.match(/DHCP\s+(\w+)/i);
  if (dhcp) {
    const host = info.match(/hostname[:\s]+([^\s,]+)/i)?.[1];
    return host ? `DHCP ${dhcp[1]} ${rName(host)}` : `DHCP ${dhcp[1]}`;
  }
  if (/M-SEARCH/i.test(info)) return "SSDP search";
  if (/NOTIFY/i.test(info) && /ssdp|upnp/i.test(proto + info)) return "SSDP notify";

  if (/\[SYN\]/.test(info) && !/\[ACK\]/.test(info)) return `connect ${svc(tag, ports)}`;
  if (/\[FIN/.test(info)) return `close ${svc(tag, ports)}`;
  if (/\[RST/.test(info)) return `reset ${svc(tag, ports)}`;

  if (/quic/i.test(proto)) {
    if (/Initial/i.test(info)) return "QUIC initial";
    if (/Handshake/i.test(info)) return "QUIC handshake";
    return "QUIC";
  }
  if (/icmp/i.test(proto)) {
    if (/unreachable/i.test(info)) return "ICMP unreachable";
    if (/echo/i.test(info)) return /reply/i.test(info) ? "ping reply" : "ping";
    return proto;
  }
  return "";
}

function tidyName(n: string): string {
  const s = n.replace(/\.+$/, "");
  if (/^_/.test(s) || /\._(tcp|udp|tls)\./i.test(s)) {
    const inst = s.replace(/\\(\d{3})/g, (_, x) => String.fromCharCode(Number(x) % 256)).replace(/\\032/g, " ");
    return rName(inst);
  }
  return rName(s);
}

function svc(tag: string, ports: string): string {
  if (tag) return tag;
  return ports || "";
}

function rawFallback(proto: string, tag: string, info: string): string {
  const clip = info.replace(/\s+/g, " ").trim();
  if (clip && clip.length < 80) return clip;
  if (clip) return clip.slice(0, 72) + "…";
  return tag || proto || "packet";
}
