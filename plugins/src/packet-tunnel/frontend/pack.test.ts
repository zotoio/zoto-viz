import { describe, expect, it } from "vitest";
import sky from "../sky/fragment.glsl?raw";
import { packetTunnelSample } from "./tunnel";
import { PT_SKY_GLSL_LINES, packetTunnelSky } from "./tunnel-sky";

// #180: the scaffold sky used `depth = 0.5 + 0.5 * dir.z`, about 0 across a camera-relative (-z forward)
// view, and never read slot 0 (lead / depth from packetTunnelSample). Mean luma 5.5 on the box.
/** Evaluate the sky's `float <name> = <expr>;` on the CPU (dir.xyz, numbers, + - * /, clamp/min/max/abs only). */
function skyFloat(name: string, dir: [number, number, number]): number {
  const m = sky.match(new RegExp(`\\bfloat\\s+${name}\\s*=\\s*([^;]+);`));
  if (!m) throw new Error(`sky has no \`float ${name} = ...;\``);
  const js = m[1]!.replace(/\bdir\.([xyz])\b/g, (_, c: string) => `d[${"xyz".indexOf(c)}]`);
  const left = js.replace(/\b(clamp|min|max|abs)\b|d\[\d\]|\d+\.?\d*(?:e-?\d+)?|[-+*/(), ]/g, "");
  if (left.trim()) throw new Error(`cannot mirror \`${m[1]}\` (left: ${left})`);
  const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function("d", "clamp", "min", "max", "abs", `return (${js});`)(dir, clamp, Math.min, Math.max, Math.abs) as number;
}

describe("packet-tunnel sky (#180)", () => {
  it("reads the proto field from zotoVizSlots slot 0", () => {
    expect(sky).toMatch(/\bzotoVizSlots\s*\[\s*0\s*\]/);
  });

  it("tunnel depth is ~1 looking down -z (camera-relative forward) and ~0 looking back", () => {
    expect(skyFloat("depth", [0, 0, -1])).toBeGreaterThanOrEqual(0.9);
    expect(skyFloat("depth", [0, 0, 1])).toBeLessThanOrEqual(0.1);
  });

  it("CPU mirror of the tunnel lights a -z-forward frame from the idle slot 0 (mean luma > 20/255)", () => {
    for (const line of PT_SKY_GLSL_LINES) expect(sky, `mirror line missing from the sky: ${line}`).toContain(line);
    const slot0 = packetTunnelSample({ t: 12.3, packets: [] }).buffer;
    const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const W = 48;
    const H = 30;
    const tanV = Math.tan((55 / 2) * (Math.PI / 180));
    let sum = 0;
    let lit = 0;
    const idle: number[] = [];
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = ((i + 0.5) / W * 2 - 1) * tanV * 1.6;
        const y = ((j + 0.5) / H * 2 - 1) * tanV;
        const l = Math.hypot(x, y, 1);
        const c = packetTunnelSky([x / l, y / l, -1 / l], slot0, 12.3, 1);
        const v = lum(c) * 255;
        sum += v;
        if (v > 40) lit++;
        idle.push(lum(packetTunnelSky([x / l, y / l, -1 / l], [0, 0, 0], 12.3, 1)) * 255);
      }
    }
    expect(sum / (W * H)).toBeGreaterThan(20);
    expect(lit / (W * H)).toBeGreaterThan(0.05);
    // Slot 0 drives it: an all-zero slot gives a different frame.
    const diff = idle.reduce((s, v, k) => s + Math.abs(v - lum(packetTunnelSky(
      (() => { const i = k % W; const j = Math.floor(k / W); const x = ((i + 0.5) / W * 2 - 1) * tanV * 1.6; const y = ((j + 0.5) / H * 2 - 1) * tanV; const l = Math.hypot(x, y, 1); return [x / l, y / l, -1 / l] as [number, number, number]; })(),
      slot0, 12.3, 1,
    )) * 255), 0);
    expect(diff / (W * H)).toBeGreaterThan(1);
  });
});
