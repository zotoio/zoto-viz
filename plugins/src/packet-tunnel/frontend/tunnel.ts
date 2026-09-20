/** Packet-field tunnel raymarch — maps decimated proto fields into sky uniforms. */

export type PacketTunnelFrame = {
  t: number;
  packets: { field: number }[];
};

export function tunnelHue(field: number): [number, number, number] {
  return [0.15 + field * 0.7, 0.35 + field * 0.4, 0.85 - field * 0.3];
}

/** Live packets only — host viz.idle merge supplies demo slices when the LAN is quiet. */
export function packetTunnelFields(frame: PacketTunnelFrame): { lead: number; depth: number } {
  if (!frame.packets.length) return { lead: 0, depth: 0 };
  const lead = frame.packets[0]!.field;
  const depth = frame.packets.reduce((s, p) => s + p.field, 0) / frame.packets.length;
  return { lead, depth };
}

export function packetTunnelBright(depth: number): number {
  return Math.max(0.45, 0.55 + depth * 0.35);
}

export function packetTunnelSample(frame: PacketTunnelFrame): {
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
