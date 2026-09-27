/** Packet-field tunnel raymarch — maps decimated proto fields into sky uniforms. */

import type { VizDataFrame } from "../../../sdk/viz-contract";

export function tunnelHue(field: number): [number, number, number] {
  return [0.15 + field * 0.7, 0.35 + field * 0.4, 0.85 - field * 0.3];
}

/** Synthetic proto field when the LAN is quiet — keeps the tunnel visibly lit. */
function demoTunnelField(t: number): { lead: number; depth: number } {
  const phase = t * 0.55;
  const lead = 0.5 + 0.2 * Math.sin(phase);
  const depth = 0.5 + 0.15 * Math.sin(phase * 1.3 + 0.7);
  return { lead, depth };
}

export function packetTunnelFields(frame: Pick<VizDataFrame, "t" | "packets">): { lead: number; depth: number } {
  if (frame.packets.length > 0) {
    const lead = frame.packets[0]!.field;
    const depth = frame.packets.reduce((s, p) => s + p.field, 0) / frame.packets.length;
    return { lead, depth };
  }
  return demoTunnelField(frame.t);
}

export function packetTunnelBright(depth: number): number {
  return Math.max(0.45, 0.55 + depth * 0.35);
}

const PT_SCRATCH = { lead: 0, depth: 0 };
let ptKey = -1;
let ptCached = "";

/** Simple view line when the tunnel shader cannot link (not the no-traffic DATA fallback). */
export function packetTunnelFallbackText(frame: Pick<VizDataFrame, "t" | "packets">): string {
  if (frame.packets.length > 0) {
    PT_SCRATCH.lead = frame.packets[0]!.field;
    PT_SCRATCH.depth = frame.packets.reduce((s, p) => s + p.field, 0) / frame.packets.length;
  } else {
    const demo = demoTunnelField(frame.t);
    PT_SCRATCH.lead = demo.lead;
    PT_SCRATCH.depth = demo.depth;
  }
  const key = ((frame.packets[0]?.proto === undefined ? 0 : 1) << 20)
    | (Math.round(PT_SCRATCH.lead * 20) << 10)
    | Math.round(PT_SCRATCH.depth * 20);
  if (key === ptKey) return ptCached;
  ptKey = key;
  const proto = frame.packets[0]?.proto ?? "DATA";
  ptCached = `${proto} ${PT_SCRATCH.lead.toFixed(2)} · depth ${PT_SCRATCH.depth.toFixed(2)}`;
  return ptCached;
}

export function packetTunnelSample(frame: Pick<VizDataFrame, "t" | "packets">): {
  lead: number;
  depth: number;
  buffer: [number, number, number];
  bright: number;
  accent: [number, number, number];
} {
  const { lead, depth } = packetTunnelFields(frame);
  return {
    lead,
    depth,
    buffer: [lead, depth, frame.t % 1],
    bright: packetTunnelBright(depth),
    accent: tunnelHue(lead),
  };
}
