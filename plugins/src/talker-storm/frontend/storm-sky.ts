/**
 * CPU mirror of sky/fragment.glsl for pack tests (#180). Keep in step with the shader: the lines in
 * TS_SKY_GLSL_LINES must appear verbatim in the GLSL and are the ones this mirror implements.
 */
export { stormSlots, TS_MAX_TALKERS } from "./storm";

export const TS_SKY_GLSL_LINES = [
  "return 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67)));",
  "vec2 p = dir.xy / fwd;",
  "float audio = clamp(zotoVizSlots[0].y, 0.0, 1.0);",
  "vec3 col = mix(vec3(0.02, 0.025, 0.05), vec3(0.07, 0.06, 0.12), clamp(0.5 + p.y, 0.0, 1.0));",
  "for (int i = 0; i < 16; i++) {",
  "float rate = clamp(tsF(64 + i * 4 + 3), 0.0, 1.0);",
  "vec2 c = vec2(tsF(64 + i * 4), tsF(64 + i * 4 + 1));",
  "float hue = tsF(64 + i * 4 + 2);",
  "float rad = 0.08 + 0.22 * rate;",
  "float spin = atan(q.y, q.x) + 2.2 * log(r + 0.02) - uTime * (0.8 + 2.0 * rate) + float(i) * 1.3;",
  "float arms = pow(0.5 + 0.5 * cos(3.0 * spin), 3.0);",
  "float body = exp(-r / rad);",
  "float eye = smoothstep(0.0, rad * 0.25, r);",
  "col += tsHue(hue) * (arms * body * eye * (0.5 + rate + 0.5 * audio) + 0.18 * body);",
] as const;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Linear RGB for one camera-relative ray (unit, -z forward). */
export function talkerStormSky(
  dir: readonly [number, number, number],
  slots: { slot0: readonly number[]; slot1: readonly number[] },
  time: number,
  bright: number,
): [number, number, number] {
  const fwd = Math.max(-dir[2], 0.05);
  const p = [dir[0] / fwd, dir[1] / fwd];
  const audio = clamp(slots.slot0[1] ?? 0, 0, 1);
  const g = clamp(0.5 + p[1]!, 0, 1);
  const col = [0.02 + 0.05 * g, 0.025 + 0.035 * g, 0.05 + 0.07 * g];
  for (let i = 0; i < 16; i++) {
    const rate = clamp(slots.slot1[i * 4 + 3] ?? 0, 0, 1);
    if (rate <= 0.001) continue;
    const cx = slots.slot1[i * 4] ?? 0;
    const cy = slots.slot1[i * 4 + 1] ?? 0;
    const hue = slots.slot1[i * 4 + 2] ?? 0;
    const qx = p[0]! - cx;
    const qy = p[1]! - cy;
    const r = Math.hypot(qx, qy);
    const rad = 0.08 + 0.22 * rate;
    const spin = Math.atan2(qy, qx) + 2.2 * Math.log(r + 0.02) - time * (0.8 + 2.0 * rate) + i * 1.3;
    const arms = Math.pow(0.5 + 0.5 * Math.cos(3 * spin), 3);
    const body = Math.exp(-r / rad);
    const eye = smoothstep(0, rad * 0.25, r);
    const k = arms * body * eye * (0.5 + rate + 0.5 * audio) + 0.18 * body;
    for (let ch = 0; ch < 3; ch++) col[ch]! += (0.5 + 0.5 * Math.cos(6.28318 * (hue + [0, 0.33, 0.67][ch]!))) * k;
  }
  return [col[0]! * bright, col[1]! * bright, col[2]! * bright];
}
