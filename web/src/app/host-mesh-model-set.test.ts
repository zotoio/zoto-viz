import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { HD_ASSET_SUFFIX, hostMeshDeclsForSet, hostMeshModelSet } from "./host-mesh-bridge";

const PLUGINS = join(__dirname, "../../../plugins/src");
type Decl = { id: string; path: string; sha256?: string; bytes?: number; triangles?: number };
const assetsOf = (pack: string): Decl[] => parse(readFileSync(join(PLUGINS, pack, "plugin.yml"), "utf8")).assets;

describe("host mesh model set", () => {
  const decls: Decl[] = [
    { id: "koi-a", path: "assets/koi-a.glb" },
    { id: "rocks", path: "assets/rocks.glb" },
    { id: "koi-a-hd", path: "assets/koi-a-hd.glb" },
  ];

  it("defaults to standard and only takes hd when asked", () => {
    expect(hostMeshModelSet(undefined)).toBe("standard");
    expect(hostMeshModelSet({ modelSet: "nope" })).toBe("standard");
    expect(hostMeshModelSet({ modelSet: "hd" })).toBe("hd");
  });

  it("standard drops the hd entries and keeps the slot order", () => {
    expect(hostMeshDeclsForSet(decls, "standard").map((d) => [d.id, d.path])).toEqual([
      ["koi-a", "assets/koi-a.glb"],
      ["rocks", "assets/rocks.glb"],
    ]);
  });

  it("hd loads the hd file under the standard id, and keeps assets without one", () => {
    expect(hostMeshDeclsForSet(decls, "hd").map((d) => [d.id, d.path])).toEqual([
      ["koi-a", "assets/koi-a-hd.glb"],
      ["rocks", "assets/rocks.glb"],
    ]);
  });

  for (const pack of ["aquarium", "koi-pond"]) {
    it(`${pack} ships hd siblings that exist, match their hash, and keep the standard order`, () => {
      const all = assetsOf(pack);
      const hd = all.filter((d) => d.id.endsWith(HD_ASSET_SUFFIX));
      expect(hd.length).toBeGreaterThan(0);
      const std = all.filter((d) => !d.id.endsWith(HD_ASSET_SUFFIX));
      for (const d of hd) {
        expect(std.some((s) => s.id + HD_ASSET_SUFFIX === d.id)).toBe(true);
        const bytes = readFileSync(join(PLUGINS, pack, d.path));
        expect(bytes.length).toBe(d.bytes);
        expect(bytes.length).toBeLessThan(400_000);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(d.sha256);
        // meshopt-compressed like the standard set
        expect(bytes.toString("latin1")).toContain("EXT_meshopt_compression");
      }
      expect(hostMeshDeclsForSet(all, "hd").map((d) => d.id)).toEqual(std.map((d) => d.id));
    });
  }
});
