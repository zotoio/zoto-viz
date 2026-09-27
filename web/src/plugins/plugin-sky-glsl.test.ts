import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pluginShaderError, wrapPluginSky } from "../graph/backdrop";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packsRoot = path.join(repoRoot, "plugins/src");

function shippedSkyFrags(): { id: string; src: string }[] {
  return readdirSync(packsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const frag = path.join(packsRoot, e.name, "sky", "fragment.glsl");
      try {
        return { id: e.name, src: readFileSync(frag, "utf8") };
      } catch {
        return null;
      }
    })
    .filter((row): row is { id: string; src: string } => !!row);
}

describe("shipped plugin sky GLSL", () => {
  it("wraps every sky/fragment.glsl under the host contract", () => {
    const rows = shippedSkyFrags();
    expect(rows.length).toBeGreaterThan(8);
    for (const { id, src } of rows) {
      const err = pluginShaderError(src);
      expect(err, id).toBeNull();
      const wrapped = wrapPluginSky(src);
      expect("error" in wrapped, `${id} ${"error" in wrapped ? wrapped.error : ""}`).toBe(false);
    }
  });
});
