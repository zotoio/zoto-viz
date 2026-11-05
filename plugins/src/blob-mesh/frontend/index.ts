/**
 * Blob Mesh: Lumen Reef. Each device is a bioluminescent cell on a calm, spring-driven drift;
 * traffic between devices grows membrane bridges that merge the cells and carry light pulses.
 *
 * Slot 0 is unchanged (the host mirror in viz-pack-host.ts writes the same slot from the same
 * plugins/sdk/blob-mesh-budget.ts code, and the sky falls back to it when no sandbox runs).
 * Slots 1 to 3 carry the reef simulation (frontend/reef.ts).
 */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "plugins/sdk/viz-zoto";
import { packBlobMeshSlots, type BlobMeshSiteMap } from "plugins/sdk/blob-mesh-budget";
import { DEMO_CELLS, DEMO_LINKS, LumenReef, REEF_CELLS, type ReefCellInput, type ReefLinkInput } from "./reef";

const host = getVizZoto();
/** #193: which lattice site each of the busiest 4 devices holds, kept across frames. */
const sites: BlobMeshSiteMap = new Map();
const reef = new LumenReef();

// Preallocated inputs, mutated in place each frame (no per-frame allocation in the reef path).
const cellPool: ReefCellInput[] = Array.from({ length: REEF_CELLS }, () => ({ id: "", x: 0, y: 0, r: 0, role: "", rate: 0 }));
const cells: ReefCellInput[] = [];
const MAX_LINKS = 32;
const linkPool: ReefLinkInput[] = Array.from({ length: MAX_LINKS }, () => ({ src: "", dst: "", rate: 0 }));
const links: ReefLinkInput[] = [];
const demoLinks: ReefLinkInput[] = DEMO_LINKS.map((l) => ({ ...l }));
const ACCENT: [number, number, number] = [0.25, 0.75, 0.95];
/** Slot xy is uv / 1.7 on sites within about |uv| 0.95: back to the reef's normalised units. */
const SLOT_TO_REEF = 1.7 / 0.95;

function clamp1(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function frac(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 997) / 997;
}

export function reefInputs(frame: VizDataFrame, slot0: readonly number[], shownIdx: readonly number[]): boolean {
  cells.length = 0;
  links.length = 0;
  for (let j = 0; j < shownIdx.length && cells.length < REEF_CELLS; j++) {
    const d = frame.talkers[shownIdx[j]!]!;
    const c = cellPool[cells.length]!;
    c.id = d.id;
    c.x = clamp1(slot0[j * 4]! * SLOT_TO_REEF);
    c.y = clamp1(slot0[j * 4 + 1]! * SLOT_TO_REEF);
    c.r = slot0[j * 4 + 2]!;
    c.role = d.role;
    c.rate = d.rate;
    cells.push(c);
  }
  // Wi-Fi networks heard on the air join as small drifting cells along the rim.
  for (const b of frame.rf ?? []) {
    if (cells.length >= REEF_CELLS) break;
    const c = cellPool[cells.length]!;
    const f = frac(b.ssid);
    c.id = `rf:${b.ssid}`;
    c.x = -0.92 + 1.84 * f;
    c.y = f > 0.5 ? 0.82 : -0.82;
    c.r = 0.07 + 0.1 * Math.max(0, Math.min(1, b.rssi));
    c.role = "wifi";
    c.rate = 1 + 6 * b.rssi;
    cells.push(c);
  }
  if (cells.length === 0) {
    // Idle fallback: the demo reef; links breathe on and off so bridges visibly ease.
    for (const d of DEMO_CELLS) cells.push(d);
    for (let i = 0; i < demoLinks.length; i++) {
      const on = Math.sin(frame.t * 0.21 + i * 1.7) > -0.35;
      demoLinks[i]!.rate = on ? DEMO_LINKS[i]!.rate : 0;
      if (on) links.push(demoLinks[i]!);
    }
    return true;
  }
  if (frame.links && frame.links.length) {
    for (const l of frame.links) {
      if (links.length >= MAX_LINKS) break;
      const p = linkPool[links.length]!;
      p.src = l.src;
      p.dst = l.dst;
      p.rate = l.rate;
      links.push(p);
    }
  } else {
    // No link collection: tether every device to the hub (gateway, this host, else the busiest).
    let hub = cells[0]!;
    for (const c of cells) if (c.role === "gateway" || c.role === "self") { hub = c; break; }
    for (const c of cells) {
      if (c === hub || links.length >= MAX_LINKS) continue;
      const p = linkPool[links.length]!;
      p.src = c.id;
      p.dst = hub.id;
      p.rate = c.rate;
      links.push(p);
    }
  }
  return false;
}

host.onFrame = (frame: VizDataFrame) => {
  // Radii: the floor for every drawn device, then one scale on the part above it so the mesh
  // stays inside the coverage budget (#174, plugins/sdk/blob-mesh-budget.ts). The host mirror
  // viz-pack-host.ts runPackFrameHandler("blob-mesh") writes the same slot 0 from the same code.
  const packed = packBlobMeshSlots(frame.talkers, frame.t, sites);
  host.writeBuffer(0, packed.slot0);
  const demo = reefInputs(frame, packed.slot0, packed.plan.shownIdx);
  reef.step(frame.dt, cells, links, demo);
  host.writeBuffer(1, reef.slotCells);
  host.writeBuffer(2, reef.slotBridges);
  host.writeBuffer(3, reef.slotMeta);
  host.writeUniform("uBright", 0.8 + frame.audio * 0.2); // #174 UX Pro: size is the only rate signal, no rate term
  host.writeUniform("uAudio", frame.audio);
  host.writeUniform("uAccent", ACCENT);
};
