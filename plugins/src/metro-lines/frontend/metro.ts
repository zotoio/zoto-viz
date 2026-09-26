/**
 * Metro Lines — schematic transit map pack (CPU layout + sim, GPU draw in sky).
 */

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

/** Declared per-frame work budget (counts only — for light tests). */
export const METRO_WORK_BUDGET = {
  drawCalls: 14,
  triangles: 4800,
  particles: METRO_MAX_TRAINS,
  gpuBytes: 2048,
} as const;

/** Zoto Fail — disruptions never hide behind spectacle. */
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
export type MetroStationSource = "talkers" | "rf" | "mixed";
export type MetroLineSource = "packets" | "talkers";

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
  stationSource: MetroStationSource;
  lineSource: MetroLineSource;
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
  stationSource: "talkers",
  lineSource: "packets",
  reducedMotion: false,
};

const PRESET_PATCH: Record<MetroPreset, Partial<MetroOptions>> = {
  classic_map: { nightMode: false, labelDensity: 1, lineThickness: 1, ticker: true, tilt3d: 0.35 },
  night_network: { nightMode: true, palette: "neon", labelDensity: 0.85, lineThickness: 1.1, ticker: true, tilt3d: 0.5 },
  disruptions_only: { nightMode: false, labelDensity: 0.7, lineThickness: 0.9, ticker: true, tilt3d: 0.2 },
  minimal: { nightMode: false, labelDensity: 0.35, lineThickness: 0.75, ticker: false, tilt3d: 0, trainSpeed: 0.85 },
};

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
    stationSource: (cfg?.stationSource as MetroStationSource) || base.stationSource,
    lineSource: (cfg?.lineSource as MetroLineSource) || base.lineSource,
    reducedMotion: bool(cfg, "reducedMotion", base.reducedMotion),
  };
}

export function metroHudLabel(opts: MetroOptions, metric: string, demo: boolean): string {
  return `Metro Lines · ${opts.preset.replace(/_/g, " ")} · ${demo ? "demo" : metric}`;
}

export interface MetroPacketSample {
  proto: string;
  size: number;
  field: number;
  /** Owning host id (required for packet→line/train mapping when live). */
  host?: string;
  /** Optional peer host for the other end of the line. */
  peer?: string;
  /** Legacy alias for host when the frame carries `id` instead. */
  id?: string;
  /** Explicit per-flow failure 0..1 — never inferred from field/size. */
  failed?: number;
}

export interface MetroTalkerSample {
  id: string;
  rate: number;
  role: string;
  failed?: number;
}

export interface VizSliceFrame {
  t: number;
  dt: number;
  audio: number;
  packets: MetroPacketSample[];
  rf: { ssid: string; rssi: number; channel: number }[];
  talkers: MetroTalkerSample[];
  headlines: { id: string; label: string; text: string }[];
  sys?: { failed: number };
  demo?: boolean;
  demoSlices?: Partial<Record<"packets" | "rf" | "talkers" | "headlines", true>>;
}

export interface MetroStation {
  id: string;
  /** Fixed GPU slot 0..METRO_MAX_STATIONS-1 — keyed by host id, not list rank. */
  slot: number;
  label: string;
  role: number;
  rate: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** Failure stress 0..1 from explicit host failure fields only. */
  failed: number;
  major: boolean;
}

export interface MetroEdge {
  a: number;
  b: number;
  hue: number;
  weight: number;
  disrupted: number;
  proto: string;
  /** Index in the frame packet list that owns this edge (for trains). */
  packetIndex: number;
}

export interface MetroTrain {
  edge: number;
  u: number;
  len: number;
  speed: number;
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

/** Frames a vacated host slot is held before reuse (never handed to the next list entry). */
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
    failed: 0,
    major: false,
  };
}

function explicitHostFailure(t: MetroTalkerSample, packets: MetroPacketSample[]): number {
  if (typeof t.failed === "number" && Number.isFinite(t.failed)) {
    return clamp(t.failed, 0, 1, 0);
  }
  let max = 0;
  for (const p of packets) {
    const host = packetHostId(p);
    if (host !== t.id) continue;
    if (typeof p.failed === "number" && Number.isFinite(p.failed)) {
      max = Math.max(max, clamp(p.failed, 0, 1, 0));
    }
  }
  return max;
}

function packetHostId(p: MetroPacketSample): string | null {
  const host = p.host ?? p.id;
  return host && host.length > 0 ? host : null;
}

interface HostRecord {
  id: string;
  rate: number;
  role: string;
  failed: number;
}

class MetroHostRegistry {
  private readonly slots: {
    hostId: string | null;
    vacant: number;
    station: MetroStation;
  }[] = [];

  constructor() {
    this.reset();
  }

  reset(): void {
    this.slots.length = 0;
    for (let i = 0; i < METRO_MAX_STATIONS; i++) {
      this.slots.push({ hostId: null, vacant: 0, station: emptyStation(i) });
    }
  }

  assignedCount(): number {
    return this.slots.filter((s) => s.hostId).length;
  }

  slotIndexFor(hostId: string): number {
    return this.slots.find((s) => s.hostId === hostId)?.station.slot ?? -1;
  }

  sync(
    hosts: HostRecord[],
    packets: MetroPacketSample[],
    seed: number,
    maxHosts: number,
  ): MetroStation[] {
    const active = new Set(hosts.map((h) => h.id));

    for (const row of this.slots) {
      if (!row.hostId) continue;
      if (!active.has(row.hostId)) {
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
          failed: 0,
          major: h.role === "gateway",
        };
        row = free;
      }
      row.station.rate = Math.min(1, h.rate / 200);
      row.station.role = roleHue(h.role);
      row.station.failed = h.failed;
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

/** Packed station stress channel (failure only — not rate/field). */
export function metroStationStressPacked(station: MetroStation): number {
  return station.failed;
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

function buildDemoTalkers(t: number): VizSliceFrame["talkers"] {
  const phase = t * 0.4;
  return [
    { id: "hub-alpha", rate: 140 + 20 * Math.sin(phase), role: "gateway" },
    { id: "yard-brun", rate: 110 + 15 * Math.sin(phase + 1), role: "lan" },
    { id: "quay-seven", rate: 95 + 10 * Math.cos(phase * 0.7), role: "lan" },
    { id: "spire-v", rate: 88 + 12 * Math.sin(phase + 2), role: "lan" },
    { id: "mint-river", rate: 76 + 8 * Math.cos(phase + 0.5), role: "internet" },
    { id: "glass-h", rate: 68 + 6 * Math.sin(phase * 1.2), role: "internet" },
    { id: "cedar-x", rate: 62 + 5 * Math.cos(phase * 1.4), role: "lan" },
    { id: "pilot-sq", rate: 58 + 4 * Math.sin(phase + 3), role: "lan" },
    { id: "orchard-l", rate: 52 + 3 * Math.cos(phase + 2.2), role: "lan" },
    { id: "beacon-r", rate: 48 + 2 * Math.sin(phase * 0.9), role: "lan" },
    { id: "summit-v", rate: 44 + 2 * Math.cos(phase + 1.8), role: "lan" },
    { id: "quartz-p", rate: 40 + 2 * Math.sin(phase + 0.3), role: "lan" },
  ];
}

function buildDemoPackets(t: number): MetroPacketSample[] {
  const w = t * 0.5;
  return [
    { proto: "tcp", size: 520, field: 0.55 + 0.1 * Math.sin(w), host: "hub-alpha", peer: "yard-brun" },
    { proto: "tls", size: 900, field: 0.62 + 0.08 * Math.cos(w * 1.1), host: "yard-brun", peer: "quay-seven" },
    { proto: "udp", size: 180, field: 0.42 + 0.12 * Math.sin(w * 1.3), host: "quay-seven", peer: "spire-v" },
    { proto: "dns", size: 96, field: 0.35 + 0.1 * Math.cos(w * 0.8), host: "spire-v", peer: "mint-river" },
    { proto: "tcp", size: 640, field: 0.58 + 0.09 * Math.sin(w + 1), host: "mint-river", peer: "glass-h" },
    { proto: "tls", size: 1100, field: 0.68 + 0.07 * Math.cos(w + 0.4), host: "glass-h", peer: "hub-alpha" },
  ];
}

export function isMetroDemoFrame(frame: VizSliceFrame): boolean {
  if (frame.demo) return true;
  if (frame.demoSlices?.talkers || frame.demoSlices?.packets) return true;
  if (frame.talkers.length === 0 && frame.packets.length === 0) return true;
  // Shared host idle fixture (buildIdleVizFrame) — still render fictional demo network.
  return frame.talkers.some((t) => t.id === "10.0.0.42" || t.id === "8.8.8.8");
}

export function buildMetroNetwork(frame: VizSliceFrame, opts: MetroOptions): MetroNetwork {
  const demo = isMetroDemoFrame(frame);
  const talkers = demo ? buildDemoTalkers(frame.t) : frame.talkers;
  const packets = demo ? buildDemoPackets(frame.t) : frame.packets;
  const maxS = Math.min(opts.maxStations, METRO_MAX_STATIONS);
  const registry = getMetroHostRegistry();

  const hosts: HostRecord[] = [];
  const seen = new Set<string>();
  const pushHost = (id: string, rate: number, role: string, failed = 0): void => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    hosts.push({ id, rate, role, failed });
  };

  if (opts.stationSource === "rf" || opts.stationSource === "mixed") {
    for (const b of frame.rf) {
      pushHost(b.ssid || `ch-${b.channel}`, b.rssi * 180, "lan");
    }
  }
  if (opts.stationSource !== "rf") {
    for (const t of talkers) {
      pushHost(t.id, t.rate, t.role, explicitHostFailure(t, packets));
    }
  }

  const stations = registry.sync(hosts, packets, opts.seed, maxS);
  const fail = clamp(frame.sys?.failed ?? 0, 0, 1, 0);

  const stationBySlot = (slot: number): MetroStation | undefined =>
    stations.find((s) => s.slot === slot);

  const edgeDisrupted = (slotA: number, slotB: number): number => {
    const fa = stationBySlot(slotA)?.failed ?? 0;
    const fb = stationBySlot(slotB)?.failed ?? 0;
    return fa > 0 || fb > 0 ? 1 : 0;
  };

  const edges: MetroEdge[] = [];
  const legendMap = new Map<string, number>();
  const addEdge = (
    a: number,
    b: number,
    hue: number,
    weight: number,
    proto: string,
    packetIndex: number,
  ): void => {
    if (a === b || a < 0 || b < 0) return;
    const key = `${Math.min(a, b)}-${Math.max(a, b)}-${proto}`;
    if (edges.some((e) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}-${e.proto}` === key)) return;
    if (edges.length >= METRO_MAX_EDGES) return;
    const disrupted = edgeDisrupted(a, b);
    edges.push({ a, b, hue, weight, proto, disrupted, packetIndex });
    if (!legendMap.has(proto)) legendMap.set(proto, hue);
  };

  const gatewaySlot = (): number => {
    const gw = stations.find((s) => s.major && s.role >= 0.8);
    return gw?.slot ?? stations[0]?.slot ?? -1;
  };

  if (opts.lineSource === "packets") {
    for (let i = 0; i < packets.length && edges.length < METRO_MAX_EDGES; i++) {
      const p = packets[i]!;
      const host = packetHostId(p);
      if (!host) continue;
      const a = registry.slotIndexFor(host);
      if (a < 0) continue;
      let b = p.peer ? registry.slotIndexFor(p.peer) : -1;
      if (b < 0) b = gatewaySlot();
      if (b < 0 || b === a) continue;
      const w = Math.min(1, p.size / 1200);
      addEdge(a, b, protoHue(p.proto), w, p.proto, i);
    }
  } else {
    const hub = gatewaySlot();
    for (const h of hosts) {
      const a = registry.slotIndexFor(h.id);
      if (a < 0 || a === hub || hub < 0) continue;
      addEdge(a, hub, roleHue(h.role), Math.min(1, h.rate / 200), "talker", -1);
    }
  }

  const legend: MetroLegendLine[] = [...legendMap.entries()].slice(0, 6).map(([label, hue]) => ({ label, hue }));

  const disruptions: string[] = [];
  if (fail > 0) disruptions.push(`SERVICE ALERT · ${Math.round(fail * 100)}% host stress`);
  for (const s of stations) {
    if (s.failed > 0) disruptions.push(`DISRUPTION · ${s.label} limited service`);
  }
  for (const h of frame.headlines.slice(0, 2)) {
    if (/fail|down|error|outage/i.test(h.text)) disruptions.push(h.text.slice(0, 36));
  }
  if (demo) disruptions.unshift("DEMO NETWORK · fictional stations only");
  const ticker = disruptions.length > 0
    ? disruptions.join("   ◆   ")
    : "All lines running · good service";

  return { stations, edges, legend, ticker, demo, disruptions: disruptions.length };
}

const SIM_HZ = 60;
const MAX_CATCHUP = 4;

export class MetroSim {
  private acc = 0;
  trains: MetroTrain[] = [];
  tickerPhase = 0;
  private trainPool: MetroTrain[] = [];
  private rafSubs = 0;

  constructor() {
    for (let i = 0; i < METRO_MAX_TRAINS; i++) {
      this.trainPool.push({ edge: 0, u: 0, len: 0.08, speed: 0.2 });
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

  step(frame: VizSliceFrame, net: MetroNetwork, opts: MetroOptions): void {
    smoothStations(net.stations, frame.dt, opts.reducedMotion);
    this.acc += frame.dt;
    const step = 1 / SIM_HZ;
    let catches = 0;
    while (this.acc >= step && catches < MAX_CATCHUP) {
      this.acc -= step;
      catches++;
      this.integrateTrains(frame, net, opts, step);
      if (opts.ticker) this.tickerPhase += step * (opts.reducedMotion ? 0.15 : 0.45);
    }
  }

  private integrateTrains(frame: VizSliceFrame, net: MetroNetwork, opts: MetroOptions, dt: number): void {
    const demo = net.demo;
    const packets = demo ? buildDemoPackets(frame.t) : frame.packets;
    const maxT = Math.min(opts.maxTrains, METRO_MAX_TRAINS, packets.length);
    this.trains.length = 0;
    for (let i = 0; i < maxT; i++) {
      const tr = this.trainPool[i]!;
      const pkt = packets[i]!;
      const edgeIdx = net.edges.findIndex((e) => e.packetIndex === i);
      if (edgeIdx < 0) continue;
      const speed = (0.15 + pkt.field * 0.55) * opts.trainSpeed * (opts.reducedMotion ? 0.35 : 1);
      const len = Math.min(0.22, 0.04 + pkt.size / 6000);
      tr.edge = edgeIdx;
      tr.u = (tr.u + speed * dt) % 1;
      tr.len = len;
      tr.speed = speed;
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
    sharedSim = null;
    resetMetroHostRegistry();
  }
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
  frame: VizSliceFrame,
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
      s ? metroStationStressPacked(s) : 0,
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
      e ? e.weight + e.disrupted * 0.5 : 0,
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
    trBuf.push(tr?.edge ?? 0, tr?.u ?? 0, tr?.len ?? 0, tr?.speed ?? 0);
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
    out.push(tr.edge, tr.u, tr.len, tr.speed);
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
