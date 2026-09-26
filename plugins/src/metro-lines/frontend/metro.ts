/**
 * Metro Lines — schematic transit map (CPU layout + sim, GPU draw in sky).
 */

import type { VizDataFrame } from "../../../../web/src/plugins/viz-host";

export const METRO_MARK = 1.047;
export const METRO_MAX_STATIONS = 16;
export const METRO_MAX_EDGES = 16;
export const METRO_MAX_TRAINS = 48;
export const METRO_MAX_TICKER_CHARS = 40;
export const METRO_SLOT_HEADER = 0;
export const METRO_SLOT_STATIONS = 1;
export const METRO_SLOT_EDGES = 2;
export const METRO_SLOT_LABELS = 3;
export const METRO_SLOT_LEGEND = 4;
export const METRO_SLOT_TICKER = 5;
export const METRO_SLOT_TRAINS = 6;
export const METRO_SLOT_COUNT = 8;

export const METRO_SYS_FAIL_BANNER = 0.15;

/** Declared per-frame work budget (counts only — for light tests). */
export const METRO_WORK_BUDGET = {
  drawCalls: 14,
  triangles: 4800,
  particles: METRO_MAX_TRAINS,
  gpuBytes: 2048,
} as const;

export const METRO_FAIL_RGB: [number, number, number] = [0.93, 0.12, 0.35];

export const METRO_TRADEMARK_DENY = [
  "minecraft", "mojang", "rocket league", "psyonix",
  "london underground", "underground roundel", "johnston", "johnston100",
  "transport for london", "tfl", "tube map", "metropolitan line", "piccadilly",
  "jubilee line", "northern line", "circle line", "district line", "elizabeth line",
  "ratp", "régie autonome", "mta", "new york city subway", "bvg", "s-bahn",
] as const;

export type MetroPreset = "classic_map" | "night_network" | "disruptions_only" | "minimal";
export type MetroPalette = "aurora" | "citrus" | "slate" | "neon";

export interface MetroOptions {
  preset: MetroPreset;
  seed: number;
  palette: MetroPalette;
  lineThickness: number;
  labelDensity: number;
  ticker: boolean;
  trainSpeed: number;
  maxStations: number;
  maxTrains: number;
  tilt3d: number;
  nightMode: boolean;
  reducedMotion: boolean;
}

export const METRO_DEFAULTS: MetroOptions = {
  preset: "classic_map",
  seed: 4242,
  palette: "aurora",
  lineThickness: 1,
  labelDensity: 1,
  ticker: true,
  trainSpeed: 1,
  maxStations: 16,
  maxTrains: 48,
  tilt3d: 0.35,
  nightMode: false,
  reducedMotion: false,
};

const PRESET_PATCH: Record<MetroPreset, Partial<MetroOptions>> = {
  classic_map: { nightMode: false, labelDensity: 1, lineThickness: 1, ticker: true, tilt3d: 0.35 },
  night_network: { nightMode: true, palette: "neon", labelDensity: 0.85, lineThickness: 1.1, ticker: true, tilt3d: 0.5 },
  disruptions_only: { nightMode: false, labelDensity: 0.7, lineThickness: 0.9, ticker: true, tilt3d: 0.2 },
  minimal: { nightMode: false, labelDensity: 0.35, lineThickness: 0.75, ticker: false, tilt3d: 0, trainSpeed: 0.85 },
};

const SCHEMATIC_HUE = 0.38;

function clamp(n: number, lo: number, hi: number, fb: number): number {
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}

function bool(cfg: Record<string, string> | undefined, key: string, fb: boolean): boolean {
  const v = cfg?.[key];
  if (v === undefined) return fb;
  return v !== "0" && v !== "false";
}

export function parseMetroOptions(cfg?: Record<string, string>): MetroOptions {
  const preset = (cfg?.preset ?? METRO_DEFAULTS.preset) as MetroPreset;
  const base = { ...METRO_DEFAULTS, ...(PRESET_PATCH[preset] ?? {}), preset };
  return {
    preset,
    seed: clamp(Number(cfg?.seed), 0, 99999, base.seed),
    palette: (cfg?.palette as MetroPalette) || base.palette,
    lineThickness: clamp(Number(cfg?.lineThickness), 0.5, 2.2, base.lineThickness),
    labelDensity: clamp(Number(cfg?.labelDensity), 0, 1, base.labelDensity),
    ticker: bool(cfg, "ticker", base.ticker),
    trainSpeed: clamp(Number(cfg?.trainSpeed), 0.25, 3, base.trainSpeed),
    maxStations: clamp(Number(cfg?.maxStations), 6, METRO_MAX_STATIONS, base.maxStations),
    maxTrains: clamp(Number(cfg?.maxTrains), 8, METRO_MAX_TRAINS, base.maxTrains),
    tilt3d: clamp(Number(cfg?.tilt3d), 0, 1, base.tilt3d),
    nightMode: bool(cfg, "nightMode", base.nightMode),
    reducedMotion: bool(cfg, "reducedMotion", base.reducedMotion),
  };
}

export function metroHudLabel(opts: MetroOptions, metric: string, demo: boolean): string {
  return `Metro Lines · ${opts.preset.replace(/_/g, " ")} · ${demo ? "demo" : metric}`;
}

export interface MetroStation {
  id: string;
  slot: number;
  label: string;
  role: number;
  rate: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  major: boolean;
}

export interface MetroEdge {
  a: number;
  b: number;
  hue: number;
  weight: number;
  proto: string;
  /** Spoke station id (non-gateway) for train weighting. */
  stationId: string;
}

export interface MetroTrain {
  edge: number;
  u: number;
  len: number;
  speed: number;
  hue: number;
}

export interface MetroLegendLine {
  hue: number;
  label: string;
}

export interface MetroNetwork {
  stations: MetroStation[];
  edges: MetroEdge[];
  legend: MetroLegendLine[];
  ticker: string;
  demo: boolean;
  /** 1 when sys.failed banner is active (shader / board). */
  disruptions: number;
}

const FICTIONAL_NAMES = [
  "Amber Yard", "Cinder Loop", "North Quay", "Violet Spire", "Harbor Six", "Marble Bend",
  "Copper Gate", "Echo Field", "Prism Junction", "Slate Wharf", "Orchard Link", "Beacon Row",
  "Summit Vale", "Quartz Park", "Indigo Platform", "Lantern Cross", "River Mint", "Glass Harbor",
  "Cedar Exchange", "Pilot Square",
];

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fictionalLabel(id: string): string {
  return FICTIONAL_NAMES[hashStr(id) % FICTIONAL_NAMES.length]!;
}

export const METRO_HOST_VACANT_MAX = 90;

function layoutTargetForHost(hostId: string, seed: number): [number, number] {
  const rnd = mulberry32(hashStr(hostId) ^ (seed >>> 0));
  const col = rnd();
  const row = rnd();
  const tx = -0.55 + col * 1.1;
  const ty = -0.42 + row * 0.84;
  return snapOctilinear(tx, ty);
}

function emptyStation(slot: number): MetroStation {
  return {
    id: "",
    slot,
    label: "",
    role: 0,
    rate: 0,
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
    major: false,
  };
}

interface HostRecord {
  id: string;
  rate: number;
  role: string;
}

class MetroHostRegistry {
  private readonly slots: {
    hostId: string | null;
    vacant: number;
    station: MetroStation;
  }[] = [];
  private readonly activeIds = new Set<string>();

  constructor() {
    this.reset();
  }

  reset(): void {
    this.slots.length = 0;
    this.activeIds.clear();
    for (let i = 0; i < METRO_MAX_STATIONS; i++) {
      this.slots.push({ hostId: null, vacant: 0, station: emptyStation(i) });
    }
  }

  assignedCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.hostId) n++;
    return n;
  }

  slotIndexFor(hostId: string): number {
    for (const s of this.slots) {
      if (s.hostId === hostId) return s.station.slot;
    }
    return -1;
  }

  sync(hosts: HostRecord[], seed: number, maxHosts: number): MetroStation[] {
    this.activeIds.clear();
    for (const h of hosts) this.activeIds.add(h.id);

    for (const row of this.slots) {
      if (!row.hostId) continue;
      if (!this.activeIds.has(row.hostId)) {
        row.vacant++;
        if (row.vacant > METRO_HOST_VACANT_MAX) {
          row.hostId = null;
          row.vacant = 0;
          row.station = emptyStation(row.station.slot);
        }
        continue;
      }
      row.vacant = 0;
    }

    for (const h of hosts) {
      let row = this.slots.find((s) => s.hostId === h.id);
      if (!row) {
        if (this.assignedCount() >= maxHosts) continue;
        const free = this.slots.find((s) => !s.hostId);
        if (!free) continue;
        const [tx, ty] = layoutTargetForHost(h.id, seed);
        free.hostId = h.id;
        free.vacant = 0;
        free.station = {
          id: h.id,
          slot: free.station.slot,
          label: fictionalLabel(h.id),
          role: roleHue(h.role),
          rate: 0,
          x: tx,
          y: ty,
          tx,
          ty,
          major: h.role === "gateway",
        };
        row = free;
      }
      row.station.rate = Math.min(1, h.rate / 200);
      row.station.role = roleHue(h.role);
      row.station.major = h.role === "gateway" || h.rate > 80;
      row.station.label = fictionalLabel(h.id);
    }

    const out: MetroStation[] = [];
    for (const row of this.slots) {
      if (!row.hostId) continue;
      out.push(row.station);
    }
    return out;
  }
}

let metroHostRegistry: MetroHostRegistry | null = null;

export function getMetroHostRegistry(): MetroHostRegistry {
  if (!metroHostRegistry) metroHostRegistry = new MetroHostRegistry();
  return metroHostRegistry;
}

export function resetMetroHostRegistry(): void {
  metroHostRegistry?.reset();
  metroHostRegistry = null;
}

function roleHue(role: string): number {
  if (role === "gateway") return 0.82;
  if (role === "internet") return 0.62;
  if (role === "lan") return 0.38;
  return 0.2;
}

function protoHue(proto: string): number {
  const p = proto.toLowerCase();
  if (p.includes("tls") || p.includes("https")) return 0.15;
  if (p.includes("tcp")) return 0.32;
  if (p.includes("udp")) return 0.48;
  if (p.includes("dns")) return 0.58;
  if (p.includes("icmp")) return 0.72;
  return 0.42;
}

function snapOctilinear(x: number, y: number): [number, number] {
  const g = 0.14;
  const sx = Math.round(x / g) * g;
  const sy = Math.round(y / g) * g;
  return [sx, sy];
}

function smoothStations(stations: MetroStation[], dt: number, reduced: boolean): void {
  const k = reduced ? 0.08 : Math.min(1, dt * 4.5);
  for (const s of stations) {
    s.x += (s.tx - s.x) * k;
    s.y += (s.ty - s.y) * k;
  }
}

function buildDemoTalkers(t: number): VizDataFrame["talkers"] {
  const phase = t * 0.4;
  return [
    { id: "hub-alpha", rate: 140 + 20 * Math.sin(phase), role: "gateway" },
    { id: "yard-brun", rate: 110 + 15 * Math.sin(phase + 1), role: "lan" },
    { id: "quay-seven", rate: 95 + 10 * Math.cos(phase * 0.7), role: "lan" },
    { id: "spire-v", rate: 88 + 12 * Math.sin(phase + 2), role: "lan" },
    { id: "mint-river", rate: 76 + 8 * Math.cos(phase * 0.5), role: "internet" },
    { id: "glass-h", rate: 68 + 6 * Math.sin(phase * 1.2), role: "internet" },
    { id: "cedar-x", rate: 62 + 5 * Math.cos(phase * 1.4), role: "lan" },
    { id: "pilot-sq", rate: 58 + 4 * Math.sin(phase + 3), role: "lan" },
  ];
}

function buildDemoPackets(t: number): VizDataFrame["packets"] {
  const w = t * 0.5;
  return [
    { proto: "tcp", size: 520, field: 0.55 + 0.1 * Math.sin(w) },
    { proto: "tls", size: 900, field: 0.62 + 0.08 * Math.cos(w * 1.1) },
    { proto: "udp", size: 180, field: 0.42 + 0.12 * Math.sin(w * 1.3) },
    { proto: "dns", size: 96, field: 0.35 + 0.1 * Math.cos(w * 0.8) },
    { proto: "tcp", size: 640, field: 0.58 + 0.09 * Math.sin(w + 1) },
    { proto: "tls", size: 1100, field: 0.68 + 0.07 * Math.cos(w + 0.4) },
  ];
}

export function isMetroDemoFrame(frame: VizDataFrame): boolean {
  if (frame.demo) return true;
  if (frame.demoSlices?.talkers || frame.demoSlices?.packets) return true;
  if (frame.talkers.length === 0 && frame.packets.length === 0) return true;
  return frame.talkers.some((t) => t.id === "10.0.0.42" || t.id === "8.8.8.8");
}

function resolveTalkers(frame: VizDataFrame): VizDataFrame["talkers"] {
  return isMetroDemoFrame(frame) ? buildDemoTalkers(frame.t) : frame.talkers;
}

function resolvePackets(frame: VizDataFrame): VizDataFrame["packets"] {
  return isMetroDemoFrame(frame) ? buildDemoPackets(frame.t) : frame.packets;
}

function talkersStructureKey(talkers: VizDataFrame["talkers"], seed: number, maxStations: number): string {
  const ids = talkers
    .map((t) => `${t.id}\0${t.role}`)
    .sort();
  return `${ids.join("\0")}|${seed}|${maxStations}`;
}

function hostsFromTalkers(talkers: VizDataFrame["talkers"]): HostRecord[] {
  const hosts: HostRecord[] = [];
  const seen = new Set<string>();
  for (const t of talkers) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    hosts.push({ id: t.id, rate: t.rate, role: t.role });
  }
  return hosts;
}

function gatewaySlot(stations: MetroStation[]): number {
  const gw = stations.find((s) => s.major && s.role >= 0.8);
  return gw?.slot ?? stations[0]?.slot ?? -1;
}

export function buildTicker(frame: VizDataFrame, demo: boolean): { text: string; banner: boolean } {
  const fail = clamp(frame.sys?.failed ?? 0, 0, 1, 0);
  const banner = fail >= METRO_SYS_FAIL_BANNER;
  const parts: string[] = [];
  if (demo) parts.push("DEMO NETWORK · fictional stations only");
  if (banner) parts.push(`NETWORK DISRUPTION · ${Math.round(fail * 100)}%`);
  const headlines = frame.headlines.map((h) => h.text.trim()).filter(Boolean).join("  ·  ");
  if (headlines) parts.push(headlines);
  if (parts.length === 0) {
    return { text: "All lines running · good service", banner: false };
  }
  return { text: parts.join("   ◆   "), banner };
}

function edgeKey(a: number, b: number, proto: string): string {
  return `${a < b ? a : b}-${a < b ? b : a}-${proto}`;
}

function pickEdgeForPacket(edgeWeights: number[], packetIndex: number): number {
  let total = 0;
  for (const w of edgeWeights) total += w;
  if (total <= 0) return 0;
  let t = ((packetIndex * 0.6180339887) % 1) * total;
  for (let i = 0; i < edgeWeights.length; i++) {
    t -= edgeWeights[i]!;
    if (t <= 0) return i;
  }
  return edgeWeights.length - 1;
}

export class MetroRuntime {
  structureKey = "";
  private net: MetroNetwork = {
    stations: [],
    edges: [],
    legend: [{ hue: SCHEMATIC_HUE, label: "schematic" }],
    ticker: "",
    demo: false,
    disruptions: 0,
  };
  private readonly edgeDedupe = new Set<string>();
  private readonly registry = getMetroHostRegistry();
  structureRebuilds = 0;
  tickAllocs = 0;

  reset(): void {
    this.structureKey = "";
    this.edgeDedupe.clear();
    this.net.stations = [];
    this.net.edges.length = 0;
    this.structureRebuilds = 0;
    this.tickAllocs = 0;
  }

  tick(frame: VizDataFrame, opts: MetroOptions): MetroNetwork {
    const talkers = resolveTalkers(frame);
    const key = talkersStructureKey(talkers, opts.seed, opts.maxStations);
    if (key !== this.structureKey) {
      this.rebuildStructure(frame, opts, talkers);
      this.structureKey = key;
      this.structureRebuilds++;
    } else {
      this.updateStructure(frame, opts, talkers);
    }
    this.updateDynamics(frame, opts);
    return this.net;
  }

  private rebuildStructure(
    frame: VizDataFrame,
    opts: MetroOptions,
    talkers: VizDataFrame["talkers"],
  ): void {
    this.tickAllocs++;
    const maxS = Math.min(opts.maxStations, METRO_MAX_STATIONS);
    const hosts = hostsFromTalkers(talkers);
    this.net.demo = isMetroDemoFrame(frame);
    this.net.stations = this.registry.sync(hosts, opts.seed, maxS);
    this.net.edges.length = 0;
    this.edgeDedupe.clear();

    const hub = gatewaySlot(this.net.stations);
    for (const h of hosts) {
      const a = this.registry.slotIndexFor(h.id);
      if (a < 0 || a === hub || hub < 0) continue;
      const key = edgeKey(a, hub, "schematic");
      if (this.edgeDedupe.has(key)) continue;
      if (this.net.edges.length >= METRO_MAX_EDGES) break;
      this.edgeDedupe.add(key);
      const weight = Math.min(1, h.rate / 200);
      this.net.edges.push({
        a,
        b: hub,
        hue: SCHEMATIC_HUE,
        weight,
        proto: "schematic",
        stationId: h.id,
      });
    }
    this.net.legend.length = 0;
    this.net.legend.push({ hue: SCHEMATIC_HUE, label: "schematic" });
  }

  private updateStructure(
    frame: VizDataFrame,
    opts: MetroOptions,
    talkers: VizDataFrame["talkers"],
  ): void {
    const maxS = Math.min(opts.maxStations, METRO_MAX_STATIONS);
    const hosts = hostsFromTalkers(talkers);
    this.net.demo = isMetroDemoFrame(frame);
    this.net.stations = this.registry.sync(hosts, opts.seed, maxS);
    const hub = gatewaySlot(this.net.stations);
    for (const e of this.net.edges) {
      const h = hosts.find((x) => x.id === e.stationId);
      if (h) e.weight = Math.min(1, h.rate / 200);
      if (hub >= 0) {
        e.a = this.registry.slotIndexFor(e.stationId);
        e.b = hub;
      }
    }
  }

  private updateDynamics(frame: VizDataFrame, opts: MetroOptions): void {
    const tick = buildTicker(frame, this.net.demo);
    this.net.ticker = tick.text;
    this.net.disruptions = tick.banner ? 1 : 0;
    smoothStations(this.net.stations, frame.dt, opts.reducedMotion);
  }
}

const SIM_HZ = 60;
const MAX_CATCHUP = 4;

export class MetroSim {
  private acc = 0;
  trains: MetroTrain[] = [];
  tickerPhase = 0;
  private readonly trainPool: MetroTrain[] = [];
  private rafSubs = 0;
  readonly runtime = new MetroRuntime();

  constructor() {
    for (let i = 0; i < METRO_MAX_TRAINS; i++) {
      this.trainPool.push({ edge: 0, u: 0, len: 0.08, speed: 0.2, hue: 0.42 });
    }
  }

  subscribe(): void {
    this.rafSubs++;
  }

  unsubscribe(): void {
    this.rafSubs = Math.max(0, this.rafSubs - 1);
  }

  get activeSubscriptions(): number {
    return this.rafSubs;
  }

  step(frame: VizDataFrame, opts: MetroOptions): MetroNetwork {
    const net = this.runtime.tick(frame, opts);
    this.acc += frame.dt;
    const step = 1 / SIM_HZ;
    let catches = 0;
    while (this.acc >= step && catches < MAX_CATCHUP) {
      this.acc -= step;
      catches++;
      this.integrateTrains(frame, net, opts, step);
      if (opts.ticker) this.tickerPhase += step * (opts.reducedMotion ? 0.15 : 0.45);
    }
    return net;
  }

  private integrateTrains(frame: VizDataFrame, net: MetroNetwork, opts: MetroOptions, dt: number): void {
    const packets = resolvePackets(frame);
    const maxT = Math.min(opts.maxTrains, METRO_MAX_TRAINS, packets.length);
    const edgeWeights = net.edges.map((e) => {
      const st = net.stations.find((s) => s.id === e.stationId);
      return st?.rate ?? e.weight;
    });
    this.trains.length = 0;
    for (let i = 0; i < maxT; i++) {
      const tr = this.trainPool[i]!;
      const pkt = packets[i]!;
      const edgeIdx = pickEdgeForPacket(edgeWeights, i);
      const speed = (0.12 + (pkt.size / 1200) * 0.55) * opts.trainSpeed * (opts.reducedMotion ? 0.35 : 1);
      const len = Math.min(0.22, 0.04 + pkt.size / 6000);
      tr.edge = edgeIdx;
      tr.u = (tr.u + speed * dt) % 1;
      tr.len = len;
      tr.speed = speed;
      tr.hue = protoHue(pkt.proto);
      this.trains.push(tr);
    }
  }
}

let sharedSim: MetroSim | null = null;

export function acquireMetroSim(): MetroSim {
  if (!sharedSim) sharedSim = new MetroSim();
  sharedSim.subscribe();
  return sharedSim;
}

export function releaseMetroSim(): void {
  if (!sharedSim) return;
  sharedSim.unsubscribe();
  if (sharedSim.activeSubscriptions <= 0) {
    sharedSim.runtime.reset();
    sharedSim = null;
    resetMetroHostRegistry();
  }
}

/** One-shot network build (tests); production uses {@link MetroSim.step}. */
export function buildMetroNetwork(frame: VizDataFrame, opts: MetroOptions): MetroNetwork {
  const rt = new MetroRuntime();
  return rt.tick(frame, opts);
}

export function metroCanvasSize(doc?: Document | null): { w: number; h: number } {
  let root = doc ?? (typeof document !== "undefined" ? document : null);
  try {
    if (!doc && typeof parent !== "undefined" && parent.document) root = parent.document;
  } catch { /* sandbox */ }
  const canvas = (root?.querySelector?.("canvas.render-host")
    ?? root?.querySelector?.("#wall > canvas")
    ?? root?.querySelector?.("#scene canvas")) as { width?: number; height?: number } | null;
  const w = canvas?.width ?? 0;
  const h = canvas?.height ?? 0;
  return { w: w > 64 ? w : 1280, h: h > 64 ? h : 800 };
}

function packChars(text: string, max: number): number[] {
  const out: number[] = [];
  const s = text.slice(0, max).toUpperCase();
  for (let i = 0; i < max; i++) {
    const c = i < s.length ? s.charCodeAt(i) : 32;
    out.push((c >= 32 && c < 127 ? c - 32 : 0) / 95);
  }
  return out;
}

function stationAtSlot(stations: MetroStation[], slot: number): MetroStation | undefined {
  return stations.find((s) => s.slot === slot);
}

function packStationLabels(stations: MetroStation[]): number[] {
  const buf: number[] = [];
  for (let i = 0; i < METRO_MAX_STATIONS; i++) {
    const s = stationAtSlot(stations, i);
    const code = s ? s.label.slice(0, 3).toUpperCase() : "   ";
    for (let j = 0; j < 3; j++) {
      const c = code.charCodeAt(j) || 32;
      buf.push((c >= 32 && c < 127 ? c - 32 : 0) / 95);
    }
    buf.push(s ? (s.major ? 1 : 0.35) : 0);
  }
  return buf.slice(0, 64);
}

export function packMetroSlots(
  frame: VizDataFrame,
  net: MetroNetwork,
  opts: MetroOptions,
  sim: MetroSim,
  canvas = metroCanvasSize(),
): number[][] {
  const slots: number[][] = [];
  const aspect = canvas.w / canvas.h;
  const header = [
    METRO_MARK,
    aspect,
    opts.nightMode ? 1 : 0,
    opts.tilt3d,
    opts.labelDensity,
    opts.lineThickness,
    opts.trainSpeed,
    opts.ticker ? 1 : 0,
    net.demo ? 1 : 0,
    net.disruptions,
    net.legend.length,
    net.stations.length,
    net.edges.length,
    opts.reducedMotion ? 1 : 0,
    paletteIndex(opts.palette),
    sim.tickerPhase % 1,
  ];
  slots[METRO_SLOT_HEADER] = header;

  const stBuf: number[] = [];
  for (let i = 0; i < METRO_MAX_STATIONS; i++) {
    const s = stationAtSlot(net.stations, i);
    stBuf.push(
      s?.x ?? 0,
      s?.y ?? 0,
      s?.role ?? 0,
      s?.rate ?? 0,
    );
  }
  slots[METRO_SLOT_STATIONS] = stBuf;

  const eBuf: number[] = [];
  for (let i = 0; i < METRO_MAX_EDGES; i++) {
    const e = net.edges[i];
    eBuf.push(
      e ? e.a / METRO_MAX_STATIONS : 0,
      e ? e.b / METRO_MAX_STATIONS : 0,
      e ? e.hue : 0,
      e ? e.weight : 0,
    );
  }
  slots[METRO_SLOT_EDGES] = eBuf;

  slots[METRO_SLOT_LABELS] = packStationLabels(net.stations);

  const legBuf: number[] = [];
  for (let i = 0; i < 6; i++) {
    const L = net.legend[i];
    legBuf.push(L?.hue ?? 0, L ? hashStr(L.label) % 1000 / 1000 : 0);
  }
  slots[METRO_SLOT_LEGEND] = legBuf;

  slots[METRO_SLOT_TICKER] = packChars(net.ticker, METRO_MAX_TICKER_CHARS);

  const trBuf: number[] = [];
  const trainBufCap = 16;
  for (let i = 0; i < trainBufCap; i++) {
    const tr = sim.trains[i];
    trBuf.push(tr?.edge ?? 0, tr?.u ?? 0, tr?.len ?? 0, tr?.hue ?? 0);
  }
  slots[METRO_SLOT_TRAINS] = trBuf;

  while (slots.length < METRO_SLOT_COUNT) slots.push([]);
  return slots;
}

function paletteIndex(p: MetroPalette): number {
  if (p === "citrus") return 1;
  if (p === "slate") return 2;
  if (p === "neon") return 3;
  return 0;
}

export function packMetroParticles(sim: MetroSim): number[] {
  const out: number[] = [];
  for (const tr of sim.trains) {
    out.push(tr.edge, tr.u, tr.len, tr.hue);
  }
  return out;
}

export function metroWorkCounts(sim: MetroSim, net: MetroNetwork): {
  drawCalls: number;
  triangles: number;
  particles: number;
  allocatedGpuBytes: number;
} {
  const edges = net.edges.length;
  const stations = net.stations.length;
  return {
    drawCalls: 4 + Math.ceil(edges / 4) + Math.ceil(stations / 8),
    triangles: edges * 48 + stations * 24 + sim.trains.length * 6,
    particles: sim.trains.length,
    allocatedGpuBytes: METRO_WORK_BUDGET.gpuBytes,
  };
}

export function metroAccent(opts: MetroOptions, audio: number): [number, number, number] {
  if (opts.nightMode) return [0.35 + audio * 0.2, 0.75, 0.95];
  return [0.12 + audio * 0.1, 0.42, 0.82];
}

export function metroBg(opts: MetroOptions): [number, number, number] {
  return opts.nightMode ? [0.04, 0.06, 0.12] : [0.96, 0.95, 0.9];
}

export function scanMetroTrademarks(text: string): string | null {
  const low = text.toLowerCase();
  let hit: string | null = null;
  for (const term of METRO_TRADEMARK_DENY) {
    if (low.includes(term) && (!hit || term.length > hit.length)) hit = term;
  }
  return hit;
}
