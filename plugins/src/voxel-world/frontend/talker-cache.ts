import type { VizPacketSample, VizTalkerSample } from "./viz-frame";

export const PACKETS_PER_FRAME_CAP = 8;
export const MAX_FLOW_MARKERS = 6;

export function anchorXZ(key: string, worldSeed: number): { x: number; z: number; label: number } {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  const a = ((h ^ worldSeed) >>> 0) / 4294967296;
  const b = (((h * 1103515245 + worldSeed) >>> 0) % 997) / 997;
  return { x: (a - 0.5) * 48, z: (b - 0.5) * 48, label: (h >>> 0) % 10000 };
}

export interface FlowMarker {
  key: string;
  x: number;
  y: number;
  z: number;
  kind: number;
  strength: number;
  label: number;
  talkerTag: number;
}

const talkerMarkers = new Map<string, FlowMarker>();
const rateById = new Map<string, number>();
const protoMarkers = new Map<string, FlowMarker>();

let talkerFrameTag = 0;
let protoFrameTag = 0;
let rebuilds = 0;
let storedIdCount = 0;
const storedIds: string[] = [];

export function resetFlowCaches(): void {
  talkerMarkers.clear();
  rateById.clear();
  protoMarkers.clear();
  talkerFrameTag = 0;
  protoFrameTag = 0;
  rebuilds = 0;
  storedIdCount = 0;
  storedIds.length = 0;
}

export function flowCacheHandles(): {
  talkerMarkers: Map<string, FlowMarker>;
  rateById: Map<string, number>;
  protoMarkers: Map<string, FlowMarker>;
} {
  return { talkerMarkers, rateById, protoMarkers };
}

export function talkerLayoutRebuilds(): number {
  return rebuilds;
}

function noteId(id: string): void {
  for (let i = 0; i < storedIdCount; i++) {
    if (storedIds[i] === id) return;
  }
  storedIds[storedIdCount++] = id;
  rebuilds++;
}

function clearRates(): void {
  for (let i = 0; i < storedIdCount; i++) {
    const id = storedIds[i]!;
    rateById.set(id, 0);
  }
}

function updateTalkerMarker(id: string, rate: number, worldSeed: number, yBase: number): FlowMarker {
  let m = talkerMarkers.get(id);
  if (!m) {
    const anchor = anchorXZ(id, worldSeed);
    m = {
      key: id,
      x: anchor.x,
      y: yBase,
      z: anchor.z,
      kind: 0,
      strength: 0,
      label: anchor.label,
      talkerTag: 0,
    };
    talkerMarkers.set(id, m);
    rateById.set(id, 0);
    noteId(id);
  }
  m.y = yBase;
  m.kind = rate > 0 ? 2 : 0;
  m.strength = rate > 0 ? Math.min(1, rate / 200) : 0;
  m.talkerTag = talkerFrameTag;
  return m;
}

/** Talker layout: reuse maps; rebuild anchors only when a new id appears. */
export function syncTalkerLayout(
  talkers: readonly VizTalkerSample[],
  worldSeed: number,
  yBase: number,
): { rateById: Map<string, number>; markers: Map<string, FlowMarker>; eventRate: number } {
  talkerFrameTag++;
  clearRates();
  let eventRate = 0;
  for (let i = 0; i < talkers.length; i++) {
    const t = talkers[i]!;
    const prev = rateById.get(t.id) ?? 0;
    const next = prev + t.rate;
    rateById.set(t.id, next);
    eventRate += t.rate;
    updateTalkerMarker(t.id, next, worldSeed, yBase);
  }
  let write = 0;
  for (let i = 0; i < storedIdCount; i++) {
    const id = storedIds[i]!;
    const m = talkerMarkers.get(id);
    if (m && m.talkerTag === talkerFrameTag) {
      storedIds[write++] = id;
      continue;
    }
    talkerMarkers.delete(id);
    rateById.delete(id);
  }
  storedIdCount = write;
  return { rateById, markers: talkerMarkers, eventRate };
}

export function syncProtoFlowMarkers(
  packets: readonly VizPacketSample[],
  worldSeed: number,
  yBase: number,
  torchField: number,
  blockField: number,
): Map<string, FlowMarker> {
  protoFrameTag++;
  const n = packets.length < PACKETS_PER_FRAME_CAP ? packets.length : PACKETS_PER_FRAME_CAP;
  for (let i = 0; i < n; i++) {
    const p = packets[i]!;
    if (!p.proto) continue;
    const kind = p.field >= torchField ? 1 : p.field >= blockField ? 2 : 0;
    let m = protoMarkers.get(p.proto);
    if (!m) {
      const anchor = anchorXZ(p.proto, worldSeed);
      m = {
        key: p.proto,
        x: anchor.x,
        y: yBase,
        z: anchor.z,
        kind: 0,
        strength: 0,
        label: anchor.label,
        talkerTag: 0,
      };
      protoMarkers.set(p.proto, m);
    }
    m.talkerTag = protoFrameTag;
    if (kind) {
      m.kind = kind;
      m.strength = p.field;
      m.y = yBase + (kind === 1 ? 0.4 : 0);
    } else {
      m.kind = 0;
      m.strength = 0;
    }
  }
  for (const [proto, m] of protoMarkers) {
    if (m.talkerTag !== protoFrameTag) {
      protoMarkers.delete(proto);
      continue;
    }
    if (m.kind <= 0) protoMarkers.delete(proto);
  }
  return protoMarkers;
}

export function forEachTalkerMarker(fn: (m: FlowMarker) => void): void {
  for (let i = 0; i < storedIdCount; i++) {
    const m = talkerMarkers.get(storedIds[i]!);
    if (m) fn(m);
  }
}

export function forEachProtoMarker(fn: (m: FlowMarker) => void): void {
  for (const m of protoMarkers.values()) fn(m);
}
