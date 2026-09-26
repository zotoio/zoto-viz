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

export interface VizSliceFrame {
  t: number;
  dt: number;
  audio: number;
  packets: { proto: string; size: number; field: number }[];
  rf: { ssid: string; rssi: number; channel: number }[];
  talkers: { id: string; rate: number; role: string }[];
  headlines: { id: string; label: string; text: string }[];
  sys?: { failed: number };
  demo?: boolean;
  demoSlices?: Partial<Record<"packets" | "rf" | "talkers" | "headlines", true>>;
}

export interface MetroStation {
  id: string;
  label: string;
  role: number;
  rate: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
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

export function fictionalLabel(id: string, index: number): string {
  const h = hashStr(id);
  return FICTIONAL_NAMES[(h + index) % FICTIONAL_NAMES.length]!;
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

function layoutStations(stations: MetroStation[], seed: number): void {
  const rnd = mulberry32(seed);
  const n = stations.length;
  const cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const jx = (rnd() - 0.5) * 0.04;
    const jy = (rnd() - 0.5) * 0.04;
    const tx = -0.55 + (col / Math.max(1, cols - 1)) * 1.1 + jx;
    const ty = -0.42 + (row / Math.max(1, Math.ceil(n / cols) - 1)) * 0.84 + jy;
    const [sx, sy] = snapOctilinear(tx, ty);
    stations[i]!.tx = sx;
    stations[i]!.ty = sy;
    if (stations[i]!.x === 0 && stations[i]!.y === 0) {
      stations[i]!.x = sx;
      stations[i]!.y = sy;
    }
  }
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

function buildDemoPackets(t: number): VizSliceFrame["packets"] {
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

  const stationIds: { id: string; rate: number; role: string }[] = [];
  if (opts.stationSource === "rf" || opts.stationSource === "mixed") {
    for (const b of frame.rf) {
      stationIds.push({ id: b.ssid || `ch-${b.channel}`, rate: b.rssi * 180, role: "lan" });
    }
  }
  if (opts.stationSource !== "rf") {
    for (const t of talkers) stationIds.push({ id: t.id, rate: t.rate, role: t.role });
  }
  const seen = new Set<string>();
  const picked: { id: string; rate: number; role: string }[] = [];
  for (const s of stationIds.sort((a, b) => b.rate - a.rate)) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    picked.push(s);
    if (picked.length >= maxS) break;
  }
  while (picked.length < Math.min(6, maxS)) {
    const id = `synth-${picked.length}`;
    picked.push({ id, rate: 30 + picked.length * 4, role: "lan" });
  }

  const fail = clamp(frame.sys?.failed ?? 0, 0, 1, 0);
  const stations: MetroStation[] = picked.map((s, i) => ({
    id: s.id,
    label: fictionalLabel(s.id, i),
    role: roleHue(s.role),
    rate: Math.min(1, s.rate / 200),
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
    failed: i === 0 && fail > 0.2 ? fail : i === 2 && fail > 0.45 ? fail * 0.8 : 0,
    major: i < 4 || s.rate > 80,
  }));
  layoutStations(stations, opts.seed);

  const edges: MetroEdge[] = [];
  const legendMap = new Map<string, number>();
  const addEdge = (a: number, b: number, hue: number, weight: number, proto: string, disrupted: number): void => {
    if (a === b || a < 0 || b < 0 || a >= stations.length || b >= stations.length) return;
    const key = `${Math.min(a, b)}-${Math.max(a, b)}-${proto}`;
    if (edges.some((e) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}-${e.proto}` === key)) return;
    if (edges.length >= METRO_MAX_EDGES) return;
    edges.push({ a, b, hue, weight, proto, disrupted });
    if (!legendMap.has(proto)) legendMap.set(proto, hue);
  };

  if (opts.lineSource === "packets") {
    for (let i = 0; i < packets.length && edges.length < METRO_MAX_EDGES; i++) {
      const p = packets[i]!;
      const a = i % stations.length;
      const b = (a + 1 + (i % 3)) % stations.length;
      const w = Math.min(1, p.size / 1200);
      addEdge(a, b, protoHue(p.proto), w, p.proto, stations[a]!.failed > 0.3 ? 1 : 0);
    }
    for (let i = 0; i < stations.length - 1 && edges.length < METRO_MAX_EDGES; i++) {
      addEdge(i, i + 1, 0.25 + (i % 5) * 0.08, 0.35, "link", 0);
    }
  } else {
    for (let i = 0; i < stations.length - 1 && edges.length < METRO_MAX_EDGES; i++) {
      addEdge(i, i + 1, stations[i]!.role, stations[i]!.rate, "talker", stations[i]!.failed > 0.3 ? 1 : 0);
    }
  }

  const legend: MetroLegendLine[] = [...legendMap.entries()].slice(0, 6).map(([label, hue]) => ({ label, hue }));

  const disruptions: string[] = [];
  if (fail > 0.15) disruptions.push(`SERVICE ALERT · ${Math.round(fail * 100)}% host stress`);
  for (const s of stations) {
    if (s.failed > 0.25) disruptions.push(`DISRUPTION · ${s.label} limited service`);
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
    const maxT = Math.min(opts.maxTrains, METRO_MAX_TRAINS);
    this.trains.length = 0;
    for (let i = 0; i < maxT; i++) {
      const tr = this.trainPool[i]!;
      const edgeIdx = i % Math.max(1, net.edges.length);
      const edge = net.edges[edgeIdx];
      if (!edge) continue;
      const pkt = packets[i % Math.max(1, packets.length)];
      const speed = (0.15 + (pkt?.field ?? 0.4) * 0.55) * opts.trainSpeed * (opts.reducedMotion ? 0.35 : 1);
      const len = Math.min(0.22, 0.04 + (pkt?.size ?? 200) / 6000);
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

function packStationLabels(stations: MetroStation[]): number[] {
  const buf: number[] = [];
  for (let i = 0; i < METRO_MAX_STATIONS; i++) {
    const s = stations[i];
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
    const s = net.stations[i];
    stBuf.push(
      s?.x ?? 0,
      s?.y ?? 0,
      s?.role ?? 0,
      s ? s.rate * 0.5 + s.failed * 0.5 : 0,
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
