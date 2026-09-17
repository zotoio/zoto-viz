import type { Device, StateMsg } from "../core/types";
import { PLUGIN_SKY_UNIFORMS } from "./plugin-sky-uniforms";

/** Target frame budget for viz plugin work (60 fps). */
export const VIZ_FRAME_BUDGET_MS = 16.7;

export const VIZ_DEFAULT_MAX_BUFFERS = 4;
export const VIZ_DEFAULT_MAX_BUFFER_FLOATS = 64;
export const VIZ_DEFAULT_MAX_PARTICLES = 4096;

export const VIZ_MAX_PACKET_SAMPLES = 32;
export const VIZ_MAX_RF_SAMPLES = 24;
export const VIZ_MAX_TALKER_SAMPLES = 24;

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
 * GLSL preamble for the fixed std140 block. The host binds this at
 * `binding` 0 as `zotoVizSlots` (vec4[128]); slot `s` float `f` is
 * `zotoVizSlots[s * 16 + f / 4][f % 4]`.
 */
export const VIZ_UBO_GLSL = `layout(std140, binding = ${VIZ_UBO.binding}) uniform ${VIZ_UBO.block} {
  vec4 ${VIZ_UBO.threeUniform}[${VIZ_UBO.totalVec4s}];
};`;

export type VizSkyUniform = (typeof PLUGIN_SKY_UNIFORMS)[number];

export interface VizPluginContract {
  maxBuffers: number;
  maxBufferFloats: number;
  maxParticles: number;
  graphWalk: false;
  uniforms: VizSkyUniform[];
  ubo: typeof VIZ_UBO;
}

export interface VizPacketSample {
  proto: string;
  size: number;
  /** Normalized 0..1 field derived from packet size (no graph walk). */
  field: number;
}

export interface VizRfBeacon {
  ssid: string;
  rssi: number;
  channel: number;
}

export interface VizTalkerSample {
  id: string;
  rate: number;
  role: string;
}

/** Host-decimated snapshot delivered to viz.read plugins each frame. */
export interface VizDataFrame {
  t: number;
  dt: number;
  audio: number;
  packets: VizPacketSample[];
  rf: VizRfBeacon[];
  talkers: VizTalkerSample[];
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
    maxBuffers: VIZ_DEFAULT_MAX_BUFFERS,
    maxBufferFloats: VIZ_DEFAULT_MAX_BUFFER_FLOATS,
    maxParticles: VIZ_DEFAULT_MAX_PARTICLES,
    uniforms: [...PLUGIN_SKY_UNIFORMS],
    ...overrides,
    graphWalk: false,
    ubo: VIZ_UBO,
  };
}

/** Parse plugin.yml ``viz`` block into a normalized contract. */
export function parseVizContract(raw: unknown): VizPluginContract | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const doc = raw as Record<string, unknown>;
  if (doc.graphWalk !== false) return undefined;
  const uniforms = Array.isArray(doc.uniforms)
    ? doc.uniforms.filter((u): u is VizSkyUniform => typeof u === "string" && SKY_UNIFORM_SET.has(u))
    : [...PLUGIN_SKY_UNIFORMS];
  const maxBuffers = clampInt(doc.maxBuffers, 1, VIZ_UBO.slotCount, VIZ_DEFAULT_MAX_BUFFERS);
  const maxBufferFloats = clampInt(doc.maxBufferFloats, 4, VIZ_UBO.slotFloats, VIZ_DEFAULT_MAX_BUFFER_FLOATS);
  const maxParticles = clampInt(doc.maxParticles, 0, 8192, 0);
  return { maxBuffers, maxBufferFloats, maxParticles, graphWalk: false, uniforms, ubo: VIZ_UBO };
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

function topTalkers(devices: Device[], limit: number): VizTalkerSample[] {
  return topKByScore(
    devices,
    limit,
    (d) => d.packets,
    (d) => d.packets <= 0,
  ).map((d) => ({ id: d.ip, rate: d.packets, role: d.role }));
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
export function buildVizFrame(state: StateMsg, prevTs = 0, audio = 0): VizDataFrame {
  const t = state.ts || Date.now() / 1000;
  const dt = prevTs > 0 ? Math.max(0, t - prevTs) : 0;
  return {
    t,
    dt,
    audio: Math.min(1, Math.max(0, audio)),
    packets: packetSamples(state, VIZ_MAX_PACKET_SAMPLES),
    rf: rfBeacons(state, VIZ_MAX_RF_SAMPLES),
    talkers: topTalkers(state.devices, VIZ_MAX_TALKER_SAMPLES),
  };
}

/** Tracks viz frame-path timing against {@link VIZ_FRAME_BUDGET_MS}. */
export class VizFrameBudget {
  private _lastMs = 0;
  private _overBudget = 0;
  private _skipped = 0;
  private _total = 0;
  private _lastBuilt: VizDataFrame | null = null;
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
