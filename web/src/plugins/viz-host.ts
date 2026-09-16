import type { Device, StateMsg } from "../core/types";
import { PLUGIN_SKY_UNIFORMS } from "../graph/backdrop";

/** Target frame budget for viz plugin work (60 fps). */
export const VIZ_FRAME_BUDGET_MS = 16.7;

export const VIZ_DEFAULT_MAX_BUFFERS = 4;
export const VIZ_DEFAULT_MAX_BUFFER_FLOATS = 64;
export const VIZ_DEFAULT_MAX_PARTICLES = 4096;

export const VIZ_MAX_PACKET_SAMPLES = 32;
export const VIZ_MAX_RF_SAMPLES = 24;
export const VIZ_MAX_TALKER_SAMPLES = 24;

export type VizSkyUniform = (typeof PLUGIN_SKY_UNIFORMS)[number];

export interface VizPluginContract {
  maxBuffers: number;
  maxBufferFloats: number;
  maxParticles: number;
  graphWalk: false;
  uniforms: VizSkyUniform[];
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

const SKY_UNIFORM_SET = new Set<string>(PLUGIN_SKY_UNIFORMS);

export function isVizCapability(cap: string): boolean {
  return cap === "viz.read" || cap === "viz.write";
}

export function pluginNeedsVizContract(caps: string[] | undefined): boolean {
  return !!caps?.some(isVizCapability);
}

export function defaultVizContract(overrides?: Partial<VizPluginContract>): VizPluginContract {
  return {
    maxBuffers: VIZ_DEFAULT_MAX_BUFFERS,
    maxBufferFloats: VIZ_DEFAULT_MAX_BUFFER_FLOATS,
    maxParticles: VIZ_DEFAULT_MAX_PARTICLES,
    graphWalk: false,
    uniforms: [...PLUGIN_SKY_UNIFORMS],
    ...overrides,
    graphWalk: false,
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
  const maxBuffers = clampInt(doc.maxBuffers, 1, 8, VIZ_DEFAULT_MAX_BUFFERS);
  const maxBufferFloats = clampInt(doc.maxBufferFloats, 4, 256, VIZ_DEFAULT_MAX_BUFFER_FLOATS);
  const maxParticles = clampInt(doc.maxParticles, 0, 8192, 0);
  return { maxBuffers, maxBufferFloats, maxParticles, graphWalk: false, uniforms };
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

function topTalkers(devices: Device[], limit: number): VizTalkerSample[] {
  const ranked = devices
    .filter((d) => d.packets > 0)
    .sort((a, b) => b.packets - a.packets)
    .slice(0, limit);
  return ranked.map((d) => ({ id: d.ip, rate: d.packets, role: d.role }));
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

function packetSamples(state: StateMsg, limit: number): VizPacketSample[] {
  const tallies = new Map<string, number>();
  for (const flow of state.flows) {
    for (const proto of flow.protos ?? []) {
      tallies.set(proto, (tallies.get(proto) ?? 0) + flow.packets);
    }
  }
  return [...tallies.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([proto, count]) => ({
      proto,
      size: count,
      field: packetField(count),
    }));
}

/**
 * Build a decimated data frame from monitor state. Does not walk the full graph —
 * only capped top-N slices are included.
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

/** Enforces per-slot float caps and buffer index bounds. */
export class VizBufferWriter {
  readonly contract: VizPluginContract;
  private readonly slots: Float32Array[];

  constructor(contract: VizPluginContract) {
    this.contract = contract;
    this.slots = Array.from({ length: contract.maxBuffers }, () => new Float32Array(0));
  }

  writeBuffer(slot: number, data: ArrayLike<number>): VizBufferWriteResult {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.contract.maxBuffers) {
      return { ok: false, error: `buffer slot ${slot} out of range (max ${this.contract.maxBuffers})` };
    }
    const len = data.length;
    if (len > this.contract.maxBufferFloats) {
      return { ok: false, error: `buffer write ${len} floats exceeds cap ${this.contract.maxBufferFloats}` };
    }
    const buf = new Float32Array(len);
    for (let i = 0; i < len; i++) buf[i] = Number(data[i]) || 0;
    this.slots[slot] = buf;
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
    return { ok: true, written: count };
  }

  snapshot(slot: number): Float32Array {
    return this.slots[slot] ?? new Float32Array(0);
  }
}
