import { afterAll, beforeAll, describe, expect, it } from "vitest";
import yml from "../plugin.yml?raw";
import sky from "../sky/fragment.glsl?raw";
import fixture from "./fixture.js";
import src from "./module.js?raw";

// #180: the sandbox iframe CSP is `connect-src 'none'` (service/pack_assets.py). Chrome fetches JSON
// modules (`import x from "./a.json" with { type: "json" }`) under connect-src, so the import fails,
// the pack never registers onPresent and the view heals to Topology. Every relative import in this
// pack has to be a JS module, which loads under script-src like helper.js does.
/** JS modules shipped next to module.js (keys like "./helper.js"). */
const packJs = import.meta.glob("./*.js", { query: "?raw", import: "default", eager: true });

function relativeImports(src: string): { spec: string; attrs: string }[] {
  const out: { spec: string; attrs: string }[] = [];
  const re = /\bimport\s+(?:[^'";]*?\sfrom\s+)?["'](\.{1,2}\/[^"']+)["']\s*(with\s*\{[^}]*\})?/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.push({ spec: m[1], attrs: m[2] ?? "" });
  return out;
}

describe("sandbox-fixture-multi module graph (#180)", () => {
  it("imports only JS modules that ship in the pack (no JSON import blocked by connect-src 'none')", () => {
    const imports = relativeImports(src);
    expect(imports.map((i) => i.spec)).toContain("./helper.js");
    for (const i of imports) {
      expect(i.attrs, `${i.spec} uses import attributes`).toBe("");
      expect(i.spec, `${i.spec} is not a .js module`).toMatch(/\.js$/);
      expect(i.spec in packJs, `${i.spec} missing from the pack`).toBe(true);
    }
    expect(src).not.toMatch(/\.json["']/);
    expect(src).not.toMatch(/type\s*:\s*["']json["']/);
  });

  describe("hooks", () => {
    const g = globalThis as { zoto?: unknown };
    const uniforms: [string, number][] = [];
    const buffers: [number, number[]][] = [];
    const z: {
      onPresent?: (() => void) | null;
      onFrame?: ((frame: unknown) => void) | null;
      writeUniform: (n: string, v: number) => void;
      writeBuffer: (slot: number, data: number[]) => void;
    } = {
      writeUniform: (n, v) => uniforms.push([n, v]),
      writeBuffer: (slot, data) => buffers.push([slot, Array.from(data)]),
    };

    beforeAll(async () => {
      g.zoto = z;
      await import("./module.js");
    });
    afterAll(() => {
      delete g.zoto;
    });

    /** uBright on every call is fixture.js's bright (0.92), unscaled; helper.js's pulse goes to slot 0 only. */
    function expectFixtureBright(n: number): void {
      expect(uniforms.map(([name]) => name)).toEqual(Array(n).fill("uBright"));
      for (const [, v] of uniforms) {
        expect(v, "uBright written equals fixture.js bright").toBe(fixture.bright);
        expect(v, "fixture.js bright").toBe(0.92);
      }
      expect(buffers.length).toBe(n);
      for (const [slot, data] of buffers) {
        expect(slot).toBe(0);
        expect(data.length).toBe(1);
        expect(data[0]).toBeGreaterThanOrEqual(0.1 - 1e-9);
        expect(data[0]).toBeLessThanOrEqual(1 + 1e-9);
      }
    }

    it("onPresent writes uBright = fixture.js bright", () => {
      uniforms.length = 0;
      buffers.length = 0;
      expect(typeof z.onPresent).toBe("function");
      for (let k = 0; k < 3; k++) z.onPresent!();
      expectFixtureBright(3);
    });

    it("writes on data frames too, because the manifest has no viz.presentTick (host sends no present ticks)", () => {
      // Red at c20802db: onPresent never fires without presentTick, so the pack makes no viz writes while
      // frames arrive; tile health reads that as drawing-nothing and heals the view to Topology.
      expect(/^\s*presentTick:\s*true\b/m.test(yml)).toBe(false);
      uniforms.length = 0;
      buffers.length = 0;
      expect(typeof z.onFrame, "module.js must set zoto.onFrame").toBe("function");
      for (let k = 0; k < 3; k++) z.onFrame!({ t: k, dt: 0.1, audio: 0, packets: [], rf: [], talkers: [] });
      expectFixtureBright(3);
    });
  });

  it("the sky takes all its brightness from uBright (none of its own), in a pattern tile health reads as not uniform", () => {
    // #180 review: with no sky the board was empty (mean luma 14, 0 px >= 60) under `backdrop: plugin`.
    const declared = [...yml.matchAll(/^\s+-\s+(u\w+)\s*$/gm)].map((m) => m[1]);
    expect(declared, "viz.uniforms").toContain("uBright");
    for (const line of SKY_LINES) expect(sky, `mirror line missing from the sky: ${line}`).toContain(line);
    const main = sky.slice(sky.indexOf("void main()"));
    expect(main.match(/\bfragColor\s*=/g)?.length, "one fragColor write").toBe(1);
    const five = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const;
    for (const time of [0, 7.5]) {
      for (const pulse of [0.1, 1]) {
        const lums = five.map(([u, v]) => patchLum(u, v, time, pulse, 1));
        // Linear in uBright with no offset: 0 -> black, 0.92 -> exactly 0.92 x the uBright = 1 picture.
        for (const [u, v] of five) {
          expect(patchLum(u, v, time, pulse, 0)).toBe(0);
          expect(patchLum(u, v, time, pulse, 0.92)).toBeCloseTo(0.92 * patchLum(u, v, time, pulse, 1), 12);
        }
        // Tile health (tile-health.ts): a 16x16 patch is near-uniform when its luma spread is < 6/255. Checked in
        // linear light (the screen is sRGB, which only widens dark spreads) at the fixture bright and at 0.4,
        // the lean sky bright the host wrote over it in the #180 shots (pack uniform writes lose to the host, H1).
        for (const b of [fixture.bright, 0.4]) {
          for (const [u, v] of five) expect(patchSpread(u, v, time, pulse, b) * 255, `spread at uBright ${b}`).toBeGreaterThan(6);
        }
        expect(Math.max(...lums)).toBeGreaterThan(0.2);
      }
    }
  });

  it("sky main() touches fragColor exactly once, so no constant can be added on a line of its own", () => {
    // Pedant's #180 nit: a second statement (`fragColor += vec4(0.05)`, `fragColor.rgb = max(...)`) would add
    // brightness that does not come from uBright. Count inside main()'s body only: a declaration such as
    // `out vec4 fragColor;` (in the pack or prepended by the host) is outside main() and must not count.
    const body = glslMainBody(stripGlslComments(sky));
    expect(body, "void main() { ... } not found in sky/fragment.glsl").not.toBeNull();
    expect(body!.match(/\bfragColor\b/g)?.length ?? 0, "fragColor references inside main()").toBe(1);
  });
});

/** GLSL source without // and block comments. */
function stripGlslComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
}

/** Text between main()'s opening brace and its matching closing brace, or null. */
function glslMainBody(src: string): string | null {
  const m = /\bvoid\s+main\s*\(\s*(?:void\s*)?\)\s*\{/.exec(src);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}

/** CPU mirror of sky/fragment.glsl (these lines must appear verbatim in the shader). */
const SKY_LINES = [
  "float stripes = 0.5 + 0.5 * sin(90.0 * dir.x + 70.0 * dir.y + uTime + 6.28318 * zotoVizSlots[0].x);",
  "vec3 tint = 0.5 + 0.5 * cos(6.28318 * (0.5 * dir.y + vec3(0.0, 0.33, 0.67)));",
  "fragColor = vec4(uBright * stripes * tint, uOpacity);",
] as const;
const TAN_V = Math.tan((55 / 2) * (Math.PI / 180));

function skyRgb(u: number, v: number, time: number, pulse: number, bright: number): [number, number, number] {
  const x = (u * 2 - 1) * TAN_V * 1.6;
  const y = (v * 2 - 1) * TAN_V;
  const l = Math.hypot(x, y, 1);
  const dx = x / l;
  const dy = y / l;
  const stripes = 0.5 + 0.5 * Math.sin(90 * dx + 70 * dy + time + 6.28318 * pulse);
  const tint = [0, 0.33, 0.67].map((o) => 0.5 + 0.5 * Math.cos(6.28318 * (0.5 * dy + o)));
  return [bright * stripes * tint[0]!, bright * stripes * tint[1]!, bright * stripes * tint[2]!];
}

const lumOf = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

/** Mean linear luma of a 16 px patch centred at (u, v) on a 1280x800 stage. */
function patchLum(u: number, v: number, time: number, pulse: number, bright: number): number {
  let s = 0;
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) s += lumOf(skyRgb(u + (i - 7.5) / 1280, v + (j - 7.5) / 800, time, pulse, bright));
  return s / 256;
}

function patchSpread(u: number, v: number, time: number, pulse: number, bright: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
    const l = lumOf(skyRgb(u + (i - 7.5) / 1280, v + (j - 7.5) / 800, time, pulse, bright));
    lo = Math.min(lo, l);
    hi = Math.max(hi, l);
  }
  return hi - lo;
}
