import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMarbleWorkBudgetYaml } from "./work-budget";

const packRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = readFileSync(path.join(packRoot, "plugin.yml"), "utf8");
const VIS = readFileSync(path.join(packRoot, "visualisation.yml"), "utf8");

type Decl = { id: string; path: string; sha256: string; bytes: number };
const decls: Decl[] = [...PLUGIN.matchAll(/- id: (\S+)\n\s+path: (\S+)\n(?:\s+role: \S+\n)?\s+sha256: (\w+)\n\s+bytes: (\d+)/g)]
  .map((m) => ({ id: m[1]!, path: m[2]!, sha256: m[3]!, bytes: Number(m[4]) }));
const declared = (id: string) => decls.find((d) => d.id === id)!;

type Glb = {
  json: {
    nodes: { name?: string }[];
    images?: { bufferView: number; mimeType?: string }[];
    bufferViews: { byteOffset?: number; byteLength: number }[];
    meshes: { primitives: { indices?: number; material?: number; attributes: Record<string, number> }[] }[];
    accessors: { count: number }[];
    materials?: {
      name?: string;
      pbrMetallicRoughness?: { baseColorTexture?: unknown; metallicRoughnessTexture?: unknown };
      normalTexture?: unknown;
      extensions?: Record<string, unknown>;
    }[];
    extensionsUsed?: string[];
  };
  bin: Buffer;
};

function readGlb(rel: string): Glb {
  const bytes = readFileSync(path.join(packRoot, rel));
  const jsonLen = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString("utf8")) as Glb["json"];
  const binAt = 20 + jsonLen;
  return { json, bin: bytes.subarray(binAt + 8, binAt + 8 + bytes.readUInt32LE(binAt)) };
}

function imageSize(img: Buffer): [number, number] {
  if (img.subarray(1, 4).toString("latin1") === "PNG") return [img.readUInt32BE(16), img.readUInt32BE(20)];
  let i = 2;
  while (i < img.length) {
    if (img[i] !== 0xff) { i++; continue; }
    const marker = img[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xc2) return [img.readUInt16BE(i + 7), img.readUInt16BE(i + 5)];
    i += 2 + img.readUInt16BE(i + 2);
  }
  throw new Error("no JPEG SOF");
}

/** three.js uploads every glTF image as RGBA8 with a full mip chain. */
function textureGpuBytes(glb: Glb): number {
  return (glb.json.images ?? []).reduce((sum, im) => {
    const bv = glb.json.bufferViews[im.bufferView]!;
    const [w, h] = imageSize(glb.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
    return sum + Math.floor((w * h * 4 * 4) / 3);
  }, 0);
}

/** PMREMGenerator.fromEquirectangular: cube = 2^floor(log2(width / 4)), RGBA16F target 3·max(cube, 112) × 4·cube. */
function envPmremBytes(width: number): number {
  const cube = 2 ** Math.floor(Math.log2(width / 4));
  return 3 * Math.max(cube, 16 * 7) * 4 * cube * 8;
}

function triangles(glb: Glb): number {
  return glb.json.meshes.reduce(
    (n, m) => n + m.primitives.reduce((k, p) => k + Math.floor(glb.json.accessors[p.indices!]!.count / 3), 0),
    0,
  );
}

const named = (glb: Glb) => glb.json.nodes.map((n) => n.name).filter((n): n is string => !!n).sort();

describe("marble-run HD model set", () => {
  it("offers Standard / HD with Standard as the default", () => {
    const block = VIS.split("key: modelSet")[1]!.split("- key:")[0]!;
    expect(block).toContain("[standard, Standard]");
    expect(block).toContain("[hd, HD]");
    expect(block).toMatch(/default: standard/);
  });

  it("lists the HD track after the Standard one, as its -hd sibling, plus one environment image", () => {
    expect(decls.map((d) => d.id)).toEqual(["marble-track", "marble-track-hd", "env-hd"]);
    expect(PLUGIN).toMatch(/- id: env-hd\n\s+path: assets\/env-hd\.jpg\n\s+role: environment\n/);
  });

  it("ships a meshopt HD GLB whose bytes, hash and triangles match the manifest", () => {
    const d = declared("marble-track-hd");
    const bytes = readFileSync(path.join(packRoot, d.path));
    expect(bytes.length).toBe(d.bytes);
    expect(bytes.length).toBeLessThanOrEqual(800_000);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(d.sha256);
    const glb = readGlb(d.path);
    expect(glb.json.extensionsUsed).toContain("EXT_meshopt_compression");
    const tris = Number(/- id: marble-track-hd\n(?:.*\n){3}\s+triangles: (\d+)/.exec(PLUGIN)?.[1]);
    expect(triangles(glb)).toBe(tris);
  });

  it("keeps every Standard node name (the host finds xylo-bar-<k> and bell by name)", () => {
    const std = named(readGlb("assets/marble-track.glb"));
    const hd = named(readGlb("assets/marble-track-hd.glb"));
    expect(hd).toEqual(std);
    for (const part of ["rails", "bell", "base", ...Array.from({ length: 8 }, (_, k) => `xylo-bar-${k}`)]) {
      expect(hd).toContain(part);
    }
  });

  it("is photo-textured PBR: walnut base with normal + roughness, brushed metal rails, clear-coated bars", () => {
    const glb = readGlb("assets/marble-track-hd.glb");
    const mats = glb.json.materials ?? [];
    const mat = (name: string) => mats.find((m) => m.name === name)!;
    const walnut = mat("walnut-hd");
    expect(walnut.pbrMetallicRoughness?.baseColorTexture).toBeDefined();
    expect(walnut.pbrMetallicRoughness?.metallicRoughnessTexture).toBeDefined();
    expect(walnut.normalTexture).toBeDefined();
    expect(mat("xylo-0-hd").extensions?.KHR_materials_clearcoat).toBeDefined();
    for (const name of ["steel-hd", "brass-hd", "xylo-0-hd"]) {
      expect(mat(name).pbrMetallicRoughness?.baseColorTexture, name).toBeDefined();
      expect(mat(name).pbrMetallicRoughness?.metallicRoughnessTexture, name).toBeDefined();
    }
    for (const m of glb.json.meshes) {
      for (const p of m.primitives) {
        const tex = mats[p.material!]?.pbrMetallicRoughness?.baseColorTexture;
        if (tex) expect(p.attributes.TEXCOORD_0).toBeDefined();
      }
    }
    expect(readGlb("assets/marble-track.glb").json.images ?? []).toHaveLength(0);
  });

  it("fits the pack's maxGpuBytes with the HD textures and the environment PMREM", () => {
    const { maxGpuBytes } = parseMarbleWorkBudgetYaml(VIS);
    const env = readFileSync(path.join(packRoot, declared("env-hd").path));
    const [w, h] = imageSize(env);
    expect(w).toBe(h * 2);
    expect(env.length).toBeLessThanOrEqual(400_000);
    const total = textureGpuBytes(readGlb("assets/marble-track-hd.glb")) + envPmremBytes(w);
    expect(total).toBeLessThanOrEqual(maxGpuBytes);
    expect(textureGpuBytes(readGlb("assets/marble-track.glb"))).toBe(0);
  });

  it("fits maxTriangles with the HD track and a full pool of host marbles", () => {
    const { maxTriangles, maxInstances } = parseMarbleWorkBudgetYaml(VIS);
    // each host marble is a 32×18 shell sphere plus a 20×12 core sphere
    const perMarble = (32 * 18 * 2 - 2 * 32) + (20 * 12 * 2 - 2 * 20);
    expect(triangles(readGlb("assets/marble-track-hd.glb")) + maxInstances * perMarble).toBeLessThanOrEqual(maxTriangles);
  });
});
