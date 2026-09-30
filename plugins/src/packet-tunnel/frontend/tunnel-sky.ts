/**
 * CPU mirror of sky/fragment.glsl for pack tests (#180). Keep in step with the shader: the lines in
 * PT_SKY_GLSL_LINES must appear verbatim in the GLSL and are the ones this mirror implements.
 */

export const PT_SKY_GLSL_LINES = [
  "vec4 s0 = zotoVizSlots[0];",
  "float depth = clamp(0.5 - 0.5 * dir.z, 0.0, 1.0);",
  "float fwd = max(-dir.z, 0.0);",
  "float along = fwd / rad;",
  "float speed = 0.6 + 2.4 * lead;",
  "float travel = along * 1.6 + uTime * speed;",
  "float rings = pow(0.5 + 0.5 * cos(travel * 6.28318), 6.0);",
  "float laneF = (atan(dir.y, dir.x) / 6.28318 + 0.5) * 12.0;",
  "float busy = 0.25 + 0.6 * field;",
  "float fog = exp(-along * 0.22);",
  "float core = pow(depth, 240.0);",
  "vec3 hue = vec3(0.15 + lead * 0.7, 0.35 + lead * 0.4, 0.85 - lead * 0.3);",
  "vec3 wall = hue * (0.22 + 0.6 * rings + 0.35 * seam) + vec3(1.0, 0.9, 0.7) * (blip * 0.9);",
  "vec3 col = wall * fog + mix(hue, vec3(1.0), 0.5) * core;",
] as const;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const fract = (x: number) => x - Math.floor(x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function ptHash(x: number, y: number): number {
  return fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
}

/** Linear RGB (before the host's uOpacity) for one camera-relative ray `dir` (unit, -z forward). */
export function packetTunnelSky(
  dir: readonly [number, number, number],
  slot0: readonly number[],
  time: number,
  bright: number,
): [number, number, number] {
  const lead = clamp(slot0[0] ?? 0, 0, 1);
  const field = clamp(slot0[1] ?? 0, 0, 1);
  const depth = clamp(0.5 - 0.5 * dir[2], 0, 1);
  const fwd = Math.max(-dir[2], 0);
  const rad = Math.max(Math.hypot(dir[0], dir[1]), 0.001);
  const along = fwd / rad;
  const speed = 0.6 + 2.4 * lead;
  const travel = along * 1.6 + time * speed;
  const rings = Math.pow(0.5 + 0.5 * Math.cos(travel * 6.28318), 6);
  const laneF = (Math.atan2(dir[1], dir[0]) / 6.28318 + 0.5) * 12;
  const lane = Math.floor(laneF);
  const seam = 1 - smoothstep(0, 0.06, Math.min(fract(laneF), 1 - fract(laneF)));
  const cellF = travel * 2;
  const busy = 0.25 + 0.6 * field;
  const pkt = ptHash(lane, Math.floor(cellF)) >= 1 - busy ? 1 : 0;
  const blip = pkt * smoothstep(0, 0.2, fract(cellF)) * (1 - smoothstep(0.55, 0.9, fract(cellF)));
  const fog = Math.exp(-along * 0.22);
  const core = Math.pow(depth, 240);
  const hue: [number, number, number] = [0.15 + lead * 0.7, 0.35 + lead * 0.4, 0.85 - lead * 0.3];
  const tint: [number, number, number] = [1, 0.9, 0.7];
  const base = 0.22 + 0.6 * rings + 0.35 * seam;
  const out: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const wall = hue[k]! * base + tint[k]! * (blip * 0.9);
    const coreCol = hue[k]! * 0.5 + 0.5;
    out[k] = (wall * fog + coreCol * core) * bright;
  }
  return out;
}
