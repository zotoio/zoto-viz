import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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

  describe("onPresent", () => {
    const g = globalThis as { zoto?: unknown };
    afterEach(() => {
      delete g.zoto;
    });

    it("writes uBright from the fixture bright times the pulse", async () => {
      const writes: [string, number][] = [];
      const z: { onPresent?: () => void; writeUniform: (n: string, v: number) => void } = {
        writeUniform: (n, v) => writes.push([n, v]),
      };
      g.zoto = z;
      await import("./module.js");
      expect(typeof z.onPresent).toBe("function");
      for (let k = 0; k < 3; k++) z.onPresent!();
      expect(writes.length).toBe(3);
      for (const [n, v] of writes) {
        expect(n).toBe("uBright");
        expect(v).toBeGreaterThanOrEqual(0.92 * 0.1 - 1e-9);
        expect(v).toBeLessThanOrEqual(0.92 + 1e-9);
      }
    });
  });
});
