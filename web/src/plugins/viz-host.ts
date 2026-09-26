import type { Device, Flow, StateMsg } from "../core/types";
import { parseSourceBind, sourceHeadlines, type SourceBind } from "../core/sources";
import { buildIdleVizFrame } from "./fixtures/idle-viz-frame";
import { applyVizFrameContractV2, resolveVizFrameCollectOpts } from "./viz-frame-collect";
import { PLUGIN_SKY_UNIFORMS } from "./plugin-sky-uniforms";

/** Target frame budget for viz plugin work (60 fps). */
export const VIZ_FRAME_BUDGET_MS = 16.7;

export const VIZ_DEFAULT_MAX_BUFFERS = 4;
export const VIZ_DEFAULT_MAX_BUFFER_FLOATS = 64;
export const VIZ_DEFAULT_MAX_PARTICLES = 4096;

export const VIZ_MAX_PACKET_SAMPLES = 32;
export const VIZ_MAX_RF_SAMPLES = 24;
export const VIZ_MAX_TALKER_SAMPLES = 24;
export const VIZ_MAX_HEADLINE_SAMPLES = 64;

/** Pack-declared viz frame versions the host understands. */
export const SUPPORTED_PACK_VIZ_CONTRACTS = [1, 2] as const;
export type PackVizContractVersion = (typeof SUPPORTED_PACK_VIZ_CONTRACTS)[number];

export type VizContractParseResult =
  | { state: "ready"; contract: VizPluginContract }
  | { state: "Blocked"; reason: string };

/** Fixed std140 UBO layout — locked in schema `$defs/vizUboLayout`. */
export const VIZ_UBO = {
  block: "ZotoVizData",
  binding: 0,
  layout: "std140" as const,
  slotCount: 8,
  slotFloats: 64,
  slotVec4s: 16,
  totalVec4s: 128,
  totalFloats: 512,
  totalBytes: 2048,
  threeUniform: "zotoVizSlots",
} as const;

/**
 * Portable GLSL for the host slot mirror. A `layout(std140, binding=N)` UBO is
 * rejected on many WebGL2 drivers (`binding` is not a valid qualifier there),
 * so the host injects a plain vec4 array that Three.js can set from the same
 * 512-float buffer. Slot `s` float `f` is `zotoVizSlots[s * 16 + f / 4][f % 4]`.
 */
export const VIZ_UBO_GLSL = `uniform vec4 ${VIZ_UBO.threeUniform}[${VIZ_UBO.totalVec4s}];`;

export type VizSkyUniform = (typeof PLUGIN_SKY_UNIFORMS)[number];

export type VizIdleInline = Pick<VizDataFrame, "packets" | "rf" | "talkers" | "headlines"> & {
  audio?: number;
};

/** `fixture: host` uses {@link buildIdleVizFrame}; inline carries static demo slices. */
export type VizIdleConfig =
  | { fixture: "host" }
  | { inline: VizIdleInline };

export interface VizPluginContract {
  /** Pack-declared VizDataFrame slice version (1 or 2) negotiated from plugin.yml `viz.contract`. */
  contract: PackVizContractVersion;
  maxBuffers: number;
  maxBufferFloats: number;
  maxParticles: number;
  graphWalk: false;
  uniforms: VizSkyUniform[];
  ubo: typeof VIZ_UBO;
  idle: VizIdleConfig;
}

export type {
  VizDataFrame,
  VizHeadline,
  VizLinkSample,
  VizPacketSample,
  VizRfBeacon,
  VizSysTelemetry,
  VizTalkerSample,
} from "../../../plugins/sdk/viz-contract";
export { EMPTY_SYS_TELEMETRY, VIZ_CONTRACT_VERSION } from "../../../plugins/sdk/viz-contract";
import type {
  VizDataFrame,
  VizHeadline,
  VizPacketSample,
  VizRfBeacon,
  VizSysTelemetry,
  VizTalkerSample,
} from "../../../plugins/sdk/viz-contract";
import { EMPTY_SYS_TELEMETRY, VIZ_CONTRACT_VERSION } from "../../../plugins/sdk/viz-contract";

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function hubCpu(view: { devices?: Device[]; hub?: string } | undefined): number {
  if (!view?.devices?.length) return 0;
  const hub = view.hub;
  const row = view.devices.find((d) => d.ip === hub) ?? view.devices[0];
  return clamp01((row?.cpu ?? 0) / 100);
}

function aliasNum(aliases: string[] | undefined, re: RegExp): number {
  for (const a of aliases ?? []) {
    const m = a.match(re);
    if (m) return Number(m[1]) || 0;
  }
  return 0;
}

/** Pull 0..1 SYS gauges from `views.*` without walking the LAN graph. */
export function extractSysTelemetry(state: StateMsg): VizSysTelemetry {
  const views = state.views ?? {};
  const cpuView = views.cpu;
  const mem = views.memory;
  const thermal = cpuView?.thermal ?? views.bridge?.thermal;
  const psi = Math.max(
    0,
    ...(mem?.devices ?? [])
      .filter((d) => d.ip.startsWith("psi:"))
      .map((d) => (d.cpu ?? 0) / 100),
  );
  const failed = aliasNum(views.units?.devices?.find((d) => d.ip === views.units?.hub)?.aliases, /(\d+)\s+failed/);
  const udevEvents = aliasNum(views.udev?.devices?.find((d) => d.ip === views.udev?.hub)?.aliases, /(\d+)\s+events/);
  const sockN = views.sockets?.devices?.find((d) => d.ip === views.sockets?.hub)?.packets ?? 0;
  return {
    cpu: hubCpu(cpuView),
    mem: hubCpu(mem),
    disk: hubCpu(views.disk),
    gpu: hubCpu(views.gpu),
    temp: clamp01(((thermal?.pkg_c ?? 0) - 40) / 50),
    watts: clamp01((thermal?.gpu_w || thermal?.rapl_w || 0) / 200),
    psi: clamp01(psi),
    sockets: clamp01(sockN / 64),
    failed: clamp01(failed / 4),
    udev: clamp01(udevEvents / 24),
  };
}

export type VizUniformValue = number | [number, number, number];

export interface VizBufferWriteResult {
  ok: boolean;
  error?: string;
}

export interface VizParticleWriteResult extends VizBufferWriteResult {
  written: number;
}

export interface VizFrameBudgetStats {
  lastMs: number;
  overBudget: number;
  skipped: number;
  total: number;
}

const SKY_UNIFORM_SET = new Set<string>(PLUGIN_SKY_UNIFORMS);

export function isVizCapability(cap: string): boolean {
  return cap === "viz.read" || cap === "viz.write";
}

export function pluginNeedsVizContract(caps: string[] | undefined): boolean {
  return !!caps?.some(isVizCapability);
}

export function defaultVizContract(overrides?: Partial<Omit<VizPluginContract, "ubo" | "graphWalk">>): VizPluginContract {
  return {
    contract: 2,
    maxBuffers: VIZ_DEFAULT_MAX_BUFFERS,
    maxBufferFloats: VIZ_DEFAULT_MAX_BUFFER_FLOATS,
    maxParticles: VIZ_DEFAULT_MAX_PARTICLES,
    uniforms: [...PLUGIN_SKY_UNIFORMS],
    idle: { fixture: "host" },
    ...overrides,
    graphWalk: false,
    ubo: VIZ_UBO,
  };
}

function parsePacketSample(raw: unknown): VizPacketSample | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const proto = typeof row.proto === "string" ? row.proto : "";
  const size = typeof row.size === "number" ? row.size : Number(row.size);
  const field = typeof row.field === "number" ? row.field : Number(row.field);
  if (!proto || !Number.isFinite(size) || !Number.isFinite(field)) return null;
  return { proto, size, field: clamp01(field) };
}

function parseRfBeacon(raw: unknown): VizRfBeacon | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const ssid = typeof row.ssid === "string" ? row.ssid : "";
  const rssi = typeof row.rssi === "number" ? row.rssi : Number(row.rssi);
  const channel = typeof row.channel === "number" ? row.channel : Number(row.channel);
  if (!ssid || !Number.isFinite(rssi) || !Number.isFinite(channel)) return null;
  return { ssid, rssi: clamp01(rssi), channel };
}

function parseTalkerSample(raw: unknown): VizTalkerSample | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const rate = typeof row.rate === "number" ? row.rate : Number(row.rate);
  const role = typeof row.role === "string" ? row.role : "";
  if (!id || !Number.isFinite(rate) || !role) return null;
  const failedRaw = row.failed;
  const failed = typeof failedRaw === "number" && Number.isFinite(failedRaw)
    ? clamp01(failedRaw)
    : undefined;
  return failed !== undefined ? { id, rate, role, failed } : { id, rate, role };
}

function parseHeadline(raw: unknown): VizHeadline | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const label = typeof row.label === "string" ? row.label : "";
  const text = typeof row.text === "string" ? row.text : "";
  if (!id || !label || !text) return null;
  const out: VizHeadline = { id, label, text: text.slice(0, 240) };
  if (typeof row.kind === "string") out.kind = row.kind;
  if (typeof row.summary === "string") out.summary = row.summary;
  if (typeof row.image === "string") out.image = row.image;
  return out;
}

function parseSlice<T>(raw: unknown, parse: (row: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const row of raw) {
    const item = parse(row);
    if (item) out.push(item);
  }
  return out;
}

/** Parse plugin.yml ``viz.idle`` — host fixture or inline demo seed. */
export function parseVizIdle(raw: unknown): VizIdleConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const doc = raw as Record<string, unknown>;
  if (doc.fixture === "host") return { fixture: "host" };
  const inline: VizIdleInline = {
    packets: parseSlice(doc.packets, parsePacketSample),
    rf: parseSlice(doc.rf, parseRfBeacon),
    talkers: parseSlice(doc.talkers, parseTalkerSample),
    headlines: parseSlice(doc.headlines, parseHeadline),
  };
  if (typeof doc.audio === "number" && Number.isFinite(doc.audio)) {
    inline.audio = clamp01(doc.audio);
  }
  const hasSlice = inline.packets.length > 0 || inline.rf.length > 0
    || inline.talkers.length > 0 || inline.headlines.length > 0;
  return hasSlice ? { inline } : undefined;
}

function idleSeedFrame(live: VizDataFrame, idle: VizIdleConfig): VizDataFrame {
  if ("fixture" in idle) return buildIdleVizFrame(live.t, live.dt);
  const seed = idle.inline;
  return {
    t: live.t,
    dt: live.dt,
    audio: seed.audio ?? 0.12,
    packets: seed.packets,
    rf: seed.rf,
    talkers: seed.talkers,
    headlines: seed.headlines,
    sys: live.sys,
  };
}

/**
 * Merge idle demo slices into a live frame. Non-empty live slices always win;
 * idle fills only empty packets / rf / talkers / headlines.
 */
export function mergeVizIdleFrame(live: VizDataFrame, idle: VizIdleConfig): VizDataFrame {
  const needsPackets = live.packets.length === 0;
  const needsRf = live.rf.length === 0;
  const needsTalkers = live.talkers.length === 0;
  const needsHeadlines = live.headlines.length === 0;
  if (!needsPackets && !needsRf && !needsTalkers && !needsHeadlines) return live;

  const seed = idleSeedFrame(live, idle);
  const demoSlices: NonNullable<VizDataFrame["demoSlices"]> = {};
  if (needsPackets) demoSlices.packets = true;
  if (needsRf) demoSlices.rf = true;
  if (needsTalkers) demoSlices.talkers = true;
  if (needsHeadlines) demoSlices.headlines = true;
  return {
    ...live,
    audio: live.audio > 0 ? live.audio : seed.audio,
    packets: needsPackets ? seed.packets : live.packets,
    rf: needsRf ? seed.rf : live.rf,
    talkers: needsTalkers ? seed.talkers : live.talkers,
    headlines: needsHeadlines ? seed.headlines : live.headlines,
    demo: true,
    demoSlices,
  };
}

function parsePackContractVersion(raw: unknown): PackVizContractVersion | "missing" | { blocked: string } {
  if (raw === undefined || raw === null) return "missing";
  if (typeof raw !== "number") {
    return { blocked: "viz.contract must be a whole number (1 or 2)." };
  }
  if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
    return { blocked: "viz.contract must be a whole number (1 or 2)." };
  }
  if (raw === 1 || raw === 2) return raw as PackVizContractVersion;
  return { blocked: `viz.contract ${raw} is not supported; use 1 or 2.` };
}

/** Parse plugin.yml ``viz`` block into a normalized contract or a blocked reason. */
export function parseVizContractResult(raw: unknown): VizContractParseResult | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const doc = raw as Record<string, unknown>;
  if (doc.graphWalk !== false) return undefined;
  const idle = parseVizIdle(doc.idle);
  if (!idle) return undefined;
  const versionParse = parsePackContractVersion(doc.contract);
  if (typeof versionParse === "object" && "blocked" in versionParse) {
    return { state: "Blocked", reason: versionParse.blocked };
  }
  const contractVersion: PackVizContractVersion = versionParse === "missing" ? 1 : versionParse;
  const uniforms = Array.isArray(doc.uniforms)
    ? doc.uniforms.filter((u): u is VizSkyUniform => typeof u === "string" && SKY_UNIFORM_SET.has(u))
    : [...PLUGIN_SKY_UNIFORMS];
  const maxBuffers = clampInt(doc.maxBuffers, 1, VIZ_UBO.slotCount, VIZ_DEFAULT_MAX_BUFFERS);
  const maxBufferFloats = clampInt(doc.maxBufferFloats, 4, VIZ_UBO.slotFloats, VIZ_DEFAULT_MAX_BUFFER_FLOATS);
  const maxParticles = clampInt(doc.maxParticles, 0, 8192, 0);
  return {
    state: "ready",
    contract: {
      maxBuffers,
      maxBufferFloats,
      maxParticles,
      contract: contractVersion,
      graphWalk: false,
      uniforms,
      ubo: VIZ_UBO,
      idle,
    },
  };
}

/** Parse plugin.yml ``viz`` block into a normalized contract. */
export function parseVizContract(raw: unknown): VizPluginContract | undefined {
  const parsed = parseVizContractResult(raw);
  return parsed?.state === "ready" ? parsed.contract : undefined;
}

function clampInt(raw: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

function packetField(size: number): number {
  return Math.min(1, Math.max(0, Math.log10(1 + size) / 5));
}

function normalizeRssi(rssi: number): number {
  return Math.min(1, Math.max(0, (rssi + 100) / 100));
}

/** Bounded top-K by score — O(n·k), never sorts the full input. */
export function topKByScore<T>(
  items: Iterable<T>,
  limit: number,
  score: (item: T) => number,
  skip: (item: T) => boolean = () => false,
): T[] {
  if (limit <= 0) return [];
  const buf: { score: number; item: T }[] = [];
  for (const item of items) {
    if (skip(item)) continue;
    const s = score(item);
    if (s <= 0) continue;
    if (buf.length < limit) {
      buf.push({ score: s, item });
      continue;
    }
    let minI = 0;
    for (let i = 1; i < buf.length; i++) {
      if (buf[i].score < buf[minI].score) minI = i;
    }
    if (s <= buf[minI].score) continue;
    buf[minI] = { score: s, item };
  }
  if (buf.length <= 1) return buf.map((x) => x.item);
  buf.sort((a, b) => b.score - a.score);
  return buf.map((x) => x.item);
}

function directionalPacketRate(flow: Flow, ab: boolean): number {
  const direct = ab ? flow.rate_pkt_ab : flow.rate_pkt_ba;
  if (typeof direct === "number" && direct > 0) return direct;
  const byteRate = ab ? flow.rate_ab : flow.rate_ba;
  if (typeof byteRate !== "number" || byteRate <= 0) return 0;
  const avgBytes = flow.bytes / Math.max(1, flow.packets);
  return byteRate / Math.max(1, avgBytes);
}

const devicePacketRateScratch = new Map<string, number>();

function devicePacketRateMap(flows: Flow[]): Map<string, number> {
  devicePacketRateScratch.clear();
  for (const fl of flows) {
    const ab = directionalPacketRate(fl, true);
    if (ab > 0) devicePacketRateScratch.set(fl.a, (devicePacketRateScratch.get(fl.a) ?? 0) + ab);
    const ba = directionalPacketRate(fl, false);
    if (ba > 0) devicePacketRateScratch.set(fl.b, (devicePacketRateScratch.get(fl.b) ?? 0) + ba);
  }
  return devicePacketRateScratch;
}

function hasLivePacketRates(rates: Map<string, number>): boolean {
  for (const v of rates.values()) {
    if (v > 0) return true;
  }
  return false;
}

function talkerScore(d: Device, rates: Map<string, number>, liveMode: boolean): number {
  if (liveMode) return rates.get(d.ip) ?? 0;
  return d.packets;
}

function topTalkers(devices: Device[], flows: Flow[], limit: number, forceLifetimeRates = false): VizTalkerSample[] {
  const rates = devicePacketRateMap(flows);
  const liveMode = !forceLifetimeRates && hasLivePacketRates(rates);
  return topKByScore(
    devices,
    limit,
    (d) => talkerScore(d, rates, liveMode),
    (d) => talkerScore(d, rates, liveMode) <= 0,
  ).map((d) => ({ id: d.ip, rate: talkerScore(d, rates, liveMode), role: d.role }));
}

function rssiFromAliases(aliases: string[] | undefined): number {
  const tag = (aliases ?? []).find((a) => a.endsWith(" dBm"));
  if (!tag) return -70;
  const n = Number(tag.replace(" dBm", ""));
  return Number.isFinite(n) ? n : -70;
}

function rfBeacons(state: StateMsg, limit: number): VizRfBeacon[] {
  const wifi = state.views?.wifi;
  if (!wifi?.watch?.ssids?.length) return [];
  const out: VizRfBeacon[] = [];
  for (const ssid of wifi.watch.ssids.slice(0, limit)) {
    const dev = wifi.devices.find((d) => d.ssid === ssid || (d.names ?? []).includes(ssid));
    out.push({
      ssid,
      rssi: normalizeRssi(rssiFromAliases(dev?.aliases)),
      channel: dev?.chan ?? 0,
    });
  }
  return out;
}

type ProtoTop = { proto: string; count: number };

function upsertProtoTop(top: ProtoTop[], limit: number, proto: string, count: number): void {
  const i = top.findIndex((x) => x.proto === proto);
  if (i >= 0) {
    top[i].count = count;
    return;
  }
  if (top.length < limit) {
    top.push({ proto, count });
    return;
  }
  let minI = 0;
  for (let j = 1; j < top.length; j++) {
    if (top[j].count < top[minI].count) minI = j;
  }
  if (count > top[minI].count) top[minI] = { proto, count };
}

function packetSamples(state: StateMsg, limit: number): VizPacketSample[] {
  const counts = new Map<string, number>();
  const top: ProtoTop[] = [];
  for (const flow of state.flows) {
    for (const proto of flow.protos ?? []) {
      const count = (counts.get(proto) ?? 0) + flow.packets;
      counts.set(proto, count);
      upsertProtoTop(top, limit, proto, count);
    }
  }
  if (top.length <= 1) {
    return top.map(({ proto, count }) => ({ proto, size: count, field: packetField(count) }));
  }
  top.sort((a, b) => b.count - a.count);
  return top.map(({ proto, count }) => ({ proto, size: count, field: packetField(count) }));
}

/**
 * Build a decimated data frame from monitor state. Selection cost scales with
 * the output cap (top-K), not the full device / flow lists.
 */
export function buildVizFrame(state: StateMsg, prevTs = 0, audio = 0, bind?: SourceBind | Record<string, string>): VizDataFrame {
  return applyVizFrameContractV2(
    buildVizFrameCore(state, prevTs, audio, bind),
    state,
    resolveVizFrameCollectOpts(state),
  );
}

/** Host build used when v1 packs are registered: lifetime talker rates, contract 1 input to the v1 adapter. */
export function buildVizFrameForV1AdapterDelivery(
  state: StateMsg,
  prevTs: number,
  audio: number,
  idle: VizIdleConfig | undefined,
  bind?: SourceBind | Record<string, string>,
): VizDataFrame {
  if (idle) return buildVizFrameForPlugin(state, prevTs, audio, idle, 1, bind);
  const merged = buildVizFrameCore(state, prevTs, audio, bind, true);
  merged.contract = 1;
  return merged;
}

function buildVizFrameCore(
  state: StateMsg,
  prevTs = 0,
  audio = 0,
  bind?: SourceBind | Record<string, string>,
  forceLifetimeTalkerRates = false,
): VizDataFrame {
  const t = state.ts || Date.now() / 1000;
  const dt = prevTs > 0 ? Math.max(0, t - prevTs) : 0;
  const parsed = bind && "source" in bind ? parseSourceBind(bind as Record<string, string>) : bind;
  return {
    t,
    dt,
    audio: Math.min(1, Math.max(0, audio)),
    packets: packetSamples(state, VIZ_MAX_PACKET_SAMPLES),
    rf: rfBeacons(state, VIZ_MAX_RF_SAMPLES),
    talkers: topTalkers(state.devices, state.flows, VIZ_MAX_TALKER_SAMPLES, forceLifetimeTalkerRates),
    headlines: sourceHeadlines(state.sources, VIZ_MAX_HEADLINE_SAMPLES, parsed).map((h) => ({
      id: h.id,
      label: h.label,
      text: h.text.slice(0, 240),
      kind: h.kind,
      summary: h.summary,
      image: h.image,
    })),
    sys: extractSysTelemetry(state),
  };
}

/** Build a live frame and merge idle demo slices when monitor traffic is absent. */
export function buildVizFrameForPlugin(
  state: StateMsg,
  prevTs: number,
  audio: number,
  idle: VizIdleConfig,
  packContract: PackVizContractVersion | number = 1,
  bind?: SourceBind | Record<string, string>,
): VizDataFrame {
  const version = packContract >= 2 ? 2 : 1;
  const merged = mergeVizIdleFrame(
    buildVizFrameCore(state, prevTs, audio, bind, version < 2),
    idle,
  );
  if (version < 2) {
    merged.contract = 1;
    return merged;
  }
  return applyVizFrameContractV2(merged, state, resolveVizFrameCollectOpts(state));
}

/** Tracks viz frame-path timing against {@link VIZ_FRAME_BUDGET_MS}. */
export class VizFrameBudget {
  private _lastMs = 0;
  private _overBudget = 0;
  private _skipped = 0;
  private _total = 0;
  private _lastBuilt: VizDataFrame | null = null;
  private _lastPresent = -1;
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  get stats(): VizFrameBudgetStats {
    return {
      lastMs: this._lastMs,
      overBudget: this._overBudget,
      skipped: this._skipped,
      total: this._total,
    };
  }

  /** Last frame built by deliver(), including over-budget skips (for CPU HUD metrics). */
  get lastBuilt(): VizDataFrame | null {
    return this._lastBuilt;
  }

  /** Record a measured duration; returns true when over budget. */
  record(ms: number): boolean {
    this._total++;
    this._lastMs = ms;
    if (ms > VIZ_FRAME_BUDGET_MS) {
      this._overBudget++;
      return true;
    }
    return false;
  }

  /**
   * Record present-to-present frame time from the shared rAF path. When the
   * interval exceeds {@link VIZ_FRAME_BUDGET_MS}, increments the same skip
   * counter the HUD reads so soft-FPS cannot look green while GPU/compositor
   * work is over budget.
   */
  markPresent(ts: number): void {
    if (this._lastPresent >= 0) {
      const over = this.record(ts - this._lastPresent);
      if (over) this._skipped++;
    }
    this._lastPresent = ts;
  }

  /**
   * Build and optionally deliver a viz frame. Over-budget frames are skipped
   * (not delivered) and the over-budget counter increments.
   */
  deliver(
    state: StateMsg,
    prevTs: number,
    audio: number,
    onFrame: (frame: VizDataFrame) => void,
    build: (state: StateMsg, prevTs: number, audio: number) => VizDataFrame = buildVizFrame,
  ): VizDataFrame | null {
    const t0 = this.now();
    const frame = build(state, prevTs, audio);
    this._lastBuilt = frame;
    const over = this.record(this.now() - t0);
    if (over) {
      this._skipped++;
      return null;
    }
    onFrame(frame);
    return frame;
  }

  reset(): void {
    this._lastMs = 0;
    this._overBudget = 0;
    this._skipped = 0;
    this._total = 0;
    this._lastBuilt = null;
    this._lastPresent = -1;
  }
}

export interface VizWriterBindResult {
  writer: VizBufferWriter | null;
  resetFrameTs: boolean;
  resetBudget: boolean;
}

/**
 * Core viz-writer rebind used by the host on plugin load / demo pack swap.
 * When `preserveUbo` is true and a prior writer exists, UBO bytes are copied and
 * frame timestamp + budget counters are left for the caller to keep.
 */
export function bindVizWriterCore(
  prevWriter: VizBufferWriter | null,
  contract: VizPluginContract | null | undefined,
  preserveUbo = false,
): VizWriterBindResult {
  if (!contract) {
    return { writer: null, resetFrameTs: true, resetBudget: true };
  }
  if (preserveUbo && prevWriter) {
    const writer = new VizBufferWriter(contract);
    writer.ubo.set(prevWriter.ubo);
    return { writer, resetFrameTs: false, resetBudget: false };
  }
  return { writer: new VizBufferWriter(contract), resetFrameTs: true, resetBudget: true };
}

/** Enforces per-slot float caps; reuses preallocated slot + UBO buffers. */
export class VizBufferWriter {
  readonly contract: VizPluginContract;
  /** std140 mirror backing store (8 × 64 floats). */
  readonly ubo: Float32Array;
  private readonly slots: Float32Array[];
  private readonly lengths: Uint16Array;
  private readonly particles: Float32Array;
  private particleCount = 0;

  constructor(contract: VizPluginContract) {
    this.contract = contract;
    this.ubo = new Float32Array(VIZ_UBO.totalFloats);
    this.slots = Array.from(
      { length: contract.maxBuffers },
      (_, i) => this.ubo.subarray(i * VIZ_UBO.slotFloats, (i + 1) * VIZ_UBO.slotFloats),
    );
    this.lengths = new Uint16Array(contract.maxBuffers);
    this.particles = contract.maxParticles > 0
      ? new Float32Array(contract.maxParticles * 4)
      : new Float32Array(0);
  }

  writeBuffer(slot: number, data: ArrayLike<number>): VizBufferWriteResult {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.contract.maxBuffers) {
      return { ok: false, error: `buffer slot ${slot} out of range (max ${this.contract.maxBuffers})` };
    }
    const len = data.length;
    if (len > this.contract.maxBufferFloats) {
      return { ok: false, error: `buffer write ${len} floats exceeds cap ${this.contract.maxBufferFloats}` };
    }
    const buf = this.slots[slot];
    for (let i = 0; i < len; i++) buf[i] = Number(data[i]) || 0;
    for (let i = len; i < buf.length; i++) buf[i] = 0;
    this.lengths[slot] = len;
    return { ok: true };
  }

  writeUniform(name: string, value: VizUniformValue): VizBufferWriteResult {
    if (!this.contract.uniforms.includes(name as VizSkyUniform)) {
      return { ok: false, error: `uniform ${name} not in contract` };
    }
    if (name === "uAccent" || name === "uBg") {
      if (!Array.isArray(value) || value.length !== 3) {
        return { ok: false, error: `${name} requires vec3` };
      }
      return { ok: true };
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: `${name} requires float` };
    }
    return { ok: true };
  }

  writeParticles(data: ArrayLike<number>, stride = 4): VizParticleWriteResult {
    const cap = this.contract.maxParticles;
    if (cap <= 0) return { ok: false, written: 0, error: "particles disabled (maxParticles is 0)" };
    if (stride < 1 || stride > 8) return { ok: false, written: 0, error: "invalid particle stride" };
    const count = Math.floor(data.length / stride);
    if (count > cap) {
      return { ok: false, written: 0, error: `particle count ${count} exceeds cap ${cap}` };
    }
    const n = count * stride;
    for (let i = 0; i < n; i++) this.particles[i] = Number(data[i]) || 0;
    this.particleCount = count;
    return { ok: true, written: count };
  }

  snapshot(slot: number): Float32Array {
    const len = this.lengths[slot] ?? 0;
    return this.slots[slot]?.subarray(0, len) ?? new Float32Array(0);
  }

  particleSnapshot(): Float32Array {
    return this.particles.subarray(0, this.particleCount * 4);
  }
}
