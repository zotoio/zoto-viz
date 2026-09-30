import type { VizDataFrame } from "../../../sdk/viz-contract";

/** Storm cells the sky draws (slot 1 holds 4 floats per talker, 64 floats max). */
export const TS_MAX_TALKERS = 16;

export function roleHue(role: string): number {
  if (role === "gateway") return 0.9;
  if (role === "internet") return 0.75;
  if (role === "lan") return 0.45;
  return 0.2;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Slot 1 = per talker [cx, cy, hue, rate 0..1]: storm cell centre on the camera-relative
 * screen plane (dir.xy / -dir.z, about +-0.83 x +-0.52 on a 16:10 stage), role hue, rate / 200.
 * Slot 0 is not the pack's: the host pack mirror (web/src/plugins/viz-pack-host.ts) writes
 * [particle count, audio, t mod 1] there every frame, and the sky reads audio from it.
 */
export function stormSlots(frame: Pick<VizDataFrame, "talkers">): { slot1: number[] } {
  const slot1: number[] = [];
  for (let i = 0; i < Math.min(TS_MAX_TALKERS, frame.talkers.length); i++) {
    const t = frame.talkers[i]!;
    const h = fnv1a(t.id);
    const cx = ((h % 1009) / 1008) * 1.3 - 0.65;
    const cy = ((Math.floor(h / 1009) % 1013) / 1012) * 0.76 - 0.38;
    slot1.push(cx, cy, roleHue(t.role), Math.min(1, Math.max(0, t.rate / 200)));
  }
  return { slot1 };
}
