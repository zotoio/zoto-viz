import * as THREE from "three";
import type { GLink, GNode } from "./scene";
import { ROLE_COLOR, ago, displayName, fmtBytes, type Device } from "./types";

/**
 * View modes. The scene owns nodes, links and the simulation; a mode answers questions about how to
 * style them (colour, size, labels, edge colour/brightness), may bend the layout (shell radii, custom
 * force, camera) and may float overlay labels in the scene. All hooks are optional and fall back to the
 * topology defaults, so a mode only has to say what it changes.
 */

export interface ModeOption { key: string; label: string; values: [value: string, label: string][]; default: string }
export interface Legend { color: string; label: string; line?: boolean }
export interface Overlay { id: string; x: number; y: number; z: number; html: string }

export interface ModeCtx {
  now: number;
  nodes: Map<string, GNode>;
  links: Map<string, GLink>;
  opts: Record<string, string>;
  gateway: string;
  localIp: string;
  selected: GNode | null;
}

export interface ViewMode {
  id: string;
  label: string;
  hint: string;
  options?: ModeOption[];
  legend(opts: Record<string, string>): Legend[];
  /** camera position to glide to when the mode is entered */
  camera?: [number, number, number];
  /** once per snapshot, before styling; compute caches here */
  prepare?(ctx: ModeCtx): void;
  nodeColor?(n: GNode, ctx: ModeCtx): number | undefined;
  nodeScale?(n: GNode, ctx: ModeCtx): number | undefined;
  /** extra line under the node label */
  nodeLabel?(n: GNode, ctx: ModeCtx): string | undefined;
  /** show the label regardless of the role-based default */
  forceLabel?(n: GNode, ctx: ModeCtx): boolean;
  /** hide labels the default would show */
  suppressLabel?(n: GNode, ctx: ModeCtx): boolean;
  /** single colour, or [sourceColour, targetColour] for a gradient */
  linkColor?(l: GLink, ctx: ModeCtx): number | [number, number] | undefined;
  linkBright?(l: GLink, ctx: ModeCtx, base: number): number;
  // layout
  shellRadius?(n: GNode): number | undefined;
  shellStrength?(n: GNode): number | undefined;
  charge?(n: GNode): number | undefined;
  linkStrength?(l: GLink): number | undefined;
  flatten?: boolean;
  force?(nodes: GNode[], alpha: number, ctx: ModeCtx): void;
  overlays?(ctx: ModeCtx): Overlay[];
}

// ------------------------------------------------------------------ helpers

const css = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const total = (d: Device) => d.bytes_in + d.bytes_out;
const isReal = (l: GLink) => !l.id.startsWith("~");
const isInternet = (n: GNode) => n.device.role === "internet";
const other = (l: GLink, n: GNode) => (l.source === n ? l.target : l.source);

const HEAT: [number, number][] = [[0x3b4252, 0], [0x1e88e5, 0.25], [0x26c6da, 0.5], [0xffee58, 0.75], [0xff5252, 1]];
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
function heat(t: number): number {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < HEAT.length; i++) {
    if (t <= HEAT[i][1]) {
      const [a, ta] = HEAT[i - 1], [b, tb] = HEAT[i];
      return _c1.setHex(a).lerp(_c2.setHex(b), (t - ta) / (tb - ta)).getHex();
    }
  }
  return HEAT[HEAT.length - 1][0];
}

const PALETTE = [0xef5350, 0xab47bc, 0x5c6bc0, 0x29b6f6, 0x26a69a, 0x9ccc65, 0xffee58, 0xffa726, 0xff7043, 0xec407a, 0x7e57c2, 0x42a5f5, 0x66bb6a, 0xd4e157, 0xffca28, 0x8d6e63];
function hashColor(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return PALETTE[(h >>> 0) % PALETTE.length];
}

const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne"]);
const ORG_ALIAS: Record<string, string> = { "1e100.net": "google.com", "googleusercontent.com": "google.com", "gstatic.com": "google.com", "ggpht.com": "google.com", "youtube.com": "google.com", "amazonaws.com": "aws", "cloudfront.net": "aws", "awsglobalaccelerator.com": "aws", "akamaitechnologies.com": "akamai", "akamaiedge.net": "akamai", "akadns.net": "akamai", "fbcdn.net": "facebook.com", "instagram.com": "facebook.com", "whatsapp.net": "facebook.com", "cloudflare-dns.com": "cloudflare.com", "one.one.one.one": "cloudflare.com", "azureedge.net": "microsoft.com", "windows.net": "microsoft.com", "msedge.net": "microsoft.com", "live.com": "microsoft.com", "office.com": "microsoft.com", "icloud.com": "apple.com", "mzstatic.com": "apple.com", "aaplimg.com": "apple.com" };
/** registrable domain of the best name we have for a device, with a few CDN families folded together */
export function orgOf(d: Device): string {
  const raw = d.names?.find((x) => !x.startsWith("*")) ?? d.names?.[0]?.replace(/^\*\./, "") ?? d.hostnames?.[0];
  if (raw && raw.includes(".") && !/^[\d.]+$/.test(raw) && !raw.endsWith(".local") && !raw.endsWith(".arpa")) {
    const parts = raw.toLowerCase().replace(/\.$/, "").split(".");
    let n = 2;
    if (parts.length >= 3 && SECOND_LEVEL.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2) n = 3;
    const org = parts.slice(-n).join(".");
    return ORG_ALIAS[org] ?? ORG_ALIAS[raw.toLowerCase()] ?? org;
  }
  if (d.ip.includes(":")) return "unnamed IPv6";
  const m = d.ip.match(/^(\d+\.\d+)\./);
  return m ? `unnamed ${m[1]}.x.x` : "unnamed";
}

interface ProtoCat { id: string; label: string; short: string; color: number; ports: Set<string> }
const cat = (id: string, label: string, short: string, color: number, ports: string): ProtoCat => ({ id, label, short, color, ports: new Set(ports.split(" ")) });
export const PROTO_CATS: ProtoCat[] = [
  cat("tls", "TLS / HTTPS", "TLS", 0x7e57c2, "tcp/443 tcp/8443 tcp/4443"),
  cat("quic", "QUIC (HTTP/3)", "QUIC", 0x29b6f6, "udp/443 udp/8443"),
  cat("dns", "DNS / DoT", "DNS", 0x26a69a, "udp/53 tcp/53 tcp/853 udp/853"),
  cat("plain", "plaintext web / legacy", "plaintext", 0xef5350, "tcp/80 tcp/8080 tcp/8008 tcp/8000 tcp/21 tcp/23 tcp/25 tcp/110 tcp/143 udp/69 udp/161 tcp/1883"),
  cat("discovery", "discovery (mDNS/SSDP/NetBIOS/DHCP)", "discovery", 0xffca28, "udp/5353 udp/1900 udp/137 udp/138 udp/5355 udp/67 udp/68 udp/3702 udp/5350 udp/5351 udp/1982 udp/10001 udp/6666 udp/6667 udp/9 udp/62976 tcp/5357"),
  cat("remote", "SSH / RDP / VNC", "remote", 0xff7043, "tcp/22 tcp/3389 tcp/5900 tcp/5901 udp/3389"),
  cat("mail", "mail (IMAPS/SMTPS/POP3S)", "mail", 0xec407a, "tcp/465 tcp/587 tcp/993 tcp/995"),
  cat("ntp", "NTP", "NTP", 0x9ccc65, "udp/123"),
  cat("media", "media / cast / RTC", "media", 0x26c6da, "tcp/8009 tcp/1935 udp/3478 tcp/3478 udp/5004 udp/5005 udp/19302 tcp/32400 udp/32400"),
  cat("other", "other", "other", 0x607d8b, ""),
];
const CAT_BY_ID = new Map(PROTO_CATS.map((c) => [c.id, c]));
export function categorize(ports: string[]): ProtoCat {
  for (const p of ports) for (const c of PROTO_CATS) if (c.ports.has(p)) return c;
  return CAT_BY_ID.get("other")!;
}

const PLAIN_PORTS = CAT_BY_ID.get("plain")!.ports;

/** Lay nodes out in a row centred on x=0; overflow wraps into extra rows stacked by `dy`; odd columns are
 *  nudged by `stagger` so neighbouring labels alternate up/down instead of overlapping. */
function gridTargets(nodes: GNode[], y: number, z0: number, maxCols: number, spacing: number, dy: number, stagger = 0): Map<GNode, [number, number, number]> {
  const out = new Map<GNode, [number, number, number]>();
  const n = nodes.length;
  if (!n) return out;
  const cols = Math.min(n, maxCols);
  const rows = Math.ceil(n / cols);
  const sx = Math.min(spacing, 1200 / cols);
  nodes.forEach((node, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const inRow = r === rows - 1 ? n - r * cols : cols;
    out.set(node, [(c - (inRow - 1) / 2) * sx, y + r * dy + (c % 2 ? stagger : 0), z0]);
  });
  return out;
}

// ------------------------------------------------------------------ modes

export const topology: ViewMode = {
  id: "topology",
  label: "Topology",
  hint: "Devices in shells by role around the gateway; edge colour = LAN (blue) or internet (purple), brightness = current rate.",
  legend: () => [
    { color: css(ROLE_COLOR.self), label: "this host" }, { color: css(ROLE_COLOR.gateway), label: "gateway" },
    { color: css(ROLE_COLOR.lan), label: "LAN" }, { color: css(ROLE_COLOR.local), label: "local (docker / vm / tunnel)" },
    { color: css(ROLE_COLOR.internet), label: "internet" }, { color: css(ROLE_COLOR.multicast), label: "multicast" },
  ],
};

/** Who is moving the bytes: size = share of total volume, colour = heat of current rate, labels on the top N. */
export const talkers: ViewMode = (() => {
  let maxBytes = 1, maxLogRate = 1;
  const top = new Set<GNode>();
  return {
    id: "talkers",
    label: "Top talkers",
    hint: "Sphere size = cumulative volume, colour = current rate (blue cold → red hot). Labels on the top N.",
    options: [
      { key: "rank", label: "rank by", values: [["bytes", "total volume"], ["rate", "current rate"]], default: "bytes" },
      { key: "top", label: "label top", values: [["5", "5"], ["10", "10"], ["20", "20"], ["40", "40"]], default: "10" },
    ],
    legend: (o) => [
      { color: css(heat(0)), label: "idle" }, { color: css(heat(0.3)), label: "trickle" }, { color: css(heat(0.6)), label: "busy" }, { color: css(heat(1)), label: "hot" },
      { color: "transparent", label: `size = ${o.rank === "rate" ? "current rate" : "total volume"}` },
    ],
    prepare(ctx) {
      maxBytes = 1; maxLogRate = 1;
      const ranked: GNode[] = [];
      for (const n of ctx.nodes.values()) {
        if (!n.visible || n.device.role === "multicast") continue;
        maxBytes = Math.max(maxBytes, total(n.device));
        maxLogRate = Math.max(maxLogRate, Math.log10(1 + n.rate));
        ranked.push(n);
      }
      ranked.sort(ctx.opts.rank === "rate" ? (a, b) => b.rate - a.rate || total(b.device) - total(a.device) : (a, b) => total(b.device) - total(a.device));
      top.clear();
      for (const n of ranked.slice(0, Number(ctx.opts.top) || 10)) top.add(n);
    },
    nodeScale(n, ctx) {
      if (n.device.role === "multicast") return 3;
      const share = ctx.opts.rank === "rate" ? Math.log10(1 + n.rate) / maxLogRate : Math.sqrt(total(n.device) / maxBytes);
      return 3 + 20 * share;
    },
    nodeColor: (n) => (n.rate > 0 ? heat(0.2 + 0.8 * (Math.log10(1 + n.rate) / maxLogRate)) : heat(0)),
    forceLabel: (n) => top.has(n),
    suppressLabel: (n) => !top.has(n),
    nodeLabel: (n) => (top.has(n) ? `${fmtBytes(n.rate, true)} · ${fmtBytes(total(n.device))} total` : undefined),
    linkColor: (l) => heat(l.flow.rate > 0 ? 0.2 + 0.8 * (Math.log10(1 + l.flow.rate) / maxLogRate) : 0.05),
  };
})();

/** Which services the network talks to: internet hosts clustered by organisation with volume totals. */
export const services: ViewMode = (() => {
  interface Org { name: string; color: number; bytes: number; hosts: number; rate: number; x: number; y: number; z: number }
  const orgs = new Map<string, Org>();
  const orgOfNode = new Map<GNode, Org>();
  const R = 640;
  return {
    id: "services",
    label: "Services",
    hint: "Internet hosts are pulled into clusters by organisation (registrable domain of their TLS/rDNS name); cluster tags show host count and volume.",
    options: [
      { key: "sort", label: "arrange by", values: [["bytes", "volume"], ["hosts", "host count"], ["name", "name"]], default: "bytes" },
      { key: "pool", label: "singletons", values: [["keep", "keep"], ["pool", "pool into “other”"]], default: "keep" },
    ],
    legend: () => [
      { color: css(ROLE_COLOR.lan), label: "LAN" }, { color: css(ROLE_COLOR.self), label: "this host" },
      { color: "conic-gradient(#ef5350,#ab47bc,#29b6f6,#26a69a,#ffee58,#ff7043,#ef5350)", label: "one colour per organisation" },
    ],
    prepare(ctx) {
      orgs.clear(); orgOfNode.clear();
      const tmp = new Map<string, GNode[]>();
      for (const n of ctx.nodes.values()) {
        if (!n.visible || !isInternet(n)) continue;
        const o = orgOf(n.device);
        (tmp.get(o) ?? tmp.set(o, []).get(o)!).push(n);
      }
      if (ctx.opts.pool === "pool") {
        const pooled: GNode[] = [];
        for (const [o, ns] of [...tmp]) if (ns.length === 1 && o.startsWith("unnamed")) { pooled.push(...ns); tmp.delete(o); }
        if (pooled.length) tmp.set("other", pooled);
      }
      for (const [name, ns] of tmp) {
        const org: Org = { name, color: hashColor(name), bytes: 0, hosts: ns.length, rate: 0, x: 0, y: 0, z: 0 };
        for (const n of ns) { org.bytes += total(n.device); org.rate += n.rate; orgOfNode.set(n, org); }
        orgs.set(name, org);
      }
      const list = [...orgs.values()].sort(
        ctx.opts.sort === "hosts" ? (a, b) => b.hosts - a.hosts : ctx.opts.sort === "name" ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.bytes - a.bytes,
      );
      // anchors on a ring, alternating above/below the LAN plane so neighbouring clusters do not merge
      list.forEach((o, i) => {
        const a = (i / Math.max(1, list.length)) * Math.PI * 2;
        o.x = Math.cos(a) * R; o.z = Math.sin(a) * R; o.y = 60 + (i % 2 ? 110 : -110) * (list.length > 6 ? 1 : 0.3);
      });
    },
    shellStrength: (n) => (isInternet(n) ? 0 : undefined),
    charge: (n) => (isInternet(n) ? -35 : undefined),
    force(nodes, alpha) {
      const k = 0.09 * alpha;
      for (const n of nodes) {
        const o = orgOfNode.get(n);
        if (!o) continue;
        n.vx = (n.vx ?? 0) + (o.x - (n.x ?? 0)) * k;
        n.vy = (n.vy ?? 0) + (o.y - (n.y ?? 0)) * k;
        n.vz = (n.vz ?? 0) + (o.z - (n.z ?? 0)) * k;
      }
    },
    nodeColor: (n) => orgOfNode.get(n)?.color,
    suppressLabel: (n, ctx) => isInternet(n) && n !== ctx.selected,
    linkColor: (l) => (orgOfNode.get(l.source) ?? orgOfNode.get(l.target))?.color,
    overlays(ctx) {
      const out: Overlay[] = [];
      for (const o of orgs.values()) {
        // tag sits at the cluster centroid, nudged outward
        let cx = 0, cy = 0, cz = 0, c = 0;
        for (const [n, org] of orgOfNode) if (org === o) { cx += n.x ?? 0; cy += n.y ?? 0; cz += n.z ?? 0; c++; }
        if (!c) continue;
        cx /= c; cy /= c; cz /= c;
        const len = Math.hypot(cx, cz) || 1;
        out.push({ id: o.name, x: cx + (cx / len) * 40, y: cy + 26, z: cz + (cz / len) * 40, html: `<b style="color:${css(o.color)}">${o.name}</b><small>${o.hosts} host${o.hosts === 1 ? "" : "s"} · ${fmtBytes(o.bytes)}${o.rate > 0 ? ` · ${fmtBytes(o.rate, true)}` : ""}</small>` });
      }
      void ctx;
      return out;
    },
  };
})();

/** What protocols are in play: edges and devices coloured by the dominant port category. */
export const protocols: ViewMode = (() => {
  const catByLink = new Map<string, ProtoCat>();
  const catByNode = new Map<GNode, ProtoCat>();
  return {
    id: "protocols",
    label: "Protocols",
    hint: "Edges coloured by protocol family (from ports); each device takes the colour of the family that moved most of its bytes. Focus one family to dim the rest.",
    options: [
      { key: "focus", label: "focus", values: [["all", "all"], ...PROTO_CATS.map((c): [string, string] => [c.id, c.label])], default: "all" },
    ],
    legend: () => PROTO_CATS.map((c) => ({ color: css(c.color), label: c.label, line: true })),
    prepare(ctx) {
      catByLink.clear(); catByNode.clear();
      const perNode = new Map<GNode, Map<ProtoCat, number>>();
      for (const l of ctx.links.values()) {
        if (!isReal(l)) continue;
        const c = categorize(l.flow.ports);
        catByLink.set(l.id, c);
        for (const n of [l.source, l.target]) {
          const m = perNode.get(n) ?? perNode.set(n, new Map()).get(n)!;
          m.set(c, (m.get(c) ?? 0) + l.flow.bytes + 1);
        }
      }
      for (const [n, m] of perNode) {
        let best: ProtoCat | undefined, bb = -1;
        for (const [c, b] of m) if (b > bb) { bb = b; best = c; }
        if (best) catByNode.set(n, best);
      }
    },
    nodeColor: (n) => catByNode.get(n)?.color ?? 0x3b4252,
    linkColor: (l) => catByLink.get(l.id)?.color,
    linkBright(l, ctx, base) {
      const f = ctx.opts.focus;
      if (!f || f === "all") return base;
      const c = catByLink.get(l.id);
      return c?.id === f ? Math.max(base, 0.75) : base * 0.12;
    },
    forceLabel: (n, ctx) => ctx.opts.focus !== "all" && catByNode.get(n)?.id === ctx.opts.focus,
    nodeLabel(n, ctx) {
      const c = catByNode.get(n);
      return c && (ctx.opts.focus === "all" ? n.device.role !== "internet" : true) ? `mostly ${c.short}` : undefined;
    },
  };
})();

/** Layered flow: internet on top, gateway, then LAN, then local; edges fade between the role colours. */
export const layers: ViewMode = (() => {
  const target = new Map<GNode, [number, number, number]>();
  const topInternet = new Set<GNode>();
  let maxBytes = 1;
  const Y = { internet: 380, gateway: 170, self: 0, lan: 0, local: -230, multicast: 0 } as const;
  return {
    id: "layers",
    label: "Layers",
    hint: "Sankey-style: internet destinations on top, gateway, then LAN devices, then containers/tunnels. Ordered left→right by volume; edge brightness = volume.",
    options: [{ key: "sort", label: "order by", values: [["bytes", "volume"], ["rate", "current rate"], ["name", "name"]], default: "bytes" }],
    camera: [0, 80, 1150],
    legend: () => [
      { color: css(ROLE_COLOR.internet), label: "internet (top)" }, { color: css(ROLE_COLOR.gateway), label: "gateway" },
      { color: css(ROLE_COLOR.lan), label: "LAN" }, { color: css(ROLE_COLOR.self), label: "this host" },
      { color: css(ROLE_COLOR.local), label: "local (bottom)" }, { color: css(ROLE_COLOR.multicast), label: "multicast (behind)" },
    ],
    prepare(ctx) {
      target.clear(); topInternet.clear(); maxBytes = 1;
      const rows: Record<string, GNode[]> = { internet: [], gateway: [], lan: [], local: [], multicast: [] };
      for (const n of ctx.nodes.values()) {
        if (!n.visible) continue;
        rows[n.device.role === "self" ? "lan" : n.device.role].push(n);
      }
      for (const l of ctx.links.values()) if (isReal(l)) maxBytes = Math.max(maxBytes, l.flow.bytes);
      const cmp = ctx.opts.sort === "rate" ? (a: GNode, b: GNode) => b.rate - a.rate || total(b.device) - total(a.device)
        : ctx.opts.sort === "name" ? (a: GNode, b: GNode) => displayName(a.device).localeCompare(displayName(b.device))
        : (a: GNode, b: GNode) => total(b.device) - total(a.device);
      for (const r of Object.values(rows)) r.sort(cmp);
      for (const [n, t] of gridTargets(rows.internet, Y.internet, 0, 40, 30, 40)) target.set(n, t);   // extra rows stack upward
      for (const [n, t] of gridTargets(rows.gateway, Y.gateway, 0, 4, 80, 0)) target.set(n, t);
      for (const [n, t] of gridTargets(rows.lan, Y.lan, 0, 18, 68, -70, 26)) target.set(n, t);         // wrap downward, staggered
      for (const [n, t] of gridTargets(rows.local, Y.local, 0, 18, 68, -70, 26)) target.set(n, t);
      for (const [n, t] of gridTargets(rows.multicast, Y.multicast, -320, 24, 50, -60)) target.set(n, t);
      for (const n of rows.internet.slice(0, 14)) topInternet.add(n);
    },
    shellStrength: () => 0,
    charge: () => -12,
    linkStrength: () => 0,
    flatten: false,
    force(nodes, alpha) {
      const k = 0.14 * alpha;
      for (const n of nodes) {
        const t = target.get(n);
        if (!t) continue;
        n.vx = (n.vx ?? 0) + (t[0] - (n.x ?? 0)) * k;
        n.vy = (n.vy ?? 0) + (t[1] - (n.y ?? 0)) * k;
        n.vz = (n.vz ?? 0) + (t[2] - (n.z ?? 0)) * k;
      }
    },
    nodeScale: (n) => (n.device.role === "multicast" ? 3 : 4 + Math.min(8, Math.log10(1 + total(n.device)) * 0.8)),
    forceLabel: (n) => topInternet.has(n),
    linkColor: (l) => [ROLE_COLOR[l.source.device.role], ROLE_COLOR[l.target.device.role]],
    linkBright(l, _ctx, base) {
      if (!isReal(l)) return 0;
      const vol = Math.log10(1 + l.flow.bytes) / Math.log10(1 + maxBytes);
      return Math.max(0.1 + 0.7 * vol, base * 0.8);
    },
  };
})();

/** Security watch: things worth a second look — new devices, plaintext protocols, LAN devices talking straight out. */
export const watch: ViewMode = (() => {
  interface Flags { isNew: boolean; plain: Set<string>; direct: number }
  const flags = new Map<GNode, Flags>();
  const linkPlain = new Map<string, string[]>();
  const linkDirect = new Set<string>();
  const WINDOW: Record<string, number> = { "10m": 600, "1h": 3600, "24h": 86400, "7d": 7 * 86400 };
  const C = { new: 0xffa726, plain: 0xef5350, direct: 0xffca28, quiet: 0x2b3240, quietLink: 0x2a3140 };
  const flag = (n: GNode) => flags.get(n) ?? { isNew: false, plain: new Set<string>(), direct: 0 };
  return {
    id: "watch",
    label: "Watch",
    hint: "Everything is grey except what deserves attention: devices that appeared after monitoring began, unencrypted protocols, and LAN devices talking to the internet on their own.",
    options: [
      { key: "newWithin", label: "new within", values: [["10m", "10 min"], ["1h", "1 hour"], ["24h", "24 hours"], ["7d", "7 days"]], default: "1h" },
      { key: "direct", label: "LAN → internet", values: [["show", "highlight"], ["hide", "ignore"]], default: "show" },
    ],
    legend: () => [
      { color: css(C.new), label: "new device on the network" }, { color: css(C.plain), label: "plaintext protocol", line: true },
      { color: css(C.direct), label: "LAN device ↔ internet directly", line: true }, { color: css(C.quiet), label: "nothing notable" },
    ],
    prepare(ctx) {
      flags.clear(); linkPlain.clear(); linkDirect.clear();
      const win = WINDOW[ctx.opts.newWithin] ?? 3600;
      // "new" is relative to the monitoring baseline: a device that showed up in the first two minutes of
      // history was simply there when we started looking, not new
      let baseline = Infinity;
      for (const n of ctx.nodes.values()) if (n.device.first_seen) baseline = Math.min(baseline, n.device.first_seen);
      for (const n of ctx.nodes.values()) {
        const fs = n.device.first_seen;
        const r = n.device.role;
        const isNew = (r === "lan" || r === "local") && ctx.now - fs < win && fs - baseline > 120;
        flags.set(n, { isNew, plain: new Set(), direct: 0 });
      }
      for (const l of ctx.links.values()) {
        if (!isReal(l)) continue;
        const a = l.source, b = l.target;
        const plain = l.flow.ports.filter((p) => PLAIN_PORTS.has(p));
        // unencrypted DNS is normal to the gateway; to anyone else it is worth seeing
        if (l.flow.ports.includes("udp/53") && a.id !== ctx.gateway && b.id !== ctx.gateway) plain.push("udp/53");
        if (plain.length) {
          linkPlain.set(l.id, plain);
          for (const p of plain) { flag(a).plain.add(p); flag(b).plain.add(p); }
        }
        const lanEnd = a.device.role === "lan" ? a : b.device.role === "lan" ? b : null;
        if (ctx.opts.direct !== "hide" && lanEnd && (isInternet(a) || isInternet(b))) {
          linkDirect.add(l.id);
          flag(lanEnd).direct++;
        }
      }
    },
    nodeColor(n) {
      const f = flag(n);
      if (f.isNew) return C.new;
      if (f.plain.size) return C.plain;
      if (f.direct) return C.direct;
      return n.device.role === "gateway" || n.device.role === "self" ? undefined : C.quiet;
    },
    nodeScale(n) {
      const f = flag(n);
      return f.isNew || f.plain.size ? 9 : undefined;
    },
    forceLabel: (n) => { const f = flag(n); return f.isNew || f.plain.size > 0 || f.direct > 0; },
    suppressLabel: (n, ctx) => { const f = flag(n); return !(f.isNew || f.plain.size || f.direct) && n.device.role !== "gateway" && n.device.role !== "self" && n !== ctx.selected; },
    nodeLabel(n, ctx) {
      const f = flag(n);
      const parts: string[] = [];
      if (f.isNew) parts.push(`new · first seen ${ago(n.device.first_seen, ctx.now)}`);
      if (f.plain.size) parts.push(`plaintext ${[...f.plain].join(" ")}`);
      if (f.direct) parts.push(`→ internet ×${f.direct}`);
      return parts.length ? parts.join(" · ") : undefined;
    },
    linkColor: (l) => (linkPlain.has(l.id) ? C.plain : linkDirect.has(l.id) ? C.direct : C.quietLink),
    linkBright: (l, _ctx, base) => (linkPlain.has(l.id) ? Math.max(base, 0.85) : linkDirect.has(l.id) ? Math.max(base, 0.45) : base * 0.3),
  };
})();

export const MODES: ViewMode[] = [topology, talkers, services, protocols, layers, watch];
export const modeById = (id: string): ViewMode => MODES.find((m) => m.id === id) ?? topology;
export function defaultOpts(m: ViewMode): Record<string, string> {
  return Object.fromEntries((m.options ?? []).map((o) => [o.key, o.default]));
}
