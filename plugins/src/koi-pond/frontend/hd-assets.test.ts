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

function glbJson(bytes: Buffer): {
  animations: { name: string; channels: unknown[] }[];
  nodes: { name?: string; translation?: number[]; rotation?: number[]; mesh?: number; skin?: number }[];
  skins?: unknown[];
  images?: unknown[];
  extensionsUsed?: string[];
} {
  const chunkLen = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + chunkLen).toString("utf8"));
}

describe("koi-pond HD model set", () => {
  const hd = decls.filter((d) => d.id.endsWith("-hd"));
  const std = decls.filter((d) => !d.id.endsWith("-hd"));

  it("offers Standard / HD with Standard as the default", () => {
    const block = VIS.split("key: modelSet")[1]!.split("- key:")[0]!;
    expect(block).toContain("[standard, Standard]");
    expect(block).toContain("[hd, HD]");
    expect(block).toMatch(/default: standard/);
  });

  it("lists every HD asset after the standard ones, each the sibling of a standard asset", () => {
    expect(hd.map((d) => d.id)).toEqual(["koi-kohaku-hd", "koi-showa-hd", "koi-ogon-hd", "lily-pads-hd", "pond-rocks-hd"]);
    const firstHd = decls.findIndex((d) => d.id.endsWith("-hd"));
    expect(decls.slice(firstHd).every((d) => d.id.endsWith("-hd"))).toBe(true);
    for (const d of hd) expect(std.some((s) => `${s.id}-hd` === d.id)).toBe(true);
  });

  it("ships a Blender scape GLB with natural bank (no kerb ring) and flowering lilies", () => {
    expect(decls[0]!.id).toBe("koi-pond-scape");
    const bytes = readFileSync(join(PACK, decls[0]!.path));
    expect(bytes.length).toBe(decls[0]!.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(decls[0]!.sha256);
    const json = glbJson(bytes);
    const names = json.nodes.map((n) => n.name || "");
    expect(names.some((n) => n.includes("bank-stones") || n.includes("pond-rocks"))).toBe(true);
    expect(names.some((n) => /kerb|basin-kerb/i.test(n))).toBe(false);
    expect(names.some((n) => n.includes("fountain"))).toBe(true);
    expect(names.some((n) => n.includes("lily-pad"))).toBe(true);
    expect(names.some((n) => n.includes("lotus-bloom"))).toBe(true);
    expect((json.images ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("ships meshopt HD GLBs whose bytes and hash match the manifest", () => {
    for (const d of hd) {
      const bytes = readFileSync(join(PACK, d.path));
      expect(bytes.length).toBe(d.bytes);
      expect(bytes.length).toBeLessThan(900_000); // textured PBR HD
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(d.sha256);
      expect(bytes.toString("latin1")).toContain("EXT_meshopt_compression");
    }
  });

  it("HD koi are textured, skinned, headed, with a swim clip on spine/tail/fins", () => {
    for (const v of ["kohaku", "showa", "ogon"]) {
      const b = readFileSync(join(PACK, `assets/koi-${v}-hd.glb`));
      const json = glbJson(b);
      expect(json.animations.map((a) => a.name)).toContain("swim");
      expect((json.skins ?? []).length).toBeGreaterThanOrEqual(1);
      expect((json.images ?? []).length).toBeGreaterThanOrEqual(2);
      const names = json.nodes.map((n) => n.name || "");
      expect(names).toContain("head");
      expect(names).toContain("tail_02");
      expect(names).toContain("spine_02");
      expect(names).toContain("root");
      expect(names.some((n) => n.includes("fin_pectoral"))).toBe(true);
      expect(json.nodes.some((n) => n.skin !== undefined && n.mesh !== undefined)).toBe(true);
      // Swim drives body/tail/fin rotations (gltfpack may drop constant T/S tracks)
      const swim = json.animations.find((a) => a.name === "swim")!;
      expect(swim.channels.length).toBeGreaterThanOrEqual(7);
    }
  });
});
