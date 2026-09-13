import * as THREE from "three";
import type { GLink, GNode } from "../graph/scene";
import { KIND_COLOR, KIND_LABEL, KIND_ORDER, ROLE_COLOR, ago, deviceKind, displayName, fmtBytes, type Device, type DeviceKind, type Role, type WifiWatch, usefulName, unescapeDns } from "./types";
import { rName } from "./redact";

/**
 * Node shapes the scene can draw (index = `instanceShape`; the sphere cloud's vertex shader bends each instance
 * into one of these). 0 is the plain sphere; the rest are handed out per network by the Wi-Fi base.
 */
export const SHAPES = ["sphere", "cube", "star", "octahedron", "diamond", "disc"] as const;
export const SHAPE_GLYPH = ["●", "■", "✦", "◆", "◇", "▬"];
/** shapes handed to watched networks in list order (the first list entry gets a cube, the second a star, …) */
const NETWORK_SHAPES = [1, 2, 3, 4, 5];

/**
 * View modes. The scene owns nodes, links and the simulation; a mode answers questions about how to
 * style them (colour, size, labels, edge colour/brightness), may bend the layout (shell radii, custom
 * force, camera) and may float overlay labels in the scene. All hooks are optional and fall back to the
 * topology defaults, so a mode only has to say what it changes.
 */

/** Role → shell radius in force for a view (the scene's defaults with any plugin overrides applied). */
export type ShellSet = Readonly<Record<Role, number>>;

export interface ModeOption { key: string; label: string; values: [value: string, label: string][]; default: string }
export interface PluginField {
  key: string;
  label: string;
  hint?: string;
  type: "boolean" | "select" | "number" | "text";
  default?: string | number | boolean;
  values?: [string, string][];
  min?: number;
  max?: number;
  step?: number;
}
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
  /** horizontal layout stretch to fill a wide viewport (1 on ~16:9, higher on ultrawide) */
  spreadX: number;
  /** depth stretch; stays near 1 so the camera does not clip the far shell */
  spreadZ: number;
  /** how many ranked node labels the scene is willing to keep on */
  labelCount: number;
  /** mosaic tile (not the hero / full-window scene) — name budget is halved */
  smallPane?: boolean;
  /** Wi-Fi channel rotation status from the last snapshot (wifi graph base only) */
  watch?: WifiWatch;
}

/** Names a pane will keep. Small mosaic tiles use half the slider / top-N. */
export function paneLabelCap(ctx: ModeCtx, n = ctx.labelCount): number {
  return ctx.smallPane ? Math.max(1, Math.round(n * 0.5)) : n;
}

export interface ViewMode {
  id: string;
  label: string;
  hint: string;
  options?: ModeOption[];
  legend(opts: Record<string, string>): Legend[];
  /** camera position to glide to when the mode is entered */
  camera?: [number, number, number];
  /** the mode brings its own renderer instead of styling the 3D scene (main.ts swaps the scene out for it) */
  standalone?: boolean;
  /** YAML plugin id when this view was compiled from ~/.zoto-viz/plugins */
  pluginId?: string;
  /** graph plugin base (`wifi` / `bluetooth`) — scene swaps the IP snapshot for that RF view */
  graphBase?: string;
  /** arcade slot to run when standalone (plugin views reuse a shipped engine) */
  arcadeId?: string;
  /** plugin-cog fields; values are merged into opts */
  config?: PluginField[];
  /** once per snapshot, before styling; compute caches here */
  prepare?(ctx: ModeCtx): void;
  nodeColor?(n: GNode, ctx: ModeCtx): number | undefined;
  nodeScale?(n: GNode, ctx: ModeCtx): number | undefined;
  /** index into SHAPES; undefined / 0 is the sphere */
  nodeShape?(n: GNode, ctx: ModeCtx): number | undefined;
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
  /**
   * Radius the node should sit at, or undefined for the role default. `shells` are the role radii in force for
   * this view (a plugin's lanShell / internetShell already applied), so a mode can place a band relative to them.
   * The scene widens a shell that more nodes share than fit around it, so return the uncrowded radius.
   */
  shellRadius?(n: GNode, shells: ShellSet): number | undefined;
  shellStrength?(n: GNode): number | undefined;
  charge?(n: GNode): number | undefined;
  linkStrength?(l: GLink): number | undefined;
  flatten?: boolean;
  force?(nodes: GNode[], alpha: number, ctx: ModeCtx): void;
  overlays?(ctx: ModeCtx): Overlay[];
}

/** Capture the view is drawn from: IP/LAN, Wi-Fi, Bluetooth, or this-host CPU. */
export type ViewSource = "NET" | "AIR" | "BT" | "CPU";

export function viewSource(m: Pick<ViewMode, "id" | "graphBase" | "arcadeId">): ViewSource {
  if (m.graphBase === "wifi") return "AIR";
  if (m.graphBase === "bluetooth") return "BT";
  if (m.graphBase === "cpu" || m.arcadeId === "cpupong" || m.id === "cpupong" || m.id === "cpu") return "CPU";
  return "NET";
}

/** Menu / mosaic caption: `NET Topology`, `AIR SSIDs`, `CPU cores`. */
export function viewCaption(m: Pick<ViewMode, "id" | "label" | "graphBase" | "arcadeId">): string {
  const tag = viewSource(m);
  let name = m.label.trim().replace(/^(NET|AIR|BT|CPU)\s+/i, "");
  if (tag === "AIR") name = name.replace(/^Air\s+/i, "");
  return `${tag} ${name}`;
}

// ------------------------------------------------------------------ helpers

const css = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const total = (d: Device) => d.bytes_in + d.bytes_out;
const isReal = (l: GLink) => !l.id.startsWith("~");
const isInternet = (n: GNode) => n.device.role === "internet";
const other = (l: GLink, n: GNode) => (l.source === n ? l.target : l.source);

const HEAT: [number, number][] = [[0x3b4252, 0], [0x1e88e5, 0.25], [0x26c6da, 0.5], [0xffee58, 0.75], [0xff5252, 1]];
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
export function heat(t: number): number {
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
/** Stable colour for a name / address: the same string always gets the same palette entry. */
export function hashColor(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return PALETTE[(h >>> 0) % PALETTE.length];
}

const cpuPct = (d: Device) => Math.max(0, d.cpu ?? 0);
/** utilisation at which CPU colour saturates to red (percent of one core). */
export const CPU_RED = 80;
export function cpuHeat(pct: number): number {
  return heat(Math.min(1, Math.max(0, pct) / CPU_RED));
}
const fmtCpu = (n: number) => `${n >= 9.5 ? Math.round(n) : n.toFixed(1)}%`;
const isCpuCore = (id: string) => /^cpu:\d+$/.test(id);
const isCpuProc = (id: string) => id.startsWith("proc:");
const CPU_GROUP: ModeOption = {
  key: "group",
  label: "group",
  values: [["each", "each process"], ["name", "by name"]],
  default: "each",
};

function pinCpuLayout(nodes: GNode[], alpha: number, ctx: ModeCtx, coreR: number, procBand: number): void {
  const k = 0.16 * alpha;
  const cores = nodes.filter((n) => isCpuCore(n.id)).sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
  const n = Math.max(1, cores.length);
  cores.forEach((c, i) => {
    const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
    const tx = Math.cos(ang) * coreR * ctx.spreadX;
    const tz = Math.sin(ang) * coreR * ctx.spreadZ;
    c.vx = (c.vx ?? 0) + (tx - (c.x ?? 0)) * k;
    c.vy = (c.vy ?? 0) + (0 - (c.y ?? 0)) * k;
    c.vz = (c.vz ?? 0) + (tz - (c.z ?? 0)) * k;
  });
  const host = nodes.find((n) => n.id === "cpu:host");
  if (host) {
    const h = k * 1.4;
    host.vx = (host.vx ?? 0) + (0 - (host.x ?? 0)) * h;
    host.vy = (host.vy ?? 0) + (0 - (host.y ?? 0)) * h;
    host.vz = (host.vz ?? 0) + (0 - (host.z ?? 0)) * h;
  }
  const byCore = new Map(cores.map((c) => [c.id, c]));
  for (const p of nodes) {
    if (!isCpuProc(p.id)) continue;
    const core = byCore.get(p.device.ports?.[0] ?? "");
    if (!core) continue;
    const ox = (p.x ?? 0) - (core.x ?? 0);
    const oz = (p.z ?? 0) - (core.z ?? 0);
    const dist = Math.hypot(ox, oz) || 1;
    const want = procBand + Math.min(70, cpuPct(p.device) * 0.6);
    p.vx = (p.vx ?? 0) + ((core.x ?? 0) + (ox / dist) * want * ctx.spreadX - (p.x ?? 0)) * k * 0.7;
    p.vy = (p.vy ?? 0) + (36 - (p.y ?? 0)) * k * 0.45;
    p.vz = (p.vz ?? 0) + ((core.z ?? 0) + (oz / dist) * want * ctx.spreadZ - (p.z ?? 0)) * k * 0.7;
  }
}

const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne"]);
const ORG_ALIAS: Record<string, string> = { "1e100.net": "google.com", "googleusercontent.com": "google.com", "gstatic.com": "google.com", "ggpht.com": "google.com", "youtube.com": "google.com", "amazonaws.com": "aws", "cloudfront.net": "aws", "awsglobalaccelerator.com": "aws", "akamaitechnologies.com": "akamai", "akamaiedge.net": "akamai", "akadns.net": "akamai", "fbcdn.net": "facebook.com", "instagram.com": "facebook.com", "whatsapp.net": "facebook.com", "cloudflare-dns.com": "cloudflare.com", "one.one.one.one": "cloudflare.com", "azureedge.net": "microsoft.com", "windows.net": "microsoft.com", "msedge.net": "microsoft.com", "live.com": "microsoft.com", "office.com": "microsoft.com", "icloud.com": "apple.com", "mzstatic.com": "apple.com", "aaplimg.com": "apple.com" };
/** registrable domain of the best name we have for a device, with a few CDN families folded together */
export function orgOf(d: Device): string {
  const raw = (d.names ?? []).map(unescapeDns).find((x) => usefulName(x) && !x.startsWith("*"))
    ?? (d.names?.[0] ? unescapeDns(d.names[0]).replace(/^\*\./, "") : undefined)
    ?? d.hostnames?.map(unescapeDns).find(usefulName);
  if (raw && raw.includes(".") && usefulName(raw) && !raw.endsWith(".local")) {
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
function gridTargets(nodes: GNode[], y: number, z0: number, maxCols: number, spacing: number, dy: number, stagger = 0, spreadX = 1): Map<GNode, [number, number, number]> {
  const out = new Map<GNode, [number, number, number]>();
  const n = nodes.length;
  if (!n) return out;
  const cols = Math.min(n, maxCols);
  const rows = Math.ceil(n / cols);
  const sx = Math.min(spacing, 1200 / cols) * spreadX;
  nodes.forEach((node, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const inRow = r === rows - 1 ? n - r * cols : cols;
    out.set(node, [(c - (inRow - 1) / 2) * sx, y + r * dy + (c % 2 ? stagger : 0), z0]);
  });
  return out;
}

// ------------------------------------------------------------------ modes

export const topology: ViewMode = (() => {
  const seen = new Set<DeviceKind>();
  return {
    id: "topology",
    label: "Topology",
    hint: "Devices in shells around the gateway; sphere colour is the device type (phone, TV, printer…), edge colour is LAN vs internet, brightness is current rate.",
    prepare(ctx) {
      seen.clear();
      for (const n of ctx.nodes.values()) if (n.visible) seen.add(deviceKind(n.device));
    },
    nodeColor: (n) => KIND_COLOR[deviceKind(n.device)],
    legend: () => KIND_ORDER.filter((k) => seen.has(k)).map((k) => ({ color: css(KIND_COLOR[k]), label: KIND_LABEL[k] })),
  };
})();

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
      { key: "top", label: "label top", values: [["10", "10"], ["20", "20"], ["40", "40"], ["60", "60"], ["80", "80"]], default: "40" },
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
      for (const n of ranked.slice(0, paneLabelCap(ctx, Number(ctx.opts.top) || ctx.labelCount))) top.add(n);
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
        o.x = Math.cos(a) * R * ctx.spreadX; o.z = Math.sin(a) * R * ctx.spreadZ; o.y = 60 + (i % 2 ? 110 : -110) * (list.length > 6 ? 1 : 0.3);
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
      const ranked = [...orgs.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 16);
      const out: Overlay[] = [];
      for (const o of ranked) {
        // tag sits at the cluster centroid, nudged outward
        let cx = 0, cy = 0, cz = 0, c = 0;
        for (const [n, org] of orgOfNode) if (org === o) { cx += n.x ?? 0; cy += n.y ?? 0; cz += n.z ?? 0; c++; }
        if (!c) continue;
        cx /= c; cy /= c; cz /= c;
        const len = Math.hypot(cx, cz) || 1;
        out.push({ id: o.name, x: cx + (cx / len) * 40, y: cy + 26, z: cz + (cz / len) * 40, html: `<b style="color:${css(o.color)}">${rName(o.name)}</b><small>${o.hosts} host${o.hosts === 1 ? "" : "s"} · ${fmtBytes(o.bytes)}${o.rate > 0 ? ` · ${fmtBytes(o.rate, true)}` : ""}</small>` });
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
      for (const [n, t] of gridTargets(rows.internet, Y.internet, 0, 40, 30, 40, 0, ctx.spreadX)) target.set(n, t);   // extra rows stack upward
      for (const [n, t] of gridTargets(rows.gateway, Y.gateway, 0, 4, 80, 0, 0, ctx.spreadX)) target.set(n, t);
      for (const [n, t] of gridTargets(rows.lan, Y.lan, 0, 18, 68, -70, 26, ctx.spreadX)) target.set(n, t);         // wrap downward, staggered
      for (const [n, t] of gridTargets(rows.local, Y.local, 0, 18, 68, -70, 26, ctx.spreadX)) target.set(n, t);
      for (const [n, t] of gridTargets(rows.multicast, Y.multicast, -320, 24, 50, -60, 0, ctx.spreadX)) target.set(n, t);
      for (const n of rows.internet.slice(0, Math.min(12, paneLabelCap(ctx)))) topInternet.add(n);
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
    suppressLabel: (n) => n.device.role === "internet" && !topInternet.has(n),
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

/** This host's CPU cores in a ring; busy processes sit on the core they last ran on. */
export const cores: ViewMode = (() => {
  const top = new Set<GNode>();
  return {
    id: "cores",
    label: "CPU cores",
    graphBase: "cpu",
    hint: "Each cube is a logical CPU. Size and colour are utilisation. Processes with CPU sit on the core they last ran on. Group by name to fold threads of one program into a single node. Idle cores and processes fade over 5 seconds instead of vanishing.",
    camera: [0, 420, 720],
    flatten: false,
    options: [
      { key: "show", label: "show", values: [["busy", "busy processes"], ["all", "top processes"], ["cores", "cores only"]], default: "busy" },
      CPU_GROUP,
    ],
    legend: () => [
      { color: css(heat(0)), label: "idle core" }, { color: css(heat(0.5)), label: "busy" }, { color: css(heat(1)), label: "≥80%" },
      { color: css(ROLE_COLOR.self), label: "this host" }, { color: css(ROLE_COLOR.local), label: "process (on its core)" },
    ],
    prepare(ctx) {
      top.clear();
      const ranked = [...ctx.nodes.values()].filter((n) => n.visible && isCpuProc(n.id)).sort((a, b) => cpuPct(b.device) - cpuPct(a.device));
      for (const n of ranked.slice(0, paneLabelCap(ctx))) top.add(n);
    },
    nodeColor: (n) => (n.id === "cpu:host" ? ROLE_COLOR.self : cpuHeat(cpuPct(n.device))),
    nodeShape: (n) => (isCpuCore(n.id) ? 1 : n.id === "cpu:host" ? 3 : 0),
    nodeScale: (n) => {
      const p = cpuPct(n.device);
      if (n.id === "cpu:host") return 8 + Math.min(10, p / 10);
      if (isCpuCore(n.id)) return 6 + 18 * Math.min(1, p / 100);
      return 2.5 + 12 * Math.min(1, p / 80);
    },
    forceLabel: (n) => isCpuCore(n.id) || n.id === "cpu:host" || top.has(n),
    suppressLabel: (n) => isCpuProc(n.id) && !top.has(n),
    nodeLabel: (n) => fmtCpu(cpuPct(n.device)),
    linkColor: (l) => cpuHeat(Math.max(cpuPct(l.source.device), cpuPct(l.target.device))),
    linkBright: (l, _ctx, base) => Math.max(base, 0.12 + 0.75 * Math.min(1, Math.max(cpuPct(l.source.device), cpuPct(l.target.device)) / CPU_RED)),
    shellStrength: () => 0,
    charge: (n) => (isCpuProc(n.id) ? -28 : -70),
    linkStrength: () => 0.05,
    force: (nodes, alpha, ctx) => pinCpuLayout(nodes, alpha, ctx, 260, 88),
  };
})();

/** Processes on this host, sized by CPU, pulled toward the core they last ran on. */
export const load: ViewMode = (() => {
  const top = new Set<GNode>();
  return {
    id: "load",
    label: "CPU load",
    graphBase: "cpu",
    hint: "Processes sized by CPU share (percent of one core). Colour is heat. Each process is pulled toward the core it last ran on; cores stay in an inner ring. Group by name to sum threads of one program. Unused processes fade out over 5 seconds.",
    camera: [0, 480, 820],
    flatten: false,
    options: [
      { key: "who", label: "who", values: [["all", "everyone"], ["mine", "this user"], ["kernel", "kernel"]], default: "all" },
      { key: "min", label: "at least", values: [["0.5", "0.5%"], ["1", "1%"], ["5", "5%"], ["10", "10%"]], default: "0.5" },
      CPU_GROUP,
    ],
    legend: () => [
      { color: css(heat(0.2)), label: "cool" }, { color: css(heat(0.6)), label: "busy" }, { color: css(heat(1)), label: "≥80%" },
      { color: css(ROLE_COLOR.lan), label: "CPU core" }, { color: css(ROLE_COLOR.local), label: "this user" },
      { color: css(ROLE_COLOR.internet), label: "other users" }, { color: css(ROLE_COLOR.multicast), label: "kernel" },
    ],
    prepare(ctx) {
      top.clear();
      const ranked = [...ctx.nodes.values()].filter((n) => n.visible && isCpuProc(n.id)).sort((a, b) => cpuPct(b.device) - cpuPct(a.device));
      for (const n of ranked.slice(0, paneLabelCap(ctx, Number(ctx.opts.top) || ctx.labelCount))) top.add(n);
    },
    nodeColor: (n) => {
      if (isCpuCore(n.id)) return ROLE_COLOR.lan;
      if (n.id === "cpu:host") return ROLE_COLOR.self;
      return cpuHeat(cpuPct(n.device));
    },
    nodeShape: (n) => (isCpuCore(n.id) ? 1 : n.id === "cpu:host" ? 3 : 0),
    nodeScale: (n) => {
      const p = cpuPct(n.device);
      if (n.id === "cpu:host") return 7;
      if (isCpuCore(n.id)) return 4 + 10 * Math.min(1, p / 100);
      return 3 + 18 * Math.min(1, p / 80);
    },
    forceLabel: (n) => top.has(n) || n.id === "cpu:host",
    suppressLabel: (n) => isCpuCore(n.id) || (isCpuProc(n.id) && !top.has(n)),
    nodeLabel: (n) => {
      if (isCpuProc(n.id)) {
        const core = n.device.ports?.[0]?.replace(/^cpu:/, "cpu");
        return `${fmtCpu(cpuPct(n.device))}${core ? ` · ${core}` : ""}`;
      }
      return fmtCpu(cpuPct(n.device));
    },
    linkColor: (l) => cpuHeat(Math.max(cpuPct(l.source.device), cpuPct(l.target.device))),
    linkBright: (l, _ctx, base) => Math.max(base * 0.4, 0.1 + 0.7 * Math.min(1, Math.max(cpuPct(l.source.device), cpuPct(l.target.device)) / CPU_RED)),
    shellStrength: () => 0,
    charge: (n) => (isCpuProc(n.id) ? -55 : -40),
    linkStrength: () => 0.03,
    force: (nodes, alpha, ctx) => pinCpuLayout(nodes, alpha, ctx, 200, 120),
  };
})();

/** NetPong: Logstalgia ("Apache Pong") for one host. Requests fly in from the left as balls, the paddle darts to
 *  return every one that was answered, unanswered ones pass through. Rendered by pong.ts, not the scene. */
export const netpong: ViewMode = {
  id: "netpong",
  label: "NetPong",
  standalone: true,
  hint: "Whoever asks is on the left, what they ask for on the right, busiest lanes on top: each request is a ball from its asker to the host:port it aims at. The paddle darts to return every answered request; unanswered balls pass through in red. Source is one device or a whole group (every device, internet hosts, the LAN, a pattern); target narrows the peers shown the same way. Click a known device to make it the source, anything else (or shift-click) to make it the target.",
  legend: () => [
    { color: "conic-gradient(#ef5350,#ab47bc,#29b6f6,#26a69a,#ffee58,#ff7043,#ef5350)", label: "request · coloured by asker" },
    { color: css(ROLE_COLOR.self), label: "source's own requests · paddle colour" },
    { color: "#66bb6a", label: "returned = answered", line: true },
    { color: "#ef5350", label: "missed = no answer", line: true },
  ],
};

/** Invaders: the internet as a formation of organisations descending on the LAN devices' cannons. Rendered by invaders.ts. */
export const invaders: ViewMode = {
  id: "invaders",
  label: "Invaders",
  standalone: true,
  hint: "Who is pulling data down, what is going up. One alien row per internet organisation, one alien per host; the row pulling the most bytes sits lowest, closest to the cannons. Cannons are the LAN devices: every outbound packet is a shot up to its host, every inbound packet a bomb down onto the device. The formation marches to the packet rate. A saucer announces a plaintext protocol or a new device.",
  legend: () => [
    { color: "conic-gradient(#ef5350,#ab47bc,#29b6f6,#26a69a,#ffee58,#ff7043,#ef5350)", label: "alien row = organisation · bomb = inbound packet" },
    { color: css(ROLE_COLOR.lan), label: "cannon = LAN device · shot = outbound packet" },
    { color: "#ef5350", label: "saucer · plaintext protocol" },
    { color: "#ffa726", label: "saucer · new device" },
  ],
};

/** Command: unsolicited inbound packets as missiles onto the LAN devices; landed = the device answered. Rendered by command.ts. */
export const command: ViewMode = {
  id: "command",
  label: "Command",
  standalone: true,
  hint: "What arrives unsolicited, and does anything answer. Cities are the LAN devices (taller = more ports served); every packet aimed at a city that is not the answer to something the city sent is a missile from the attacker's silo at the top, coloured by protocol family. Answered within 2.5 s: it lands (red) — your device talked to a stranger. RST or ICMP unreachable: intercepted (blue). No answer: it fizzles, dropped. One attacker on several targets in a second splits from one warhead — a scan. Discovery chatter and the LAN's requests to the gateway are flak.",
  legend: () => [
    { color: "#ef5350", label: "landed = the device answered" },
    { color: "#4fc3f7", label: "intercepted = refused (RST / unreachable)" },
    { color: "#9e9e9e", label: "fizzled = no answer, dropped" },
    { color: "#607d8b", label: "flak = discovery / expected LAN chatter", line: true },
    ...PROTO_CATS.filter((c) => ["tls", "dns", "plain", "remote"].includes(c.id)).map((c) => ({ color: css(c.color), label: `trail · ${c.short}`, line: true })),
  ],
};

/** Frogger: each connection a LAN device opens hops through the stages of getting connected. Rendered by frogger.ts. */
export const frogger: ViewMode = {
  id: "frogger",
  label: "Frogger",
  standalone: true,
  hint: "Do connections get established, and where do they die. Every connection a LAN device opens is a frog that hops from the bank through DNS (waiting for an address), the median (resolved), connect (SYN / QUIC Initial out), handshake (Client Hello out) and data (waiting for the first byte back) to the lily pad of the organisation it reached. NXDOMAIN, a blocked 0.0.0.0 answer, a RST, a TLS alert or silence past the stage's timeout squashes it where it stood. Cars are the lane's other packets that second.",
  legend: () => [
    { color: "conic-gradient(#ef5350,#ab47bc,#29b6f6,#26a69a,#ffee58,#ff7043,#ef5350)", label: "frog · coloured by device" },
    { color: "#66bb6a", label: "home = connected, data flowing" },
    { color: "#ef5350", label: "squashed = failed at that stage" },
    { color: css(0x26a69a), label: "DNS lane", line: true }, { color: css(0x29b6f6), label: "connect lane", line: true },
    { color: css(0x7e57c2), label: "handshake lane", line: true }, { color: css(0x66bb6a), label: "data lane", line: true },
  ],
};

/** CPU Pong: this host's processes vs cores. Rendered by cpupong.ts. */
export const cpupong: ViewMode = {
  id: "cpupong",
  label: "CPU Pong",
  standalone: true,
  hint: "This host's scheduler as Pong. Processes on the left, logical CPUs on the right. Each sample of a busy process is a ball to the core it last ran on. The paddle returns it unless that core is over 80%; then the ball passes through in red. Under load the paddle splits: one half covers the upper cores, the other the lower cores. Under high load each half fires lasers at busy timeslices it cannot cover. Group by name to fold threads of one program.",
  legend: () => [
    { color: "conic-gradient(#ef5350,#ab47bc,#29b6f6,#26a69a,#ffee58,#ff7043,#ef5350)", label: "timeslice · coloured by process" },
    { color: css(ROLE_COLOR.self), label: "paddle · upper / lower cores" },
    { color: "#d4ff4a", label: "laser intercept · high load", line: true },
    { color: "#66bb6a", label: "returned = core under 80%", line: true },
    { color: "#ef5350", label: "missed = core over 80%", line: true },
  ],
};

/** Comma-separated watch list from the plugin cog → SSIDs, in order, without blanks or repeats. */
export function parseWatchList(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const s of (raw ?? "").split(",")) {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Access points and stations heard on Wi-Fi (beacons, probes, decrypted data). Used as a graph plugin base. */
export const wifi: ViewMode = (() => {
  const seen = new Set<string>();
  const hidden = new Set<GNode>();
  let watchList: string[] = [];
  let watch: WifiWatch | undefined;
  let homeSsid = "";
  let now = 0;
  /** the network a node belongs to: an AP's SSID, a station's AP's SSID, this host's network for the IP-side nodes */
  const ssidOf = (d: Device): string => {
    if (d.ssid) return d.ssid;
    if (d.ip.startsWith("ap:")) return displayName(d) || "";
    if (d.ip.startsWith("sta:")) return "";
    return d.role === "internet" || d.role === "multicast" ? "" : homeSsid;
  };
  const shapeOf = (ssid: string): number => {
    const i = watchList.indexOf(ssid);
    return i < 0 ? 0 : NETWORK_SHAPES[i % NETWORK_SHAPES.length]!;
  };
  const status = (): string | undefined => {
    const w = watch;
    if (!w) return undefined;
    if (!w.tuned) return watchList.length ? "no monitor-mode radio: nothing hops, scan only" : undefined;
    const plan = w.plan;
    const here = `radio ch${w.tuned}${w.width > 20 ? ` / ${w.width} MHz` : ""}`;
    if (!w.rotate) return `${here} · rotation paused`;
    if (!watchList.length && !w.other) return undefined;
    if (!plan.length) return `${here} · watched networks not in the scan yet`;
    const listening = w.slot.length ? ` · hearing ${w.slot.join(", ")}` : " · off plan";
    if (plan.length > 1 && w.hops === 0 && now - w.since > 2 * w.dwell) {
      return `${here}${listening} · hopper not running: sudo systemctl restart zoto-viz-wifi-monitor@${w.iface || "<radio>"}`;
    }
    const left = w.slot.length ? Math.max(0, Math.round(w.dwell - (now - w.since))) : 0;
    const next = w.next ? ` · next ch${w.next.chan} (${w.next.ssids.join(", ")}) in ${left}s` : "";
    return `${here}${listening}${next} · ${plan.length} channel${plan.length === 1 ? "" : "s"} in rotation`;
  };
  return {
    id: "wifi",
    label: "Wi-Fi",
    graphBase: "wifi",
    hint: "SSIDs and access points. LAN and internet traffic is drawn via the gateway (config: ours = this host's default route). Other radios of the same mesh sit around it, stations in a band outside them, foreign networks on the outer shell. Colour is the SSID; shape is the network's place in the watch list. The monitor-mode radio hops through the watched networks' channels in turn, and a network keeps its last state while the radio is elsewhere; NetworkManager's scan fills in the rest.",
    config: [
      { key: "gateway", label: "gateway IP", type: "text", default: "ours", hint: "ours is the detected default-route gateway. Set an IP to override." },
      { key: "watch", label: "watch SSIDs", type: "text", default: "", hint: "Networks the monitor radio listens to in turn, comma-separated. The order gives the shape: ■ cube, ✦ star, ◆ octahedron, ◇ diamond, ▬ disc; every other network is a ● sphere. Each network keeps its last state while the radio is on another channel." },
      { key: "other", label: "other networks too", type: "boolean", default: false, hint: "Also rotate through every other network the scan hears (up to 10 channels in all)." },
      { key: "dwell", label: "seconds per channel", type: "number", default: 60, min: 10, max: 300, step: 10, hint: "How long the radio stays on each channel before hopping on." },
      { key: "rotate", label: "rotate", type: "boolean", default: true, hint: "Off parks the radio on this host's own channel; the list and the shapes stay." },
    ],
    options: [
      { key: "show", label: "show", values: [["all", "APs and clients"], ["aps", "access points"], ["ours", "this SSID"]], default: "all" },
    ],
    legend: () => {
      const items: Legend[] = [];
      const hearing = new Set(watch?.slot ?? []);
      const named = new Set<string>();
      for (const s of watchList) {
        named.add(s);
        const heard = seen.has(s);
        items.push({
          color: heard ? css(hashColor(s)) : "transparent",
          label: `${SHAPE_GLYPH[shapeOf(s)]} ${s}${hearing.has(s) ? " · hearing" : heard ? "" : " · not heard yet"}`,
        });
      }
      for (const s of seen) {
        if (named.has(s)) continue;
        items.push({ color: css(hashColor(s)), label: `● ${s}${hearing.has(s) ? " · hearing" : ""}` });
      }
      const st = status();
      if (st) items.push({ color: "transparent", label: st });
      return items;
    },
    prepare(ctx) {
      seen.clear();
      hidden.clear();
      now = ctx.now;
      watch = ctx.watch;
      watchList = parseWatchList(ctx.opts.watch);
      homeSsid = "";
      const show = ctx.opts.show ?? "all";
      for (const n of ctx.nodes.values()) {
        if (n.device.role === "self" && n.device.ssid) homeSsid = n.device.ssid;
        else if (!homeSsid && n.device.role === "gateway" && n.device.ip.startsWith("ap:")) homeSsid = ssidOf(n.device);
      }
      for (const n of ctx.nodes.values()) {
        if (!n.visible) continue;
        const ap = n.device.ip.startsWith("ap:");
        const ours = n.device.role === "gateway" || n.device.role === "lan" || n.device.role === "self" || n.device.role === "local";
        if ((show === "aps" && !ap) || (show === "ours" && !ours)) { hidden.add(n); continue; }
        if (ap) seen.add(displayName(n.device) || n.device.mac || n.device.ip);
      }
    },
    nodeColor: (n) => {
      if (hidden.has(n)) return 0x1a1d24;
      if (n.device.role === "gateway") return ROLE_COLOR.gateway;
      if (n.device.role === "internet" && !n.device.ip.startsWith("ap:")) return ROLE_COLOR.internet;
      return hashColor(n.device.ip.startsWith("ap:") ? (displayName(n.device) || n.device.mac) : n.device.mac || n.device.ip);
    },
    nodeShape: (n) => (hidden.has(n) ? 0 : shapeOf(ssidOf(n.device))),
    nodeScale: (n) => hidden.has(n) ? 0.01 : n.device.ip.startsWith("ap:") ? 6 + Math.min(10, Math.log10(1 + total(n.device)) * 1.2) : 3.5,
    nodeLabel: (n) => {
      if (hidden.has(n)) return undefined;
      const rssi = (n.device.aliases ?? []).find((a) => a.endsWith(" dBm"))
        ?? (n.device.aliases ?? []).find((a) => a.endsWith("%"));
      const ch = (n.device.ports ?? []).find((p) => p.startsWith("ch"));
      const held = n.device.held ? `held · heard ${ago(n.device.last_seen, now)}` : undefined;
      const bits = [rssi, ch, held].filter(Boolean);
      return bits.length ? bits.join(" · ") : undefined;
    },
    forceLabel: (n) => !hidden.has(n) && (n.device.ip.startsWith("ap:") || n.device.role === "self" || n.device.role === "gateway"),
    suppressLabel: (n) => hidden.has(n),
    // Stations are the crowd, so they get the widest band: midway between the mesh radios and the outer shell.
    shellRadius: (n, shells) => n.device.ip.startsWith("sta:") ? Math.round((shells.lan + shells.internet) / 2) : undefined,
    // Foreign radios and internet hosts share the outer shell. Hold them to the ring plane like the LAN, so they
    // spread around it instead of piling up above and below the station cloud, which pushes them off the equator.
    force(nodes, alpha) {
      const k = 0.12 * alpha;
      for (const n of nodes) if (n.device.role === "internet") n.vy = (n.vy ?? 0) - (n.y ?? 0) * k;
    },
    camera: [0, 420, 720],
  };
})();

/** Bluetooth advertisers and this host's adapter. Used as a graph plugin base. */
export const bluetooth: ViewMode = (() => {
  const seen = new Set<DeviceKind>();
  return {
    id: "bluetooth",
    label: "Bluetooth",
    graphBase: "bluetooth",
    hint: "Bluetooth devices this adapter can hear. Colour is the device kind (bulb, speaker, phone…). Advertisements are decoded from HCI when capture is allowed; names also come from an inquiry scan. Links are this host talking to a device, not two neighbours talking to each other.",
    legend: () => KIND_ORDER.filter((k) => seen.has(k)).map((k) => ({ color: css(KIND_COLOR[k]), label: KIND_LABEL[k] })),
    prepare(ctx) {
      seen.clear();
      for (const n of ctx.nodes.values()) if (n.visible) seen.add(deviceKind(n.device));
    },
    nodeColor: (n) => KIND_COLOR[deviceKind(n.device)],
    nodeScale: (n) => (n.device.role === "self" ? 8 : 4 + Math.min(8, Math.log10(1 + n.device.packets) * 1.4)),
    nodeLabel: (n) => (n.device.aliases ?? []).find((a) => a.endsWith(" dBm")),
    forceLabel: (n) => n.device.role === "self" || !!(n.device.hostnames ?? []).length,
    camera: [0, 360, 640],
  };
})();

export const MODES: ViewMode[] = [topology, talkers, services, protocols, layers, watch, netpong, invaders, command, frogger, cores, load, cpupong];
/** 3D graph modes only — arcade views keep their own renderer and are skipped by dream cycling. */
export const GRAPH_MODES: ViewMode[] = MODES.filter((m) => !m.standalone);
/** Graph engines plugins may wrap, including RF bases that are not in the main view list. */
export const GRAPH_BASES: ViewMode[] = [...GRAPH_MODES, wifi, bluetooth, { ...cores, id: "cpu", label: "CPU" }];

let pluginModes: ViewMode[] = [];
export function setPluginModes(modes: ViewMode[]): void { pluginModes = modes; }
export function allModes(): ViewMode[] { return [...MODES, ...pluginModes]; }
export const modeById = (id: string): ViewMode => allModes().find((m) => m.id === id) ?? topology;
export function defaultOpts(m: ViewMode): Record<string, string> {
  const opts = Object.fromEntries((m.options ?? []).map((o) => [o.key, o.default]));
  for (const f of m.config ?? []) {
    if (opts[f.key] !== undefined) continue;
    if (f.type === "boolean") opts[f.key] = f.default === true || f.default === "true" || f.default === "1" ? "1" : "0";
    else if (f.default !== undefined) opts[f.key] = String(f.default);
    else if (f.type === "number") opts[f.key] = String(f.min ?? 0);
    else if (f.type === "select") opts[f.key] = f.values?.[0]?.[0] ?? "";
    else opts[f.key] = "";
  }
  return opts;
}
