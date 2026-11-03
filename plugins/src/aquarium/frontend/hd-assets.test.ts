import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import PLUGIN from "../plugin.yml?raw";
import VIS from "../visualisation.yml?raw";

const PACK = join(__dirname, "..");
type Decl = { id: string; path: string; sha256: string; bytes: number };
const decls: Decl[] = [...PLUGIN.matchAll(/- id: (\S+)\n\s+path: (\S+)\n\s+sha256: (\w+)\n\s+bytes: (\d+)/g)]
  .map((m) => ({ id: m[1]!, path: m[2]!, sha256: m[3]!, bytes: Number(m[4]) }));

describe("aquarium HD model set", () => {
  const hd = decls.filter((d) => d.id.endsWith("-hd"));
  const std = decls.filter((d) => !d.id.endsWith("-hd"));

  it("offers Standard / HD with Standard as the default", () => {
    const block = VIS.split("key: modelSet")[1]!.split("- key:")[0]!;
    expect(block).toContain("[standard, Standard]");
    expect(block).toContain("[hd, HD]");
    expect(block).toMatch(/default: standard/);
  });

  it("lists every HD asset after the standard ones, each the sibling of a standard asset", () => {
    expect(hd.map((d) => d.id)).toEqual(["aquarium-plants-hd", "aquarium-substrate-hd"]);
    const firstHd = decls.findIndex((d) => d.id.endsWith("-hd"));
    expect(decls.slice(firstHd).every((d) => d.id.endsWith("-hd"))).toBe(true);
    for (const d of hd) expect(std.some((s) => `${s.id}-hd` === d.id)).toBe(true);
  });

  it("keeps the scanned HD set under 8 MB and records its CC0 sources", () => {
    const hd = decls.filter((d) => d.id.endsWith("-hd"));
    expect(hd.reduce((a, d) => a + d.bytes, 0)).toBeLessThan(8_000_000);
    const src = readFileSync(join(PACK, "assets/HD-SOURCES.md"), "utf8");
    for (const a of ["grass_medium_02", "fern_02", "calathea_orbifolia_01", "rock_moss_set_01", "stone_01", "dead_tree_trunk", "clean_pebbles"]) expect(src).toContain(`polyhaven.com/a/${a}`);
    expect(src).toContain("CC0 1.0");
  });
  it("ships meshopt HD GLBs whose bytes and hash match the manifest", () => {
    for (const d of hd) {
      const bytes = readFileSync(join(PACK, d.path));
      expect(bytes.length).toBe(d.bytes);
      expect(bytes.length).toBeLessThan(4_000_000);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(d.sha256);
      expect(bytes.toString("latin1")).toContain("EXT_meshopt_compression");
    }
  });
});
