import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import PLUGIN from "../plugin.yml?raw";
import VIS from "../visualisation.yml?raw";
import { fishTemplate } from "./fish-behaviour";
import { FRESHWATER_SPECIES, SALTWATER_SPECIES, validateTank } from "./tank-types";

const PACK = join(__dirname, "..");
type Decl = { id: string; path: string; sha256: string; bytes: number };
const decls: Decl[] = [...PLUGIN.matchAll(/- id: (\S+)\n\s+path: (\S+\.glb)\n\s+sha256: (\w+)\n\s+bytes: (\d+)/g)]
  .map((m) => ({ id: m[1]!, path: m[2]!, sha256: m[3]!, bytes: Number(m[4]) }));

type Gltf = {
  nodes: { name?: string; mesh?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes: { name?: string; primitives: { indices?: number; material?: number; attributes: Record<string, number> }[] }[];
  accessors: { count: number; componentType: number; min?: number[]; max?: number[] }[];
  materials: { name?: string; alphaMode?: string; pbrMetallicRoughness?: { baseColorTexture?: unknown }; normalTexture?: unknown }[];
  images?: { mimeType?: string }[];
  extensionsUsed?: string[];
};

function gltf(path: string): { bytes: Buffer; json: Gltf } {
  const bytes = readFileSync(join(PACK, path));
  return { bytes, json: JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8")) as Gltf };
}

const FLOAT = 5126;
const DECOR = /^(substrate|fresh-|reef-)/;

describe("aquarium HD model set", () => {
  const std = decls.find((d) => d.id === "aquarium-scape")!;
  const hd = decls.find((d) => d.id === "aquarium-scape-hd")!;

  it("offers Standard / HD with Standard as the default", () => {
    const block = VIS.split("key: modelSet")[1]!.split("- key:")[0]!;
    expect(block).toContain("[standard, Standard]");
    expect(block).toContain("[hd, HD]");
    expect(block).toMatch(/default: standard/);
  });

  it("declares one HD scape after the Standard one (the host swaps <id>-hd into the standard slot)", () => {
    expect(decls.map((d) => d.id)).toEqual(["aquarium-scape", "aquarium-scape-hd"]);
    expect(std.path).toBe("assets/aquarium-scape.glb");
  });

  it("ships a meshopt HD GLB ≤ 800 KB whose bytes, hash and triangles match the manifest", () => {
    const { bytes, json } = gltf(hd.path);
    expect(bytes.length).toBe(hd.bytes);
    expect(bytes.length).toBeLessThanOrEqual(800_000);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hd.sha256);
    expect(json.extensionsUsed).toContain("EXT_meshopt_compression");
    const tris = Number(PLUGIN.match(/- id: aquarium-scape-hd\n(?:\s+\w+: \S+\n)*?\s+triangles: (\d+)/)![1]);
    const counted = json.meshes.reduce(
      (n, m) => n + m.primitives.reduce((k, p) => k + Math.floor(json.accessors[p.indices!]!.count / 3), 0),
      0,
    );
    expect(counted).toBe(tris);
  });

  it("keeps every part the host scenery and tank validation look for, under valid names", () => {
    const names = gltf(hd.path).json.nodes.map((n) => n.name || "");
    for (const part of ["substrate", "fresh-rocks", "fresh-driftwood", "fresh-plant-fern", "fresh-plant-vallisneria",
      "fresh-plant-rotala", "fresh-plant-moss", "reef-rocks", "reef-coral-staghorn", "reef-coral-brain",
      "reef-coral-fan", "reef-anemone", "reef-sand"]) {
      expect(names, part).toContain(part);
    }
    const decor = names.filter((n) => DECOR.test(n));
    expect(validateTank("freshwater", [], decor.filter((n) => !n.startsWith("reef-")))).toEqual([]);
    expect(validateTank("reef", [], decor.filter((n) => !n.startsWith("fresh-")))).toEqual([]);
    for (let sp = 0; sp < FRESHWATER_SPECIES.length; sp++) expect(names).toContain(`fish-${fishTemplate(sp, false)}`);
    for (let sp = 0; sp < SALTWATER_SPECIES.length; sp++) expect(names).toContain(`fish-${fishTemplate(sp, true)}`);
  });

  it("keeps float positions (the sway and swim shaders read local units) and COLOR_0 on every primitive", () => {
    const { json } = gltf(hd.path);
    for (const m of json.meshes) {
      for (const p of m.primitives) {
        expect(json.accessors[p.attributes.POSITION!]!.componentType, m.name).toBe(FLOAT);
        expect("COLOR_0" in p.attributes, m.name).toBe(true);
      }
    }
  });

  it("HD fish keep the Standard swim template: same nodes, identity transforms, same body bounds", () => {
    const a = gltf(std.path).json;
    const b = gltf(hd.path).json;
    const byName = (g: Gltf) => new Map(g.nodes.map((n) => [n.name || "", n]));
    const na = byName(a);
    const nb = byName(b);
    for (const name of [...na.keys()].filter((n) => /-(body|fins|eyes)$/.test(n) || n.startsWith("fish-"))) {
      const x = nb.get(name);
      expect(x, name).toBeDefined();
      expect(x!.translation ?? null, name).toEqual(na.get(name)!.translation ?? null);
      expect(x!.rotation ?? null, name).toEqual(na.get(name)!.rotation ?? null);
      if (!name.endsWith("-body")) continue;
      const pa = a.accessors[a.meshes[na.get(name)!.mesh!]!.primitives[0]!.attributes.POSITION!]!;
      const pb = b.accessors[b.meshes[x!.mesh!]!.primitives[0]!.attributes.POSITION!]!;
      for (let i = 0; i < 3; i++) {
        expect(pb.min![i]!, name).toBeCloseTo(pa.min![i]!, 4);
        expect(pb.max![i]!, name).toBeCloseTo(pa.max![i]!, 4);
      }
    }
  });

  it("is photo-textured: albedo + normal on scape and fish skin, fins and eyes as the host detects them", () => {
    const { json } = gltf(hd.path);
    expect((json.images ?? []).length).toBeGreaterThanOrEqual(12);
    expect((json.images ?? []).every((i) => i.mimeType === "image/jpeg" || i.mimeType === "image/png")).toBe(true);
    const mats = new Map(json.materials.map((m) => [m.name, m]));
    for (const name of ["sand", "reef-sand", "seiryu-stone", "driftwood", "plant", "moss", "live-rock", "coral", "fish-skin"]) {
      expect(mats.get(name)?.pbrMetallicRoughness?.baseColorTexture, name).toBeDefined();
      expect(mats.get(name)?.normalTexture, name).toBeDefined();
    }
    expect(mats.get("sea-fan")?.alphaMode).toBe("MASK");
    expect(mats.get("fish-fin")?.pbrMetallicRoughness?.baseColorTexture).toBeDefined();
    expect(mats.has("fish-eye")).toBe(true);
  });

  it("ships one HD environment image (2:1 JPEG, ≤ 400 KB) whose bytes and hash match the manifest", () => {
    const envs = [...PLUGIN.matchAll(/- id: (\S+)\n\s+path: (\S+)\n\s+role: environment\n\s+sha256: (\w+)\n\s+bytes: (\d+)/g)];
    expect(envs.map((m) => m[1])).toEqual(["env-hd"]);
    const [, , path, sha, size] = envs[0]!;
    const bytes = readFileSync(join(PACK, path!));
    expect(bytes.length).toBe(Number(size));
    expect(bytes.length).toBeLessThanOrEqual(400_000);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha);
    expect(bytes.subarray(0, 3).toString("hex")).toBe("ffd8ff");
    const sof = bytes.indexOf(Buffer.from([0xff, 0xc0]));
    expect(sof).toBeGreaterThan(0);
    expect(bytes.readUInt16BE(sof + 7)).toBe(bytes.readUInt16BE(sof + 5) * 2);
  });

  it("adds ≤ 2 MB over the Standard pack", () => {
    const env = Number(PLUGIN.match(/- id: env-hd\n(?:\s+\w+: \S+\n)*?\s+bytes: (\d+)/)![1]);
    expect(hd.bytes + env).toBeLessThanOrEqual(2_000_000);
  });
});
