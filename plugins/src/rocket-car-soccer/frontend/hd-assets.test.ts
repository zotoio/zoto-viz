import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import PLUGIN from "../plugin.yml?raw";
import VIS from "../visualisation.yml?raw";
import { RCS_HOST_MESH_ASSETS } from "./host-mesh-drive";

const PACK = join(__dirname, "..");
type Decl = { id: string; path: string; sha256: string; bytes: number; triangles: number };
const decls: Decl[] = [
  ...PLUGIN.matchAll(/- id: (\S+)\n\s+path: (\S+\.glb)\n\s+sha256: (\w+)\n\s+bytes: (\d+)\n\s+triangles: (\d+)/g),
].map((m) => ({ id: m[1]!, path: m[2]!, sha256: m[3]!, bytes: Number(m[4]), triangles: Number(m[5]) }));

type TexRef = { index: number };
type Glb = {
  nodes: { name?: string; mesh?: number; children?: number[] }[];
  images?: { mimeType?: string; bufferView: number }[];
  textures?: { source: number }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  extensionsUsed?: string[];
  meshes: { primitives: { indices?: number; material?: number; attributes: Record<string, number> }[] }[];
  accessors: { count: number }[];
  materials?: {
    name?: string;
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      baseColorTexture?: TexRef;
      metallicRoughnessTexture?: TexRef;
    };
    normalTexture?: TexRef;
    occlusionTexture?: TexRef;
    emissiveFactor?: number[];
    extensions?: Record<
      string,
      { clearcoatFactor?: number; clearcoatNormalTexture?: unknown; emissiveStrength?: number }
    >;
  }[];
};

function glbJson(bytes: Buffer): Glb {
  const chunkLen = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + chunkLen).toString("utf8"));
}

const readAsset = (id: string) => readFileSync(join(PACK, `assets/${id}.glb`));
const load = (id: string) => glbJson(readAsset(id));

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
function textureGpuBytes(bytes: Buffer): number {
  const json = glbJson(bytes);
  const bin = 20 + bytes.readUInt32LE(12) + 8;
  return (json.images ?? []).reduce((sum, im) => {
    const bv = json.bufferViews[im.bufferView]!;
    const start = bin + (bv.byteOffset ?? 0);
    const [w, h] = imageSize(bytes.subarray(start, start + bv.byteLength));
    return sum + Math.floor((w * h * 16) / 3);
  }, 0);
}

/** PMREMGenerator.fromEquirectangular: cube = 2^floor(log2(width / 4)), RGBA16F target 3·max(cube, 112) × 4·cube. */
function envPmremBytes(width: number): number {
  const cube = 2 ** Math.floor(Math.log2(width / 4));
  return 3 * Math.max(cube, 16 * 7) * 4 * cube * 8;
}

const luminance = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
const imageOf = (json: Glb, ref: TexRef | undefined) => (ref ? json.textures![ref.index]!.source : undefined);
function drawnTriangles(json: Glb): number {
  const perMesh = json.meshes.map((m) =>
    m.primitives.reduce((k, p) => k + Math.floor(json.accessors[p.indices!]!.count / 3), 0),
  );
  return json.nodes.reduce((n, node) => n + (node.mesh === undefined ? 0 : perMesh[node.mesh]!), 0);
}

describe("rocket-car-soccer HD model set", () => {
  const hd = decls.filter((d) => d.id.endsWith("-hd"));
  const std = decls.filter((d) => !d.id.endsWith("-hd"));

  it("offers Standard / HD with Standard as the default", () => {
    const block = VIS.split("key: modelSet")[1]!.split("- key:")[0]!;
    expect(block).toContain("[standard, Standard]");
    expect(block).toContain("[hd, HD]");
    expect(block).toMatch(/default: standard/);
  });

  it("keeps the standard assets first in host-mesh order, each with an -hd sibling after them", () => {
    expect(std.map((d) => d.id)).toEqual([...RCS_HOST_MESH_ASSETS]);
    expect(hd.map((d) => d.id)).toEqual(RCS_HOST_MESH_ASSETS.map((id) => `${id}-hd`));
    const firstHd = decls.findIndex((d) => d.id.endsWith("-hd"));
    expect(decls.slice(firstHd).every((d) => d.id.endsWith("-hd"))).toBe(true);
  });

  it("ships meshopt HD GLBs (≤ 800 KB) whose bytes, hash and drawn triangles match the manifest", () => {
    for (const d of hd) {
      const bytes = readFileSync(join(PACK, d.path));
      expect(bytes.length, d.id).toBe(d.bytes);
      expect(bytes.length, d.id).toBeLessThanOrEqual(800_000);
      expect(createHash("sha256").update(bytes).digest("hex"), d.id).toBe(d.sha256);
      expect(bytes.toString("latin1")).toContain("EXT_meshopt_compression");
      expect(drawnTriangles(glbJson(bytes)), d.id).toBe(d.triangles);
    }
  });

  it("HD cars keep every node the drive articulates (wheels spin, flame scales)", () => {
    for (const id of ["rocket-car", "rocket-car-blue"]) {
      const names = new Set(load(`${id}-hd`).nodes.map((n) => n.name || ""));
      for (const n of [
        "rocket_car",
        "chassis",
        "booster_nozzle",
        "booster_flame",
        "wheel_front_left",
        "wheel_front_right",
        "wheel_rear_left",
        "wheel_rear_right",
      ]) {
        expect(names.has(n), `${id}-hd ${n}`).toBe(true);
      }
    }
    expect(load("soccer-ball-hd").nodes.some((n) => n.name === "soccer_ball")).toBe(true);
  });

  it("HD car paint is a clearcoated livery with a panel-line normal, carbon and tyres are textured PBR", () => {
    for (const id of ["rocket-car-hd", "rocket-car-blue-hd"]) {
      const json = load(id);
      expect(json.extensionsUsed).toContain("KHR_materials_clearcoat");
      expect(json.images!.every((i) => i.mimeType === "image/jpeg" || i.mimeType === "image/png")).toBe(true);
      const paint = json.materials!.find((m) => /paint/.test(m.name || ""));
      expect(paint, id).toBeDefined();
      expect(paint!.pbrMetallicRoughness?.baseColorTexture, id).toBeDefined();
      expect(paint!.normalTexture, id).toBeDefined();
      expect(paint!.pbrMetallicRoughness?.metallicRoughnessTexture, id).toBeDefined();
      expect(paint!.extensions?.KHR_materials_clearcoat?.clearcoatFactor, id).toBeGreaterThan(0.5);
      expect(paint!.extensions?.KHR_materials_clearcoat?.clearcoatNormalTexture, id).toBeDefined();
      // the stripe faces carry the same livery image as the paint (one atlas)
      const stripe = json.materials!.find((m) => m.name === "car_stripe")!;
      expect(imageOf(json, stripe.pbrMetallicRoughness?.baseColorTexture), id).toBe(
        imageOf(json, paint!.pbrMetallicRoughness?.baseColorTexture),
      );
      for (const part of [/carbon/, /tyre|tire/]) {
        const mat = json.materials!.find((m) => part.test(m.name || ""));
        expect(mat, `${id} ${part}`).toBeDefined();
        expect(mat!.pbrMetallicRoughness?.baseColorTexture, `${id} ${part}`).toBeDefined();
        expect(mat!.normalTexture, `${id} ${part}`).toBeDefined();
        expect(mat!.occlusionTexture, `${id} ${part}`).toBeDefined();
      }
    }
  });

  it("HD cars carry emissive team-colour light ribbons, glowing calipers and hub caps", () => {
    for (const [id, team] of [["rocket-car-hd", "orange"], ["rocket-car-blue-hd", "blue"]] as const) {
      const json = load(id);
      expect(json.extensionsUsed).toContain("KHR_materials_emissive_strength");
      const strip = json.nodes.findIndex((n) => n.name === "light_strips");
      expect(strip, id).toBeGreaterThan(-1);
      const chassis = json.nodes.find((n) => n.name === "chassis")!;
      expect(chassis.children, id).toContain(strip);
      for (const name of [`car_light_strip_${team}`, `car_accent_${team}`, "wheel_hub"]) {
        const mat = json.materials!.find((m) => m.name === name);
        expect(mat, `${id} ${name}`).toBeDefined();
        expect(Math.max(...mat!.emissiveFactor!), `${id} ${name}`).toBeGreaterThan(0.9);
        expect(mat!.extensions?.KHR_materials_emissive_strength?.emissiveStrength, `${id} ${name}`).toBeGreaterThan(1);
      }
    }
  });

  it("HD ball is stitched leather: white and black panel materials sharing normal + ORM, seam vertex colours", () => {
    const json = load("soccer-ball-hd");
    expect(json.materials!.map((m) => m.name)).toEqual(["soccer_ball_leather_white", "soccer_ball_leather_black"]);
    const [white, black] = json.materials!;
    expect(luminance(white!.pbrMetallicRoughness!.baseColorFactor!)).toBeGreaterThan(0.8);
    expect(luminance(black!.pbrMetallicRoughness!.baseColorFactor!)).toBeLessThan(0.01);
    for (const mat of [white!, black!]) {
      expect(mat.pbrMetallicRoughness?.metallicRoughnessTexture).toBeDefined();
      expect(mat.normalTexture).toBeDefined();
      expect(mat.occlusionTexture).toBeDefined();
    }
    expect(imageOf(json, white!.normalTexture)).toBe(imageOf(json, black!.normalTexture));
    const prims = json.meshes.flatMap((m) => m.primitives);
    expect(new Set(prims.map((p) => p.material))).toEqual(new Set([0, 1]));
    expect(prims.every((p) => p.attributes.COLOR_0 !== undefined)).toBe(true);
  });

  it("fits maxGpuBytes with every HD texture and the environment PMREM", () => {
    const ceiling = JSON.parse(readFileSync(join(PACK, "../../../service/policy/work-budget-ceilings.json"), "utf8"));
    const env = readFileSync(join(PACK, "assets/env-hd.jpg"));
    const [w, h] = imageSize(env);
    expect(w).toBe(h * 2);
    const textures = hd.reduce((sum, d) => sum + textureGpuBytes(readFileSync(join(PACK, d.path))), 0);
    expect(textures + envPmremBytes(w)).toBeLessThanOrEqual(ceiling.maxGpuBytes);
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
});
