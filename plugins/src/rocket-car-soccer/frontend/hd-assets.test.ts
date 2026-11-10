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

type Glb = {
  nodes: { name?: string; mesh?: number; children?: number[] }[];
  images?: { mimeType?: string }[];
  extensionsUsed?: string[];
  meshes: { primitives: { indices?: number; material?: number }[] }[];
  accessors: { count: number }[];
  materials?: {
    name?: string;
    pbrMetallicRoughness?: { baseColorTexture?: unknown; metallicRoughnessTexture?: unknown };
    normalTexture?: unknown;
    occlusionTexture?: unknown;
    extensions?: Record<string, { clearcoatFactor?: number; clearcoatNormalTexture?: unknown }>;
  }[];
};

function glbJson(bytes: Buffer): Glb {
  const chunkLen = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + chunkLen).toString("utf8"));
}

const load = (id: string) => glbJson(readFileSync(join(PACK, `assets/${id}.glb`)));
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

  it("HD car paint is clearcoated with a panel-line normal, carbon and tyres are textured PBR", () => {
    for (const id of ["rocket-car-hd", "rocket-car-blue-hd"]) {
      const json = load(id);
      expect(json.extensionsUsed).toContain("KHR_materials_clearcoat");
      expect(json.images!.every((i) => i.mimeType === "image/jpeg" || i.mimeType === "image/png")).toBe(true);
      const paint = json.materials!.find((m) => /paint/.test(m.name || ""));
      expect(paint, id).toBeDefined();
      expect(paint!.normalTexture, id).toBeDefined();
      expect(paint!.pbrMetallicRoughness?.metallicRoughnessTexture, id).toBeDefined();
      expect(paint!.extensions?.KHR_materials_clearcoat?.clearcoatFactor, id).toBeGreaterThan(0.5);
      expect(paint!.extensions?.KHR_materials_clearcoat?.clearcoatNormalTexture, id).toBeDefined();
      for (const part of [/carbon/, /tyre|tire/]) {
        const mat = json.materials!.find((m) => part.test(m.name || ""));
        expect(mat, `${id} ${part}`).toBeDefined();
        expect(mat!.pbrMetallicRoughness?.baseColorTexture, `${id} ${part}`).toBeDefined();
        expect(mat!.normalTexture, `${id} ${part}`).toBeDefined();
        expect(mat!.occlusionTexture, `${id} ${part}`).toBeDefined();
      }
    }
  });

  it("HD ball is stitched leather: albedo + normal + ORM on one material", () => {
    const json = load("soccer-ball-hd");
    expect(json.materials).toHaveLength(1);
    const mat = json.materials![0]!;
    expect(mat.pbrMetallicRoughness?.baseColorTexture).toBeDefined();
    expect(mat.pbrMetallicRoughness?.metallicRoughnessTexture).toBeDefined();
    expect(mat.normalTexture).toBeDefined();
    expect(mat.occlusionTexture).toBeDefined();
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
