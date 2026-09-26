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

export function talkerIdSetKey(talkers: readonly VizTalkerSample[]): string {
  const ids = [...new Set(talkers.map((t) => t.id))].sort();
  return ids.join("\0");
}

export interface FlowMarker {
  key: string;
  x: number;
  y: number;
  z: number;
  kind: number;
  strength: number;
  label: number;
}

export interface TalkerLayoutCache {
  idSetKey: string;
  markers: FlowMarker[];
  rateById: Map<string, number>;
  rebuilds: number;
}

let talkerLayout: TalkerLayoutCache = {
  idSetKey: "",
  markers: [],
  rateById: new Map(),
  rebuilds: 0,
};

const protoMarkers = new Map<string, FlowMarker>();

export function resetFlowCaches(): void {
  talkerLayout = { idSetKey: "", markers: [], rateById: new Map(), rebuilds: 0 };
  protoMarkers.clear();
}

export function talkerLayoutStats(): TalkerLayoutCache {
  return talkerLayout;
}

/** Rebuild talker-derived layout only when the set of talker ids changes. */
export function syncTalkerLayout(
  talkers: readonly VizTalkerSample[],
  worldSeed: number,
  yBase: number,
): TalkerLayoutCache {
  const key = talkerIdSetKey(talkers);
  const rateById = new Map<string, number>();
  for (const t of talkers) rateById.set(t.id, (rateById.get(t.id) ?? 0) + t.rate);

  if (key === talkerLayout.idSetKey && key !== "") {
    talkerLayout.rateById = rateById;
    return talkerLayout;
  }

  const markers: FlowMarker[] = [];
  for (const id of [...rateById.keys()].sort()) {
    const anchor = anchorXZ(id, worldSeed);
    const rate = rateById.get(id) ?? 0;
    markers.push({
      key: id,
      x: anchor.x,
      y: yBase,
      z: anchor.z,
      kind: rate > 0 ? 2 : 0,
      strength: Math.min(1, rate / 200),
      label: anchor.label,
    });
  }
  talkerLayout = {
    idSetKey: key,
    markers,
    rateById,
    rebuilds: talkerLayout.rebuilds + (key === "" ? 0 : 1),
  };
  return talkerLayout;
}

export function syncProtoFlowMarkers(
  packets: readonly VizPacketSample[],
  worldSeed: number,
  yBase: number,
  torchField: number,
  blockField: number,
): FlowMarker[] {
  const active = new Set<string>();
  const out: FlowMarker[] = [];
  for (const p of packets.slice(0, PACKETS_PER_FRAME_CAP)) {
    if (!p.proto) continue;
    active.add(p.proto);
    const kind = p.field >= torchField ? 1 : p.field >= blockField ? 2 : 0;
    if (!kind) continue;
    const anchor = anchorXZ(p.proto, worldSeed);
    const row: FlowMarker = {
      key: p.proto,
      x: anchor.x,
      y: yBase + (kind === 1 ? 0.4 : 0),
      z: anchor.z,
      kind,
      strength: 1,
      label: anchor.label,
    };
    protoMarkers.set(p.proto, row);
    out.push(row);
  }
  for (const proto of protoMarkers.keys()) {
    if (!active.has(proto)) protoMarkers.delete(proto);
  }
  return out;
}
