import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// #180: the sandbox iframe CSP is `connect-src 'none'` (service/pack_assets.py). Chrome fetches JSON
// modules (`import x from "./a.json" with { type: "json" }`) under connect-src, so the import fails,
// the pack never registers onPresent and the view heals to Topology. Every relative import in this
// pack has to be a JS module, which loads under script-src like helper.js does.
const here = path.dirname(new URL(import.meta.url).pathname);
const entry = path.join(here, "module.js");

function relativeImports(src: string): { spec: string; attrs: string }[] {
  const out: { spec: string; attrs: string }[] = [];
  const re = /\bimport\s+(?:[^'";]*?\sfrom\s+)?["'](\.{1,2}\/[^"']+)["']\s*(with\s*\{[^}]*\})?/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.push({ spec: m[1], attrs: m[2] ?? "" });
  return out;
}

describe("sandbox-fixture-multi module graph (#180)", () => {
  it("imports only JS modules that ship in the pack (no JSON import blocked by connect-src 'none')", () => {
    const src = readFileSync(entry, "utf8");
    const imports = relativeImports(src);
    expect(imports.map((i) => i.spec)).toContain("./helper.js");
    for (const i of imports) {
      expect(i.attrs, `${i.spec} uses import attributes`).toBe("");
      expect(i.spec, `${i.spec} is not a .js module`).toMatch(/\.js$/);
      expect(existsSync(path.join(here, i.spec)), `${i.spec} missing from the pack`).toBe(true);
    }
    expect(src).not.toMatch(/\.json["']/);
    expect(src).not.toMatch(/type\s*:\s*["']json["']/);
  });

  describe("hooks", () => {
    const g = globalThis as { zoto?: unknown };
    const writes: [string, number][] = [];
    const z: {
      onPresent?: (() => void) | null;
      onFrame?: ((frame: unknown) => void) | null;
      writeUniform: (n: string, v: number) => void;
    } = { writeUniform: (n, v) => writes.push([n, v]) };

    beforeAll(async () => {
      g.zoto = z;
      await import("./module.js");
    });
    afterAll(() => {
      delete g.zoto;
    });

    function expectBrightWrites(n: number): void {
      expect(writes.length).toBe(n);
      for (const [name, v] of writes) {
        expect(name).toBe("uBright");
        expect(v).toBeGreaterThanOrEqual(0.92 * 0.1 - 1e-9);
        expect(v).toBeLessThanOrEqual(0.92 + 1e-9);
      }
    }

    it("onPresent writes uBright from the fixture bright times the pulse", () => {
      writes.length = 0;
      expect(typeof z.onPresent).toBe("function");
      for (let k = 0; k < 3; k++) z.onPresent!();
      expectBrightWrites(3);
    });

    it("writes on data frames too, because the manifest has no viz.presentTick (host sends no present ticks)", () => {
      // Red at c20802db: onPresent never fires without presentTick, so the pack makes no viz writes while
      // frames arrive; tile health reads that as drawing-nothing and heals the view to Topology.
      const yml = readFileSync(path.join(here, "..", "plugin.yml"), "utf8");
      expect(/^\s*presentTick:\s*true\b/m.test(yml)).toBe(false);
      writes.length = 0;
      expect(typeof z.onFrame, "module.js must set zoto.onFrame").toBe("function");
      for (let k = 0; k < 3; k++) z.onFrame!({ t: k, dt: 0.1, audio: 0, packets: [], rf: [], talkers: [] });
      expectBrightWrites(3);
    });
  });
});
