import type { VizDataFrame, VizPacketSample } from "../../../sdk/viz-contract";
import {
  MARBLE_DATA_MAPPING,
  ZOTO_FAIL_RGB,
  hash01,
  marblePackWorkBudget,
  parseMarbleOptions,
  type MarbleOptions,
} from "./config";
import { jarIndexForRouteKey, MarbleSim, SIM_DT, trackPieceCount } from "./sim";
import { marbleWorkBudget, resetMarbleWorkBudgetFromHost } from "./work-budget";

export type { VizDataFrame, VizPacketSample };

export { MARBLE_DATA_MAPPING, ZOTO_FAIL_RGB };
export {
  CONSERVATIVE_MARBLE_WORK_BUDGET,
  marbleWorkBudget,
  resetMarbleWorkBudgetFromHost,
  setMarbleWorkBudgetFromHost,
} from "./work-budget";

export type MarbleIngestStats = {
  consumedPackets: number;
  poolFull: number;
};

export const MR_SLOT0 = 64;
export const MR_MARBLES_PER_SLOT = 16;
export const MR_MARBLE_FLOATS = 4;

export const MR_SLOT = {
  mark: 0,
  seedNorm: 1,
  simTime: 2,
  jarCount: 3,
  jar0: 4,
  cameraMode: 12,
  camX: 13,
  camY: 14,
  camZ: 15,
  aimX: 16,
  aimY: 17,
  aimZ: 18,
  followId: 19,
  rejectGlow: 20,
  demo: 21,
  reduced: 22,
  material: 23,
  complexity: 24,
  metric: 25,
  activeCount: 26,
  drawCalls: 27,
  failR: 28,
  failG: 29,
  failB: 30,
  hudSkip: 31,
  labelPack0: 32,
} as const;

const LABEL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.- ";

function encodeLabel(text: string, out: number[], offset: number, maxChars: number): void {
  const upper = text.toUpperCase().slice(0, maxChars);
  for (let i = 0; i < maxChars; i++) {
    const ch = upper[i] ?? " ";
    const code = LABEL_CHARS.indexOf(ch);
    out[offset + i] = code >= 0 ? code / (LABEL_CHARS.length - 1) : 0;
  }
}

function metricLabel(opts: MarbleOptions, frame: VizDataFrame): string {
  const metric = frame.demo ? "demo" : "proto";
  return `marble-run · ${opts.preset} · ${metric}`;
}

function marbleRadius(size: number, field: number, opts: MarbleOptions): number {
  if (opts.sizeField === "field") return 0.028 + field * 0.05;
  const clamped = Math.min(1500, Math.max(32, size));
  return 0.025 + (clamped / 1500) * 0.055;
}

export function marbleHueForPacket(pkt: VizPacketSample): number {
  return hash01(pkt.proto || "ip");
}

export function jarRouteKey(pkt: VizPacketSample, opts: MarbleOptions): string {
  if (opts.destField === "hash") return `h:${hash01(pkt.proto).toFixed(8)}`;
  return pkt.proto;
}

export function isFrameFailed(frame: VizDataFrame, opts: MarbleOptions): boolean {
  return (frame.sys?.failed ?? 0) >= opts.failThreshold;
}

let sim: MarbleSim | null = null;
let opts: MarbleOptions | null = null;

function marbleOpts(): MarbleOptions {
  if (!opts) opts = parseMarbleOptions();
  return opts;
}
let dropCooldown = 0;
let hudSkipCount = 0;
let lastIngest: MarbleIngestStats = { consumedPackets: 0, poolFull: 0 };

export function marbleHudSkipCount(): number {
  return hudSkipCount;
}

export function marbleIngestStats(): MarbleIngestStats {
  return lastIngest;
}

export function marbleOptions(): MarbleOptions {
  return marbleOpts();
}

export function setMarbleOptions(next: MarbleOptions): void {
  opts = next;
  if (!sim) sim = new MarbleSim(opts);
  else sim.setOptions(opts);
}

export function marbleSim(): MarbleSim {
  const o = marbleOpts();
  if (!sim) sim = new MarbleSim(o);
  return sim;
}

export function disposeMarblePack(): void {
  sim?.dispose();
  sim = null;
  dropCooldown = 0;
  hudSkipCount = 0;
  lastIngest = { consumedPackets: 0, poolFull: 0 };
  opts = null;
}

function spawnFromPacket(s: MarbleSim, frame: VizDataFrame, pkt: VizPacketSample): boolean {
  const o = marbleOpts();
  const routeKey = jarRouteKey(pkt, o);
  const hue = marbleHueForPacket(pkt);
  const radius = marbleRadius(pkt.size, pkt.field, o);
  const failed = isFrameFailed(frame, o);
  return s.spawn(hue, radius, routeKey, failed);
}

export function ingestFrame(frame: VizDataFrame): void {
  const o = marbleOpts();
  const s = marbleSim();
  s.setOptions(o);
  s.stepFrame(frame.dt > 0 ? frame.dt : SIM_DT);
  dropCooldown -= frame.dt > 0 ? frame.dt : SIM_DT;
  const pkts = frame.packets;
  const cap = marbleWorkBudget().maxPacketsPerFrame;
  let consumedPackets = 0;
  let poolFull = 0;

  if (pkts.length && !frame.demo) {
    const capped = Math.max(0, pkts.length - cap);
    hudSkipCount += capped;
    const take = Math.min(pkts.length, cap);
    for (let i = 0; i < take; i++) {
      const pkt = pkts[i]!;
      if (spawnFromPacket(s, frame, pkt)) consumedPackets++;
      else poolFull++;
    }
  } else if (frame.demo && dropCooldown <= 0) {
    const phase = frame.t % 4;
    const proto = ["tcp", "udp", "dns", "tls"][Math.floor(phase)]!;
    const pkt: VizPacketSample = { proto, size: 128, field: 0.5 };
    const hue = marbleHueForPacket(pkt);
    const radius = 0.035 + 0.02 * Math.sin(frame.t * 0.7);
    const failed = isFrameFailed(frame, o);
    if (s.spawn(hue, radius, jarRouteKey(pkt, o), failed)) {
      consumedPackets = 1;
      dropCooldown = 0.4;
    }
  }

  lastIngest = { consumedPackets, poolFull };
}

function reducedFlag(o: MarbleOptions): number {
  if (o.reducedMotion === "on") return 1;
  if (o.reducedMotion === "off") return 0;
  return 0.5;
}

function cameraPose(s: MarbleSim, o: MarbleOptions, t: number): { cx: number; cy: number; cz: number; ax: number; ay: number; az: number; follow: number } {
  const lead = s.leadMarble();
  const u = lead?.u ?? 0.35 + 0.1 * Math.sin(t * 0.15);
  const reduced = reducedFlag(o) >= 0.5;
  const mode = reduced ? "wide" : o.cameraMode;
  const trackY = 1.2 + Math.sin(u * 6.283) * 0.35;
  const trackX = -1.8 + u * 3.6;
  const trackZ = Math.cos(u * 9.42) * 0.45;
  if (mode === "wide") {
    return { cx: 0, cy: 2.4, cz: 4.2, ax: 0, ay: 1.1, az: 0, follow: -1 };
  }
  if (mode === "orbit") {
    const ang = t * 0.08;
    return {
      cx: Math.sin(ang) * 4.5,
      cy: 2.1 + Math.sin(t * 0.05) * 0.1,
      cz: Math.cos(ang) * 4.5,
      ax: trackX * 0.3,
      ay: trackY,
      az: trackZ,
      follow: -1,
    };
  }
  const pull = 0.35 + 0.25 * (1 - Math.cos(Math.min(1, u) * 3.14159));
  return {
    cx: trackX - 0.6 * pull,
    cy: trackY + 0.35 + pull * 0.2,
    cz: trackZ + 1.1 + pull * 1.6,
    ax: trackX,
    ay: trackY,
    az: trackZ,
    follow: lead?.id ?? -1,
  };
}

export function packMarbleSlots(frame: VizDataFrame): { slot0: number[]; slot1: number[] } {
  const s = marbleSim();
  const o = marbleOpts();
  const slot0 = new Array<number>(MR_SLOT0).fill(0);
  const slot1 = new Array<number>(MR_MARBLES_PER_SLOT * MR_MARBLE_FLOATS).fill(0);
  slot0[MR_SLOT.mark] = 1;
  slot0[MR_SLOT.seedNorm] = (o.seed % 10000) / 10000;
  slot0[MR_SLOT.simTime] = s.time();
  slot0[MR_SLOT.jarCount] = o.jarCount;
  const jars = s.jarFills();
  for (let i = 0; i < 8; i++) {
    slot0[MR_SLOT.jar0 + i] = jars[i]?.fill ?? 0;
  }
  const cam = cameraPose(s, o, frame.t);
  slot0[MR_SLOT.cameraMode] = o.cameraMode === "follow" ? 0 : o.cameraMode === "wide" ? 1 : 2;
  slot0[MR_SLOT.camX] = cam.cx;
  slot0[MR_SLOT.camY] = cam.cy;
  slot0[MR_SLOT.camZ] = cam.cz;
  slot0[MR_SLOT.aimX] = cam.ax;
  slot0[MR_SLOT.aimY] = cam.ay;
  slot0[MR_SLOT.aimZ] = cam.az;
  slot0[MR_SLOT.followId] = cam.follow;
  const failActive = s.bodies().some((m) => m.active && m.failed);
  slot0[MR_SLOT.rejectGlow] = failActive ? 0.85 + 0.15 * Math.sin(frame.t * 2.2) : 0.25;
  slot0[MR_SLOT.demo] = frame.demo ? 1 : 0;
  slot0[MR_SLOT.reduced] = reducedFlag(o);
  slot0[MR_SLOT.material] = { walnut: 0, oak: 1, "brass-glass": 2, bamboo: 3 }[o.materialTheme];
  slot0[MR_SLOT.complexity] = o.complexity;
  slot0[MR_SLOT.metric] = frame.demo ? 0 : hash01(metricLabel(o, frame));
  const active = s.bodies().filter((m) => m.active);
  slot0[MR_SLOT.activeCount] = active.length;
  slot0[MR_SLOT.drawCalls] = s.work.drawCalls;
  slot0[MR_SLOT.failR] = ZOTO_FAIL_RGB[0];
  slot0[MR_SLOT.failG] = ZOTO_FAIL_RGB[1];
  slot0[MR_SLOT.failB] = ZOTO_FAIL_RGB[2];
  slot0[MR_SLOT.hudSkip] = hudSkipCount;
  encodeLabel(metricLabel(o, frame), slot0, MR_SLOT.labelPack0, 24);

  let mi = 0;
  for (const m of active) {
    if (mi >= MR_MARBLES_PER_SLOT) break;
    const base = mi * MR_MARBLE_FLOATS;
    const u = m.flying > 0 ? m.u : m.u;
    slot1[base] = -1.8 + u * 3.6 + m.flyVx * m.flying;
    slot1[base + 1] = 1.15 + Math.sin(u * 6.283) * 0.35 + m.flyVy * m.flying;
    slot1[base + 2] = Math.cos(u * 9.42) * 0.45 + m.flyVz * m.flying;
    slot1[base + 3] = m.hue + (m.failed ? 0.001 : 0) + m.radius * 0.01;
    mi++;
  }

  return { slot0, slot1 };
}

export function workWithinBudget(o: MarbleOptions = marbleOpts()): boolean {
  const s = marbleSim();
  const w = s.work;
  const budget = marblePackWorkBudget();
  return (
    w.drawCalls <= budget.maxDrawCalls
    && w.triangles <= budget.maxTriangles
    && w.instances <= Math.min(o.maxMarbles, budget.maxInstances)
    && w.gpuBytes <= budget.maxGpuBytes
  );
}

export function trackPiecesForPreset(o: MarbleOptions): number {
  return trackPieceCount(o.complexity, o.seed);
}

export function marbleDeterminismDigest(t: number, o: MarbleOptions): number {
  disposeMarblePack();
  setMarbleOptions(o);
  const frame: VizDataFrame = {
    t,
    dt: SIM_DT,
    audio: 0.1,
    packets: [{ proto: "tcp", size: 400, field: 0.5 }],
    rf: [],
    talkers: [],
    headlines: [],
    demo: true,
  };
  for (let i = 0; i < 120; i++) ingestFrame({ ...frame, t: i * SIM_DT, dt: SIM_DT });
  const { slot0, slot1 } = packMarbleSlots({ ...frame, t });
  let h = 0;
  for (const v of [...slot0, ...slot1]) h = (h * 31 + Math.round(v * 1e5)) | 0;
  return h;
}
