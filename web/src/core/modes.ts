import * as THREE from "three";
import type { GLink, GNode } from "../graph/scene";
import type { FabricKind } from "../graph/fabric";
import { KIND_COLOR, KIND_LABEL, KIND_ORDER, ROLE_COLOR, ago, deviceKind, displayName, fmtBytes, type Device, type DeviceKind, type Role, type WifiWatch, usefulName, unescapeDns } from "./types";
import { rName } from "./redact";
import {
  cgroupTree, diskColumns, gpuPodium, memoryBubbles, pullToward,
  socketBipartite, udevClusters, unitGrid, type SysLayoutNode,
} from "./sys-layouts";

/**
 * Node shapes the scene can draw (index = `instanceShape`; the sphere cloud's vertex shader bends each instance
 * into one of these). 0 is the plain sphere; the rest are handed out per network by the Wi-Fi base.
 */
export const SHAPES = ["sphere", "cube", "star", "octahedron", "diamond", "disc", "drone"] as const;
export const SHAPE_GLYPH = ["●", "■", "✦", "◆", "◇", "▬", "✈"];
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
  type: "boolean" | "select" | "number" | "text" | "textarea";
  default?: string | number | boolean;
  values?: [string, string][];
  min?: number;
  max?: number;
  step?: number;
}
export interface Legend { color: string; label: string; line?: boolean }
export interface Overlay { id: string; x: number; y: number; z: number; html: string }

/** Per-frame node extras. Offsets are world units on top of the layout pose. */
export interface LiveLook {
  dx?: number;
  dy?: number;
  dz?: number;
  /** multiplier on the drawn sphere radius */
  scale?: number;
  /** added to the instance glow */
  glow?: number;
  /** 0–6 (sphere…drone), including in-between morphs */
  shape?: number;
  /** radians around +Y */
  spin?: number;
  /** hue shift in turns, −0.5…0.5 */
  hue?: number;
}

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
  /** catalog plugin id when this view was compiled from plugins/*.zip */
  pluginId?: string;
  /** graph plugin base (`wifi` / `bluetooth`) — scene swaps the IP snapshot for that RF view */
  graphBase?: string;
  /** arcade slot to run when standalone (plugin views reuse a shipped engine) */
  arcadeId?: string;
  /** catalog family for grouped menus: graph, arcade, or demoscene viz pack */
  kind?: "graph" | "arcade" | "demo";
  /** Hide the LAN graph so a plugin sky owns the frame. */
  stageOnly?: boolean;
  /** Settings → This view fields; values are merged into opts */
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
  /** per-frame look (seconds). Layers uses this for the internet stack's wave / shimmer / faces. */
  liveLook?(n: GNode, t: number, ctx: ModeCtx): LiveLook | undefined;
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
  /** Draw nodes and edges as an animated fabric mesh (tubes / cloth / ribbon). */
  fabric?: Exclude<FabricKind, "off">;
  force?(nodes: GNode[], alpha: number, ctx: ModeCtx): void;
  overlays?(ctx: ModeCtx): Overlay[];
}

/** Capture the view is drawn from: IP/LAN, Wi-Fi, Bluetooth, this-host CPU, Linux SYS, or host data sources. */
export type ViewSource = "NET" | "AIR" | "BT" | "CPU" | "SYS" | "SRC";

export const SYS_BASES = ["memory", "disk", "gpu", "sockets", "cgroups", "units", "udev", "bridge"] as const;
export type SysBase = (typeof SYS_BASES)[number];

export function isSysBase(base: string | undefined): base is SysBase {
  return !!base && (SYS_BASES as readonly string[]).includes(base);
}

export function viewSource(m: Pick<ViewMode, "id"> & Partial<Pick<ViewMode, "graphBase" | "arcadeId" | "pluginId" | "label">>): ViewSource {
  if (m.graphBase === "wifi") return "AIR";
  if (m.graphBase === "bluetooth") return "BT";
  if (m.graphBase === "sources" || m.arcadeId === "carousel" || m.id === "carousel" || m.pluginId === "carousel" || nasaStillView(m)) return "SRC";
  if (m.graphBase === "cpu" || m.arcadeId === "cpupong" || m.arcadeId === "doom" || m.id === "cpupong" || m.id === "doom" || m.id === "cpu") return "CPU";
  if (isSysBase(m.graphBase) || (m.id ? isSysBase(m.id) : false)) return "SYS";
  return "NET";
}

/** Carousel stills, plus legacy NASA-named catalog rows. */
export function nasaStillView(m: Pick<ViewMode, "id"> & Partial<Pick<ViewMode, "pluginId" | "label">>): boolean {
  if (m.pluginId === "carousel") return true;
  return /nasa/i.test(`${m.pluginId ?? ""} ${m.id ?? ""} ${m.label ?? ""}`);
}

/** Which arcade canvas to run. Stills instances share the contain-fit slideshow stage. */
export function arcadeSlotFor(m: Pick<ViewMode, "id" | "standalone" | "arcadeId" | "pluginId" | "label">): string | null {
  if (m.standalone) return m.arcadeId ?? m.id ?? null;
  if (m.pluginId === "carousel" || nasaStillView(m)) return "carousel";
  return null;
}

/** Menu / mosaic caption: `NET Topology`, `AIR SSIDs`, `CPU cores`, `SYS Memory`, `SRC Source web`. */
export function viewCaption(m: Pick<ViewMode, "id" | "label" | "graphBase" | "arcadeId">): string {
  const tag = viewSource(m);
  let name = m.label.trim().replace(/^(NET|AIR|BT|CPU|SYS|SRC)\s+/i, "");
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
/** Blend utilisation with package/device °C so RAPL/hwmon tints cores without a new view. */
export function cpuThermalHeat(d: Device, asCore = false): number {
  const pct = cpuPct(d);
  const temp = d.temp;
  if (!asCore || temp == null || !Number.isFinite(temp)) return cpuHeat(pct);
  const th = Math.min(1, Math.max(0, (temp - 45) / 40));
  return heat(0.55 * Math.min(1, pct / CPU_RED) + 0.45 * th);
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

/**
 * Layers internet stack: a traveling undulation, a glow shimmer, and a face-shape pattern that
 * periodically locks into a cube/octahedron checker. `col`/`row` are the grid slot from `gridTargets`.
 */
export function layersInternetLive(t: number, col: number, row: number, i: number): Required<LiveLook> {
  const phase = col * 0.62 + row * 1.05 + i * 0.04;
  const wave = Math.sin(t * (Math.PI * 2 / 5.4) + phase);
  const sway = Math.cos(t * (Math.PI * 2 / 7.2) + phase * 0.55);
  const shimmer = 0.5 + 0.5 * Math.sin(t * (Math.PI * 2 / 2.7) + phase * 1.65);
  const twinkle = Math.pow(0.5 + 0.5 * Math.sin(t * 6.8 + i * 2.1 + col * 0.4), 10);
  const u = (t / 8.5 + col / 7 + row / 4) % 2;
  const traveling = (u < 1 ? u : 2 - u) * 5;
  const patternize = 0.5 + 0.5 * Math.sin(t * (Math.PI * 2 / 15));
  const hold = Math.max(0, (patternize - 0.74) / 0.26);
  const patterned = (col + row) % 2 === 0 ? 1 : 3;
  const shape = traveling + (patterned - traveling) * hold;
  return {
    dx: 7 * sway,
    dy: 18 * wave,
    dz: 11 * Math.sin(t * 0.92 + col * 0.48 + row * 0.3),
    scale: 1 + 0.14 * wave + 0.1 * twinkle,
    glow: 0.18 * shimmer + 0.7 * twinkle,
    shape,
    spin: t * 0.48 + phase * 0.35,
    hue: 0.06 * Math.sin(t * 1.15 + phase) + 0.04 * twinkle,
  };
}

/** Fibonacci sphere / helix / stacked rings / waving sheet. Origin is above the floor so the camera looks up. */
export function droneFormationPoint(form: string, i: number, n: number, spreadX = 1): [number, number, number] {
  const count = Math.max(1, n);
  const t = count <= 1 ? 0 : i / (count - 1);
  if (form === "helix") {
    const ang = t * 2.35 * Math.PI * 2;
    return [Math.cos(ang) * 170 * spreadX, 130 + t * 340, Math.sin(ang) * 170];
  }
  if (form === "rings") {
    const rings = Math.min(4, Math.max(2, Math.round(Math.sqrt(count / 7))));
    const per = Math.ceil(count / rings);
    const ring = Math.min(rings - 1, Math.floor(i / per));
    const j = i - ring * per;
    const ang = (j / Math.max(1, per)) * Math.PI * 2 + ring * 0.35;
    const r = 100 + ring * 68;
    return [Math.cos(ang) * r * spreadX, 170 + ring * 78, Math.sin(ang) * r];
  }
  if (form === "wave") {
    const cols = Math.max(2, Math.ceil(Math.sqrt(count * 1.55)));
    const col = i % cols;
    const row = Math.floor(i / cols);
    const rows = Math.floor((count - 1) / cols);
    return [
      (col - (cols - 1) / 2) * 44 * spreadX,
      230 + 32 * Math.sin(col * 0.55 + row * 0.42),
      (row - rows / 2) * 44,
    ];
  }
  const phi = Math.acos(1 - 2 * (i + 0.5) / count);
  const theta = Math.PI * (1 + Math.sqrt(5)) * i;
  const r = 200;
  return [
    Math.sin(phi) * Math.cos(theta) * r * spreadX,
    300 + Math.cos(phi) * r * 0.82,
    Math.sin(phi) * Math.sin(theta) * r,
  ];
}

/** Per-frame hover / LED pulse / yaw so the fleet reads as flying craft, not parked spheres. */
export function droneShowLive(t: number, i: number, rate = 0): Required<LiveLook> {
  const phase = i * 0.37;
  const orbit = t * 0.32 + phase;
  const beat = Math.min(1, Math.log10(1 + rate) / 4);
  return {
    dx: 9 * Math.cos(orbit),
    dy: 11 * Math.sin(t * 0.78 + phase),
    dz: 9 * Math.sin(orbit),
    scale: 1.02 + 0.16 * beat,
    glow: 0.28 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2.5 + phase)) + 0.35 * beat,
    shape: 6,
    spin: t * 1.15 + phase,
    hue: 0.045 * Math.sin(t * 0.65 + phase),
  };
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
  const slot = new WeakMap<GNode, { col: number; row: number; i: number }>();
  let maxBytes = 1;
  const Y = { internet: 380, gateway: 170, self: 0, lan: 0, local: -230, multicast: 0 } as const;
  return {
    id: "layers",
    label: "Layers",
    hint: "Sankey-style: internet destinations on top, gateway, then LAN devices, then containers/tunnels. The internet stack undulates, shimmers, and cycles its faces. Ordered left→right by volume; edge brightness = volume.",
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
      const netCols = Math.min(rows.internet.length, 40) || 1;
      rows.internet.forEach((n, i) => slot.set(n, { i, col: i % netCols, row: Math.floor(i / netCols) }));
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
    liveLook(n, t) {
      const s = slot.get(n);
      if (!s || n.device.role !== "internet") return undefined;
      return layersInternetLive(t, s.col, s.row, s.i);
    },
    linkColor: (l) => [ROLE_COLOR[l.source.device.role], ROLE_COLOR[l.target.device.role]],
    linkBright(l, _ctx, base) {
      if (!isReal(l)) return 0;
      const vol = Math.log10(1 + l.flow.bytes) / Math.log10(1 + maxBytes);
      return Math.max(0.1 + 0.7 * vol, base * 0.8);
    },
  };
})();

/** Night drone light show: the LAN is a fleet in the sky; camera sits on the ground looking up. */
export const droneShow: ViewMode = (() => {
  const target = new Map<GNode, [number, number, number]>();
  const slot = new WeakMap<GNode, number>();
  const top = new Set<GNode>();
  let maxLogRate = 1;
  return {
    id: "drone-show",
    label: "Drone show",
    hint: "Devices as a 3D drone fleet. Camera is on the ground looking up. Formations: sphere, helix, rings, wave. Colour is current rate (LED heat); the craft model yaws and pulses.",
    options: [
      { key: "form", label: "formation", values: [["sphere", "sphere"], ["helix", "helix"], ["rings", "rings"], ["wave", "wave"]], default: "sphere" },
    ],
    camera: [0, 36, 760],
    flatten: false,
    legend: () => [
      { color: css(heat(0)), label: "idle LED" },
      { color: css(heat(0.45)), label: "cruise" },
      { color: css(heat(1)), label: "hot talker" },
      { color: css(ROLE_COLOR.gateway), label: "show control (gateway)" },
      { color: css(ROLE_COLOR.self), label: "this host (camera drone)" },
    ],
    prepare(ctx) {
      target.clear(); top.clear(); maxLogRate = 1;
      const fleet: GNode[] = [];
      const ground: GNode[] = [];
      for (const n of ctx.nodes.values()) {
        if (!n.visible) continue;
        maxLogRate = Math.max(maxLogRate, Math.log10(1 + n.rate));
        if (n.device.role === "gateway") target.set(n, [0, 72, 0]);
        else if (n.device.role === "self") target.set(n, [0, 28, 55]);
        else if (n.device.role === "multicast") ground.push(n);
        else fleet.push(n);
      }
      fleet.sort((a, b) => b.rate - a.rate || total(b.device) - total(a.device));
      const form = ctx.opts.form || "sphere";
      fleet.forEach((n, i) => {
        target.set(n, droneFormationPoint(form, i, fleet.length, ctx.spreadX));
        slot.set(n, i);
      });
      ground.forEach((n, i) => {
        const ang = (i / Math.max(1, ground.length)) * Math.PI * 2;
        target.set(n, [Math.cos(ang) * 240 * ctx.spreadX, 8, Math.sin(ang) * 240]);
      });
      for (const n of fleet.slice(0, paneLabelCap(ctx))) top.add(n);
    },
    shellStrength: () => 0,
    charge: () => -8,
    linkStrength: () => 0.04,
    force(nodes, alpha) {
      const k = 0.16 * alpha;
      for (const n of nodes) {
        const t = target.get(n);
        if (!t) continue;
        n.vx = (n.vx ?? 0) + (t[0] - (n.x ?? 0)) * k;
        n.vy = (n.vy ?? 0) + (t[1] - (n.y ?? 0)) * k;
        n.vz = (n.vz ?? 0) + (t[2] - (n.z ?? 0)) * k;
      }
    },
    nodeShape: (n) => (n.device.role === "gateway" ? 3 : n.device.role === "self" ? 4 : 6),
    nodeColor: (n) => (n.rate > 0 ? heat(0.18 + 0.82 * (Math.log10(1 + n.rate) / maxLogRate)) : heat(0.04)),
    nodeScale: (n) => {
      if (n.device.role === "gateway") return 9;
      if (n.device.role === "self") return 7;
      if (n.device.role === "multicast") return 3;
      return 4.2 + 10 * (Math.log10(1 + n.rate) / maxLogRate);
    },
    forceLabel: (n) => n.device.role === "gateway" || n.device.role === "self" || top.has(n),
    suppressLabel: (n) => n.device.role !== "gateway" && n.device.role !== "self" && !top.has(n),
    nodeLabel: (n) => (top.has(n) ? `${fmtBytes(n.rate, true)}` : undefined),
    liveLook(n, t) {
      if (n.device.role === "multicast") return undefined;
      const i = slot.get(n) ?? 0;
      const look = droneShowLive(t, i, n.rate);
      if (n.device.role === "gateway") return { ...look, shape: 3, scale: 1.05, spin: t * 0.35 };
      if (n.device.role === "self") return { ...look, shape: 4, scale: 1.02, spin: t * 0.55 };
      return look;
    },
    linkColor: (l) => [heat(0.35), heat(0.8)],
    linkBright: (l, _ctx, base) => (isReal(l) ? Math.max(0.12, base * 0.45) : 0.04),
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
    nodeColor: (n) => (n.id === "cpu:host" ? ROLE_COLOR.self : cpuThermalHeat(n.device, isCpuCore(n.id))),
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
      if (isCpuCore(n.id)) return cpuThermalHeat(n.device, true);
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

/** CPU Doom: this host's processes as demons in a first-person corridor. Rendered by doom.ts. */
export const doom: ViewMode = {
  id: "doom",
  label: "Doom",
  standalone: true,
  hint: "This host's scheduler as a first-person corridor loop. Logical CPUs sit on the hall; busy processes stand in the core they last ran on. The camera chases the busiest process down the corridor. WASD to take over (D is strafe here, not dream), drag to look, click to fire the rocket launcher. Walls stop you and the rocket. Rockets splash visually — they never kill a process.",
  legend: () => [
    { color: "conic-gradient(#ef5350,#ab47bc,#29b6f6,#26a69a,#ffee58,#ff7043,#ef5350)", label: "process · coloured by name" },
    { color: "#8b3a2a", label: "wall · a core room" },
    { color: "#c62828", label: "giblets · process is not killed" },
    { color: css(ROLE_COLOR.self), label: "this host · load in the HUD" },
  ],
};

/** 3D ocean: devices as craft, packet rate as sea state. Rendered by waves.ts. */
export const waves: ViewMode = {
  id: "waves",
  label: "Waves",
  standalone: true,
  hint: "The LAN as a 3D sea. The gateway is a lighthouse, this host a ship, other devices buoys and distant islands. Gerstner waves rise with packet rate; each burst leaves a splash. Drag to orbit, scroll to zoom.",
  legend: () => [
    { color: css(ROLE_COLOR.gateway), label: "lighthouse · gateway" },
    { color: css(ROLE_COLOR.self), label: "ship · this host" },
    { color: css(ROLE_COLOR.lan), label: "buoy · LAN device" },
    { color: css(ROLE_COLOR.internet), label: "island · internet host" },
  ],
};

/** 3D orbital graph: gateway sun, satellites and outer planets. Rendered by orbits.ts. */
export const orbits: ViewMode = {
  id: "orbits",
  label: "Orbits",
  standalone: true,
  hint: "An animated solar-system graph. The gateway is the sun; LAN devices are detailed satellites on inner rings; internet hosts are outer planets. Packets streak as sparks between orbits. Drag to inspect the models.",
  legend: () => [
    { color: css(ROLE_COLOR.gateway), label: "sun · gateway" },
    { color: css(ROLE_COLOR.lan), label: "satellite · LAN" },
    { color: css(ROLE_COLOR.internet), label: "planet · internet" },
    { color: "#ffc107", label: "spark · packet", line: true },
  ],
};

/** 3D double-helix graph: devices as nucleotides, packets zipper the rungs. Rendered by helix.ts. */
export const helix: ViewMode = {
  id: "helix",
  label: "Helix",
  standalone: true,
  hint: "A rotating double helix. Each device is a nucleotide model; rungs span the two strands. Packets walk the backbone as glowing charges. Busier talkers sit larger on the strand.",
  legend: () => [
    { color: css(ROLE_COLOR.lan), label: "nucleotide · device" },
    { color: "#eceff1", label: "rung · pair", line: true },
    { color: "#00acc1", label: "charge · packet" },
  ],
};

/** 3D skyline graph: talkers as towers. Rendered by skyline.ts. */
export const skyline: ViewMode = {
  id: "skyline",
  label: "Skyline",
  standalone: true,
  hint: "An animated city of talkers. Each device is a detailed tower; height follows current rate and historic packets. New packets launch light from the roof. Drag around the block.",
  legend: () => [
    { color: css(ROLE_COLOR.gateway), label: "tower · gateway" },
    { color: css(ROLE_COLOR.lan), label: "tower · LAN talker" },
    { color: css(ROLE_COLOR.internet), label: "tower · internet" },
    { color: "#ffee58", label: "roof pulse · packet" },
  ],
};

/** 3D Pac-Man maze: this host eats pellets (packets); talkers are ghosts. Rendered by pacman.ts. */
export const pacman: ViewMode = {
  id: "pacman",
  label: "Pac-Man",
  standalone: true,
  hint: "A 3D maze. Pac-Man is this host; ghosts are talkers; pellets are packets. Ticker words fly into the mouth, get munched, and yellow crumbs hop out and fall. The camera follows the chomp.",
  legend: () => [
    { color: "#ffee58", label: "Pac-Man · this host" },
    { color: "#ef5350", label: "ghost · talker" },
    { color: "#fff8e1", label: "pellet · packet" },
    { color: "#ffee58", label: "crumb · munched ticker" },
    { color: "#1565c0", label: "wall" },
  ],
};

/** 3D Tetris well: protocols drop as tetrominoes. Rendered by tetris.ts. */
export const tetris: ViewMode = {
  id: "tetris",
  label: "Tetris",
  standalone: true,
  hint: "A glass 3D well. Each packet becomes a bevelled tetromino coloured by protocol. Gravity follows packet rate; a full row clears. Pieces autoplay with a standard line-clear heuristic — rotate and slide into place, then drop.",
  legend: () => [
    { color: "#42a5f5", label: "TLS" },
    { color: "#ffee58", label: "DNS" },
    { color: "#66bb6a", label: "HTTP" },
    { color: "#ab47bc", label: "QUIC" },
    { color: "#ef5350", label: "SSH" },
  ],
};

/** NASA IOTD stills, full-viewport contain-fit slideshow. Rendered by carousel.ts. */
export const carousel: ViewMode = {
  id: "carousel",
  label: "Carousel",
  standalone: true,
  hint: "NASA Image of the Day stills fill the viewport. Each still slowly zooms and pans, then crossfades to the next. Large title and caption sit on the picture.",
  legend: () => [
    { color: "#f4e8c8", label: "still · zoom + pan" },
    { color: "#90caf9", label: "crossfade · next still" },
  ],
};

/** 3D Portal chambers: LAN and internet linked by orange/blue rings. Rendered by portal.ts. */
export const portal: ViewMode = {
  id: "portal",
  label: "Portal",
  standalone: true,
  hint: "Two test chambers. LAN on the left (orange portal), internet on the right (blue). Packets cross as energy orbs; devices are turrets and companion cubes. Drag to walk the set with the camera.",
  legend: () => [
    { color: "#ff6d00", label: "orange portal · into the internet" },
    { color: "#29b6f6", label: "blue portal · back to the LAN" },
    { color: "#f48fb1", label: "companion cube · gateway" },
    { color: "#90a4ae", label: "turret · device" },
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

/** Default / ceiling for how many Bluetooth advertisers the graph keeps. BLE random MACs otherwise flood it. */
export const BT_MAX_NODES = 32;
export const BT_MAX_NODES_CEILING = 64;

function btKeepScore(d: Device): number {
  if (d.role === "self") return 4;
  const ports = d.ports ?? [];
  if (d.role === "gateway" || ports.includes("connected") || ports.includes("paired")) return 3;
  if ((d.hostnames ?? []).length || (d.names ?? []).length) return 2;
  return 0;
}

function btRank(a: Device, b: Device): number {
  return btKeepScore(b) - btKeepScore(a) || b.last_seen - a.last_seen || b.packets - a.packets;
}

/** Keep this host, then named / connected advertisers, then the most recently heard, up to `opts.top`. */
export function capBluetoothDevices(devices: Device[], opts: Record<string, string> = {}): Device[] {
  const raw = Number(opts.top);
  const cap = Math.max(8, Math.min(BT_MAX_NODES_CEILING, Number.isFinite(raw) && raw > 0 ? Math.round(raw) : BT_MAX_NODES));
  if (devices.length <= cap) return devices;
  const ranked = [...devices].sort(btRank);
  const kept = ranked.slice(0, cap);
  const self = devices.find((d) => d.role === "self");
  if (self && !kept.some((d) => d.ip === self.ip)) kept[kept.length - 1] = self;
  return kept;
}

/** Bluetooth advertisers and this host's adapter. Used as a graph plugin base. */
export const bluetooth: ViewMode = (() => {
  const seen = new Set<DeviceKind>();
  return {
    id: "bluetooth",
    label: "Bluetooth",
    graphBase: "bluetooth",
    hint: "Bluetooth devices this adapter can hear. Colour is the device kind (bulb, speaker, phone…). Advertisements are decoded from HCI when capture is allowed; names also come from an inquiry scan. Links are this host talking to a device, not two neighbours talking to each other.",
    config: [
      {
        key: "top", label: "max nodes", type: "number", default: BT_MAX_NODES,
        min: 8, max: BT_MAX_NODES_CEILING, step: 4,
        hint: "Keep this host, then named / connected advertisers, then the most recently heard. BLE random addresses otherwise flood the graph.",
      },
    ],
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

/**
 * Host RSS / HTTP / file registry as a graph. Plugins wrap this with `base: sources`
 * so a view is not forced onto the LAN snapshot.
 */
export const sources: ViewMode = (() => {
  const SRC_KIND_COLOR: Record<string, number> = {
    hub: 0x42a5f5,
    rss: 0xffca28,
    http: 0x42a5f5,
    file: 0x66bb6a,
    journal: 0xab47bc,
    kmsg: 0xef5350,
  };
  const SRC_KIND_SHAPE: Record<string, number> = { rss: 0, http: 1, file: 4, journal: 2, kmsg: 1, hub: 2 };
  const top = new Set<GNode>();
  return {
    id: "sources",
    label: "Source web",
    graphBase: "sources",
    hint: "The host sources registry as a graph: each RSS feed, HTTP JSON document, local file, user journal, or kernel ring is a hub; titles, JSON leaves, and log lines are nodes. Not the LAN.",
    camera: [0, 280, 620],
    flatten: false,
    options: [
      { key: "kind", label: "kind", values: [
        ["all", "all kinds"], ["rss", "RSS"], ["http", "HTTP JSON"], ["file", "local files"],
        ["journal", "user journal"], ["kmsg", "kernel ring"],
      ], default: "all" },
    ],
    config: [
      {
        key: "top", label: "max nodes", type: "number", default: 64,
        min: 8, max: 120, step: 4,
        hint: "Hub plus feeds, then as many item / leaf / line nodes as fit.",
      },
    ],
    legend: () => [
      { color: css(SRC_KIND_COLOR.rss), label: "RSS item" },
      { color: css(SRC_KIND_COLOR.http), label: "HTTP JSON" },
      { color: css(SRC_KIND_COLOR.file), label: "file line" },
      { color: css(SRC_KIND_COLOR.journal ?? 0xab47bc), label: "journal" },
      { color: css(SRC_KIND_COLOR.kmsg ?? 0xef5350), label: "kmsg" },
      { color: css(SRC_KIND_COLOR.hub), label: "source / hub" },
    ],
    prepare(ctx) {
      top.clear();
      const ranked = [...ctx.nodes.values()]
        .filter((n) => n.visible && n.device.role !== "self")
        .sort((a, b) => (b.device.packets - a.device.packets) || a.id.localeCompare(b.id));
      for (const n of ranked.slice(0, paneLabelCap(ctx))) top.add(n);
    },
    nodeColor: (n) => SRC_KIND_COLOR[n.device.vendor] ?? hashColor(n.device.vendor || n.id),
    nodeScale: (n) => (n.device.role === "self" ? 10 : n.device.role === "gateway" ? 7 : 3.6 + Math.min(5, (n.device.names[0]?.length ?? 4) / 18)),
    nodeShape: (n) => SRC_KIND_SHAPE[n.device.vendor] ?? 0,
    nodeLabel: (n) => (n.device.role === "gateway" ? n.device.vendor : undefined),
    forceLabel: (n) => n.device.role === "self" || n.device.role === "gateway" || top.has(n),
  };
})();

function asSysNodes(nodes: Iterable<GNode>): SysLayoutNode[] {
  return [...nodes].map((n) => ({
    id: n.id,
    role: n.device.role,
    vendor: n.device.vendor,
    cpu: n.device.cpu,
    bytes_in: n.device.bytes_in,
    ports: n.device.ports,
  }));
}

const SYS_CHART: Record<SysBase, {
  flatten: boolean;
  camera: [number, number, number];
  hint: string;
  legend: string;
  edges: "none" | "struct" | "all";
  snap: number;
  place: (nodes: SysLayoutNode[], spreadX: number) => Map<string, [number, number, number]>;
}> = {
  memory: {
    flatten: true,
    camera: [0, 920, 36],
    hint: "2D packed bubbles: RAM pressure on a disc. PSI and swap sit on the inner ring; process size is RSS.",
    legend: "RSS share (bubbles)",
    edges: "none",
    snap: 0.55,
    place: memoryBubbles,
  },
  disk: {
    flatten: false,
    camera: [520, 130, 260],
    hint: "3D columns: block devices at the back, height is read+write bytes/s. Front row is processes doing I/O.",
    legend: "bytes/s (columns)",
    edges: "none",
    snap: 0.5,
    place: diskColumns,
  },
  gpu: {
    flatten: false,
    camera: [90, 150, 480],
    hint: "3D podium: each GPU is a card in front of this host. Height and heat are utilisation; aliases carry VRAM and watts.",
    legend: "GPU util (podium)",
    edges: "none",
    snap: 0.5,
    place: gpuPodium,
  },
  sockets: {
    flatten: true,
    camera: [0, 900, 40],
    hint: "2D bipartite: local processes on the left, TCP peers on the right. Internet peers sit farther out.",
    legend: "process ↔ peer",
    edges: "struct",
    snap: 0.55,
    place: socketBipartite,
  },
  cgroups: {
    flatten: true,
    camera: [0, 880, 50],
    hint: "2D tree: user.slice / system.slice by path depth. Node size is process count in the group.",
    legend: "cgroup tree",
    edges: "struct",
    snap: 0.5,
    place: (nodes, sx) => cgroupTree(nodes, sx),
  },
  units: {
    flatten: true,
    camera: [0, 940, 28],
    hint: "2D status grid: failed user units on the front row, running units behind. Red is failed.",
    legend: "failed / running",
    edges: "none",
    snap: 0.6,
    place: unitGrid,
  },
  udev: {
    flatten: false,
    camera: [380, 160, 300],
    hint: "3D class clusters: net, drm, block, input each get a ring. New devices lift; gone devices drop.",
    legend: "udev class",
    edges: "none",
    snap: 0.5,
    place: udevClusters,
  },
  bridge: {
    flatten: false,
    camera: [0, 420, 820],
    hint: "3D schematic: this host at the hub, one satellite per subsystem.",
    legend: "subsystems",
    edges: "all",
    snap: 0.35,
    place: (nodes, spreadX) => {
      const out = new Map<string, [number, number, number]>();
      const sats = nodes.filter((n) => n.id.startsWith("bridge:") && n.role !== "self");
      const hub = nodes.find((n) => n.role === "self");
      if (hub) out.set(hub.id, [0, 0, 0]);
      sats.forEach((n, i) => {
        const a = (i / Math.max(1, sats.length)) * Math.PI * 2 - Math.PI / 2;
        out.set(n.id, [Math.cos(a) * 200 * spreadX, 20, Math.sin(a) * 200]);
      });
      for (const n of nodes) if (!out.has(n.id)) out.set(n.id, [0, 0, 0]);
      return out;
    },
  },
};

/** Linux host graphs that are not CPU: memory/PSI, disk, GPU, sockets, cgroups, units, udev, bridge. */
function sysGraph(
  id: SysBase,
  label: string,
  hint: string,
  hub: string,
): ViewMode {
  const top = new Set<GNode>();
  const isHub = (n: GNode) => n.id === hub || n.device.role === "self";
  const chart = SYS_CHART[id];
  let targets = new Map<string, [number, number, number]>();
  return {
    id,
    label,
    graphBase: id,
    hint: chart.hint || hint,
    camera: chart.camera,
    flatten: chart.flatten,
    legend: () => [
      { color: css(heat(0.15)), label: "quiet" },
      { color: css(heat(0.6)), label: "busy" },
      { color: css(heat(1)), label: "hot" },
      { color: css(ROLE_COLOR.self), label: "this host" },
      { color: css(0x8ecae6), label: chart.legend },
    ],
    prepare(ctx) {
      top.clear();
      const ranked = [...ctx.nodes.values()]
        .filter((n) => n.visible && !isHub(n))
        .sort((a, b) => (cpuPct(b.device) - cpuPct(a.device)) || (b.device.bytes_in - a.device.bytes_in));
      for (const n of ranked.slice(0, paneLabelCap(ctx))) top.add(n);
      targets = chart.place(asSysNodes([...ctx.nodes.values()].filter((n) => n.visible)), ctx.spreadX);
    },
    force(nodes, alpha) {
      pullToward(nodes, targets, alpha, chart.snap);
    },
    nodeColor: (n) => {
      if (isHub(n)) return ROLE_COLOR.self;
      if (id === "units") return n.device.role === "internet" ? 0xff4d4d : 0x7ee8a0;
      if (id === "sockets") return n.id.startsWith("sock:peer:") ? (n.device.role === "internet" ? ROLE_COLOR.internet : 0x8ecae6) : 0xf4d35e;
      if (id === "udev") return n.device.role === "local" ? 0x5eead4 : n.device.role === "internet" ? 0xff6b4a : cpuHeat(cpuPct(n.device));
      if (id === "disk" && n.device.vendor === "block") return cpuHeat(Math.max(20, cpuPct(n.device)));
      return n.device.role === "internet" ? ROLE_COLOR.internet : cpuHeat(cpuPct(n.device));
    },
    nodeShape: (n) => {
      if (isHub(n)) return 3;
      if (id === "memory") return 0;
      if (id === "disk") return 1;
      if (id === "gpu") return 4;
      if (id === "sockets") return n.id.startsWith("sock:peer:") ? 5 : 1;
      if (id === "cgroups") return n.device.role === "gateway" ? 1 : 0;
      if (id === "units") return n.device.role === "internet" ? 2 : 1;
      if (id === "udev") return 2;
      return 0;
    },
    nodeScale: (n) => {
      const p = cpuPct(n.device);
      if (isHub(n)) {
        if (id === "memory" || id === "cgroups") return 8 + Math.min(5, p / 20);
        return 0.35;
      }
      if (id === "memory") return 4 + 18 * Math.min(1, p / 100);
      if (id === "gpu") return 12 + 14 * Math.min(1, p / 80);
      if (id === "disk" && n.device.vendor === "block") return 7 + 16 * Math.min(1, p / 80);
      if (id === "disk") return 4;
      if (id === "units") return 6;
      if (id === "cgroups") return 7 + 8 * Math.min(1, p / 40);
      if (id === "sockets") return 5;
      if (id === "udev") return 5;
      return 3 + 14 * Math.min(1, p / 80);
    },
    forceLabel: (n) => isHub(n) || top.has(n),
    suppressLabel: (n) => !isHub(n) && !top.has(n),
    nodeLabel: (n) => {
      const alias = (n.device.aliases ?? []).find((a) => /°C|W\b|\/s|avail|failed|running|gpu|procs|new|gone/.test(a));
      if (alias) return alias;
      const p = cpuPct(n.device);
      return p >= 1 ? fmtCpu(p) : undefined;
    },
    linkColor: (l) => {
      if (id === "sockets") return 0x8ecae6;
      if (id === "cgroups") return 0xb8c0cc;
      return cpuHeat(Math.max(cpuPct(l.source.device), cpuPct(l.target.device)));
    },
    linkBright: (l, _ctx, base) => {
      if (chart.edges === "none") return 0;
      if (chart.edges === "struct") {
        if (isHub(l.source) || isHub(l.target)) return 0;
        return Math.max(base * 0.7, 0.45);
      }
      return Math.max(base * 0.35, 0.1 + 0.7 * Math.min(1, Math.max(cpuPct(l.source.device), cpuPct(l.target.device)) / CPU_RED));
    },
    shellStrength: () => 0,
    charge: () => 0,
    linkStrength: () => 0,
  };
}

export const memory = sysGraph("memory", "Memory", "RAM, swap, PSI, and the fattest RSS processes. Size is share of RAM or pressure.", "mem:host");
export const disk = sysGraph("disk", "Disk I/O", "Block devices and processes by read+write bytes per second. Loop devices are dropped.", "disk:host");
export const gpu = sysGraph("gpu", "GPU", "DRM cards plus nvidia-smi when present. Size is utilisation; aliases carry VRAM and watts.", "gpu:host");
export const sockets = sysGraph("sockets", "Sockets", "This host's TCP sockets: process to remote peer. Distinct from the packet LAN graph.", "sock:host");
export const cgroups = sysGraph("cgroups", "Cgroups", "user.slice / system.slice tree. Node size is process count in the group.", "cg:root");
export const units = sysGraph("units", "User units", "systemd --user services. Failed units sit as internet-red; running units as LAN.", "unit:host");
export const udev = sysGraph("udev", "Devices", "sysfs class add/remove (net, drm, block, input, …). New and gone nodes flare for half a minute.", "udev:host");
export const bridge: ViewMode = (() => {
  const base = sysGraph(
    "bridge",
    "Syscon",
    "All local host systems on one schematic: CPU, RAM, disk, GPU, sockets, cgroups, user units, and devices.",
    "bridge:host",
  );
  const isSat = (n: GNode) => n.id.startsWith("bridge:") && n.device.role !== "self";
  return {
    ...base,
    camera: [0, 420, 820],
    nodeShape: (n, ctx) => (isSat(n) ? 4 : base.nodeShape?.(n, ctx) ?? 0),
    forceLabel: (n, ctx) => isSat(n) || !!base.forceLabel?.(n, ctx),
    overlays(ctx) {
      const out: Overlay[] = [];
      for (const n of ctx.nodes.values()) {
        if (!isSat(n) || !n.visible) continue;
        const tag = (n.device.names[0] || n.device.hostnames[0] || "").toUpperCase();
        const bit = (n.device.aliases ?? [])[0] ?? "";
        const hot = cpuPct(n.device) >= 70;
        out.push({
          id: n.id,
          x: n.x ?? 0,
          y: (n.y ?? 0) + 34,
          z: n.z ?? 0,
          html: `<b style="color:${hot ? "#ff6b4a" : "#7ee8ff"}">${rName(tag)}</b>${bit ? `<small>${rName(bit)}</small>` : ""}`,
        });
      }
      return out;
    },
  };
})();

/**
 * Graph engines plugins may wrap. These are wrap targets, not live menu rows.
 * wifi / bluetooth stay off-menu unless a catalog plugin wraps them; `cpu` aliases cores.
 */
export const GRAPH_BASES: ViewMode[] = [
  topology, talkers, services, protocols, layers, droneShow, watch, cores, load, wifi, bluetooth, sources,
  memory, disk, gpu, sockets, cgroups, units, udev, bridge,
  { ...cores, id: "cpu", label: "CPU" },
];
/** Arcade engines plugins may wrap (`engine: doom` → arcadeId). Not live menu rows. */
export const ARCADE_ENGINES: ViewMode[] = [
  netpong, invaders, command, frogger, cpupong, doom,
  waves, orbits, helix, skyline, pacman, tetris, portal, carousel,
];

let pluginModes: ViewMode[] = [];

/**
 * Unique view ids become catalog menu rows. Instances of one plugin tree
 * (`plugin:carousel` vs `plugin:carousel:apod`) stay separate. A later compiled
 * view with the same id is dropped (overlays are merged before compile).
 */
export function pluginMenuRows(modes: ViewMode[]): ViewMode[] {
  const seen = new Set<string>();
  const rows: ViewMode[] = [];
  for (const m of modes) {
    const key = m.id;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(m);
  }
  return rows;
}

export function setPluginModes(modes: ViewMode[]): void { pluginModes = pluginMenuRows(modes); }
/** Live menu: catalog plugin rows only. Host engines are wrap targets, not menu entries. */
export function allModes(): ViewMode[] { return pluginModes; }
/** Catalog graph plugins (not arcade). Dream cycling iterates this, not a hardcoded list. */
export function graphModes(): ViewMode[] { return allModes().filter((m) => !m.standalone); }

function isTopologyRow(m: ViewMode): boolean {
  return m.pluginId === "topology" || m.id === "plugin:topology" || m.id === "topology";
}

/** First catalog plugin, topology first when present; otherwise stable by plugin id. */
export function defaultCatalogMode(): ViewMode | undefined {
  const modes = allModes();
  if (!modes.length) return undefined;
  const topo = modes.find(isTopologyRow);
  if (topo) return topo;
  return [...modes].sort((a, b) => (a.pluginId ?? a.id).localeCompare(b.pluginId ?? b.id))[0];
}

/** Host wrap-target for `id`, or undefined. Never a catalog menu row. */
export function hostEngine(id: string): ViewMode | undefined {
  return GRAPH_BASES.find((m) => m.id === id) ?? ARCADE_ENGINES.find((m) => m.id === id);
}

/**
 * Resolve a view id against the catalog (exact id or pluginId). Missing / empty
 * catalog does not throw: fall back to the default catalog row, then the topology
 * host-engine stub (not a menu row).
 */
export function modeById(id: string): ViewMode {
  const modes = allModes();
  const found = modes.find((m) => m.id === id) ?? modes.find((m) => m.pluginId === id);
  return found ?? defaultCatalogMode() ?? topology;
}
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
