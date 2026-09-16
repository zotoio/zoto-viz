/** Packet-field tunnel raymarch scaffold — maps decimated proto fields into sky uniforms. */

type VizFrame = {
  t: number;
  packets: { proto: string; field: number }[];
};

declare const zoto: {
  onFrame: ((frame: VizFrame) => void) | null;
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: number | [number, number, number]) => void;
};

function tunnelHue(field: number): [number, number, number] {
  return [0.15 + field * 0.7, 0.35 + field * 0.4, 0.85 - field * 0.3];
}

zoto.onFrame = (frame) => {
  const lead = frame.packets[0]?.field ?? 0;
  const depth = frame.packets.reduce((s, p) => s + p.field, 0) / Math.max(1, frame.packets.length);
  zoto.writeBuffer(0, [lead, depth, frame.t % 1]);
  zoto.writeUniform("uBright", 0.55 + depth * 0.35);
  zoto.writeUniform("uAccent", tunnelHue(lead));
};
