
/** Talker-driven particle storm scaffold — hard-capped particle writes per frame. */

import type { VizDataFrame } from "../../../sdk/viz-contract";
import { getVizZoto } from "../../../sdk/viz-zoto";
const zoto = getVizZoto();

const PARTICLE_CAP = 512;
const STRIDE = 4;


function roleHue(role: string): number {
  if (role === "gateway") return 0.9;
  if (role === "internet") return 0.75;
  if (role === "lan") return 0.45;
  return 0.2;
}

zoto.onFrame = (frame) => {
  const particles: number[] = [];
  let count = 0;
  for (const talker of frame.talkers) {
    const n = Math.min(8, Math.ceil(talker.rate / 40));
    for (let i = 0; i < n && count < PARTICLE_CAP; i++, count++) {
      const hash = (talker.id.charCodeAt(0) + i * 17) % 97;
      particles.push(
        (hash / 97) * 2 - 1,
        roleHue(talker.role),
        (frame.t % 1) + i * 0.01,
        Math.min(1, talker.rate / 200),
      );
    }
  }
  zoto.writeParticles(particles, STRIDE);
  zoto.writeBuffer(0, [count, frame.audio, frame.t % 1]);
  zoto.writeUniform("uBright", 0.4 + frame.audio * 0.5);
  zoto.writeUniform("uAudio", frame.audio);
};
