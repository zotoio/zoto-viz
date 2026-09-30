/**
 * CPU mirror of sky/fragment.glsl for pack tests (#180). Keep in step with the shader: the lines in
 * RF_SKY_GLSL_LINES must appear verbatim in the GLSL and are the ones this mirror implements.
 */
export { rfBeaconBuffer } from "./beacons";

export const RF_SKY_GLSL_LINES = [
  "float ang = idx * 2.39996 + ch * 3.14159 + 0.6 + t * 0.04;",
  "float rr = 0.18 + 0.22 * fract(ch * 5.1 + idx * 0.31);",
  "return vec2(cos(ang) * rr * 1.45, sin(ang) * rr);",
  "return ch < 0.1 ? vec3(1.0, 0.62, 0.3) : vec3(0.42, 0.78, 1.0);",
  "vec2 p = dir.xy / fwd;",
  "vec3 col = uBg + mix(vec3(0.01, 0.012, 0.03), vec3(0.05, 0.06, 0.14), clamp(0.5 + p.y, 0.0, 1.0));",
  "float rssi = clamp(rfF(i * 3), 0.0, 1.0);",
  "float ch = rfF(i * 3 + 1);",
  "float size = 0.03 + 0.08 * rssi;",
  "float glow = rssi * twinkle * (1.6 * exp(-dot(q, q) / (size * size)) + 0.35 * exp(-length(q) / (size * 3.0)));",
  "float spikes = rssi * (exp(-abs(q.y) * 160.0) + exp(-abs(q.x) * 160.0)) * exp(-length(q) * 9.0);",
  "if (prevRssi > 0.0) col += rfHue(ch) * 0.5 * min(rssi, prevRssi) * exp(-rfSeg(p, prev, c) * 260.0);",
] as const;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const fract = (x: number) => x - Math.floor(x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function rfPos(ch: number, idx: number, t: number): [number, number] {
  const ang = idx * 2.39996 + ch * 3.14159 + 0.6 + t * 0.04;
  const rr = 0.18 + 0.22 * fract(ch * 5.1 + idx * 0.31);
  return [Math.cos(ang) * rr * 1.45, Math.sin(ang) * rr];
}

function rfHue(ch: number): [number, number, number] {
  return ch < 0.1 ? [1, 0.62, 0.3] : [0.42, 0.78, 1];
}

function rfSeg(p: [number, number], a: [number, number], b: [number, number]): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const h = clamp(((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / Math.max(abx * abx + aby * aby, 0.000001), 0, 1);
  return Math.hypot(p[0] - a[0] - abx * h, p[1] - a[1] - aby * h);
}

/** Linear RGB for one camera-relative ray (unit, -z forward); uBg taken as black. */
export function rfConstellationSky(
  dir: readonly [number, number, number],
  slot0: readonly number[],
  time: number,
  bright: number,
): [number, number, number] {
  const fwd = Math.max(-dir[2], 0.05);
  const p: [number, number] = [dir[0] / fwd, dir[1] / fwd];
  const g = clamp(0.5 + p[1], 0, 1);
  const col: [number, number, number] = [0.01 + (0.05 - 0.01) * g, 0.012 + (0.06 - 0.012) * g, 0.03 + (0.14 - 0.03) * g];
  let bands = 0;
  for (let i = 0; i < 6; i++) bands += smoothstep(0.92, 1, Math.sin(dir[1] * 12 + i * 1.7 + time * 0.3));
  col[0] += 0.03 * bands;
  col[1] += 0.035 * bands;
  col[2] += 0.06 * bands;
  let prev: [number, number] = [0, 0];
  let prevRssi = 0;
  for (let i = 0; i < 8; i++) {
    const rssi = clamp(slot0[i * 3] ?? 0, 0, 1);
    const ch = slot0[i * 3 + 1] ?? 0;
    if (rssi <= 0.001) continue;
    const c = rfPos(ch, i, time);
    const q: [number, number] = [p[0] - c[0], p[1] - c[1]];
    const size = 0.03 + 0.08 * rssi;
    const twinkle = 0.85 + 0.15 * Math.sin(time * 2.3 + i * 1.9);
    const ql = Math.hypot(q[0], q[1]);
    const glow = rssi * twinkle * (1.6 * Math.exp(-(q[0] * q[0] + q[1] * q[1]) / (size * size)) + 0.35 * Math.exp(-ql / (size * 3)));
    const spikes = rssi * (Math.exp(-Math.abs(q[1]) * 160) + Math.exp(-Math.abs(q[0]) * 160)) * Math.exp(-ql * 9);
    const hue = rfHue(ch);
    const line = prevRssi > 0 ? 0.5 * Math.min(rssi, prevRssi) * Math.exp(-rfSeg(p, prev, c) * 260) : 0;
    for (let k = 0; k < 3; k++) col[k] += hue[k]! * (glow + spikes + line);
    prev = c;
    prevRssi = rssi;
  }
  return [col[0] * bright, col[1] * bright, col[2] * bright];
}
