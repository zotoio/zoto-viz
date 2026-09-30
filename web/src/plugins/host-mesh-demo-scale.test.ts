/**
 * #195 part 2 (host-mesh-demo scale). The fixture mesh never showed: the pack's slot-2 matrix put
 * the 1 m fixture triangle at scale 0.35, z -1.2, but the pack has no stage-mesh camera
 * (stage-mesh-camera.ts only poses aquarium and koi-pond), so it is drawn by the default stage
 * camera: NetScene's (0, 820, 820) orbit around the origin, levelled to the horizon for the
 * stageOnly view, about 1160 m out. At that distance the triangle is under a thousandth of the view.
 *
 * Row (CPU only, no screenshot): mount the pack's compiled view on a NetScene, step frames until the
 * stage camera has settled, drive the pack's real onPresent over a clock sweep, decode each slot-2
 * write with the host's decoder (a frame it refuses keeps the last pose, as HostMeshLane does),
 * transform the fixture's own glTF vertices and project them through the scene camera. Every sample
 * must sit inside the view and be a non-trivial fraction of it.
 *
 * Revert: scale 0.35 at z -1.2 in plugins/src/host-mesh-demo/frontend/index.ts turns it red.
 *
 * #209: the pack used to write a bare 16-float matrix, which decodeHostMeshSlotPacket reads as a v2
 * header whenever m[0] = s·cos rounds to 2 (about 0.1% of clock values at scale 300), and refuses.
 * The sweep row asserts no write is refused; the #209 row finds such a clock on the pack's own writes
 * and drives the write through a real HostMeshLane with the pack's fixture asset. Revert: the bare
 * `host.writeBuffer(2, matrixSlot(clock))` turns the #209 row red.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeHostMeshSlotPacket } from "../../../plugins/sdk/host-mesh-frame";
import type { VizZoto } from "../../../plugins/sdk/viz-zoto";
import type { VizPresentTick } from "../../../plugins/sdk/viz-contract";
import { frameTsFromRaf } from "../core/time-ms";
import { resetVizClockInjectors, setVizClockInjector } from "../core/viz-clock";
import { HostMeshLane, type HostMeshAssetDecl } from "../graph/host-mesh-lane";
import { NetScene } from "../graph/scene";
import { stageMeshPackId, stageMeshPose } from "../graph/stage-mesh-camera";
import { compileShippedPackMode, loadShippedPackSpec } from "./fixtures/host-idle-shipped-packs";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../..");
const PACK = "host-mesh-demo";
const W = 1280, H = 720;
const MESH_SLOT = 2;
/** Frames stepped before measuring: the stage fov eases to its lens cap (38.7 deg at 16:9) well within this. */
const SETTLE_FRAMES = 600;
/** Clock sweep: 0..63 s in 0.1 s steps covers several spins (0.4 rad/s) and pulses (0.7 rad/s). */
const SWEEP = Array.from({ length: 631 }, (_, i) => i * 0.1);
/** Projected bounds height, as a fraction of the view height, that every sample must reach. */
const MIN_HEIGHT = 0.1;
/** Largest projected bounds area over the sweep, as a fraction of the view. */
const MIN_AREA = 0.02;

type Gltf = {
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  accessors: { bufferView: number; count: number; type: string; componentType: number }[];
  bufferViews: { buffer: number; byteOffset?: number }[];
  buffers: { uri: string }[];
};

/** The fixture asset's own vertices (plugin.yml `assets[0]`), read from its embedded buffer. */
function fixtureVertices(): THREE.Vector3[] {
  const spec = loadShippedPackSpec(REPO, PACK);
  const decl = spec.assets?.[0];
  if (!decl) throw new Error(`${PACK} declares no asset`);
  const gltf: Gltf = JSON.parse(readFileSync(path.join(REPO, "plugins/src", PACK, decl.path), "utf8"));
  const acc = gltf.accessors[gltf.meshes[0]!.primitives[0]!.attributes.POSITION]!;
  expect([acc.type, acc.componentType], "POSITION is float VEC3").toEqual(["VEC3", 5126]);
  const view = gltf.bufferViews[acc.bufferView]!;
  const uri = gltf.buffers[view.buffer]!.uri;
  const bytes = Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
  const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset + (view.byteOffset ?? 0), bytes.byteOffset + (view.byteOffset ?? 0) + acc.count * 12));
  return Array.from({ length: acc.count }, (_, i) => new THREE.Vector3(f[i * 3], f[i * 3 + 1], f[i * 3 + 2]));
}

describe("#195 host-mesh-demo: the fixture mesh shows at the default stage camera", () => {
  const hosts: HTMLElement[] = [];
  let clock = 0;
  let written: number[] | null = null;
  const zoto: VizZoto = {
    onTick: null,
    onConfig: null,
    onFrame: null,
    onPresent: null,
    writeBuffer: (slot, data) => { if (slot === MESH_SLOT) written = Array.from(data); },
    writeUniform: () => {},
    writeParticles: () => {},
  };

  beforeEach(() => {
    expect.hasAssertions();
    Object.assign(globalThis, { zoto });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetVizClockInjectors();
    Reflect.deleteProperty(globalThis, "zoto");
    for (const h of hosts) h.remove();
    hosts.length = 0;
  });

  it("every present over a 63 s clock sweep: the triangle's projected bounds are inside the view and at least 10% of its height", async () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => W });
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => H });
    document.body.append(el);
    hosts.push(el);
    await import("../../../plugins/src/host-mesh-demo/frontend/index");
    const present = zoto.onPresent;
    if (typeof present !== "function") throw new Error(`${PACK} frontend did not register onPresent`);
    clock = 0;
    setVizClockInjector(() => clock);
    const graph = new NetScene(el);
    const mode = compileShippedPackMode(REPO, PACK);
    expect(mode.stageOnly, `${PACK} is a stageOnly view`).toBe(true);
    expect(stageMeshPose(stageMeshPackId(mode.id, mode.pluginId), () => 0), `${PACK} has no stage-mesh camera pose`).toBeNull();
    graph.setMode(mode, {});
    const cam = graph.camera;
    const pose = () => [...cam.position.toArray(), cam.fov].map((v) => v.toFixed(3)).join(" ");
    let settled = "";
    for (let i = 0; i < SETTLE_FRAMES; i++) {
      clock += 16;
      graph.hostFrame(frameTsFromRaf(clock));
      if (i === SETTLE_FRAMES - 61) settled = pose();
    }
    expect(pose(), "the stage camera has settled (same pose and fov over the last 60 frames)").toBe(settled);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const lane = graph.hostMeshLane.group;
    lane.updateMatrixWorld(true);
    const camText = `camera (${cam.position.toArray().map((v) => v.toFixed(1)).join(", ")}) fov ${cam.fov.toFixed(1)} aspect ${cam.aspect.toFixed(3)} near ${cam.near} far ${cam.far}`;


    const verts = fixtureVertices();
    const inst = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const refused: string[] = [];
    let decoded = 0;
    let minH = Infinity, minHAt = NaN, maxArea = 0;
    const outside: string[] = [];
    for (const t of SWEEP) {
      written = null;
      const tick: VizPresentTick = { frameMs: t * 1000, tileId: PACK, pluginClock: t };
      present(tick);
      if (!written) throw new Error(`${PACK} onPresent wrote no slot ${MESH_SLOT} buffer at t=${t}`);
      const pkt = decodeHostMeshSlotPacket(written);
      const m = pkt?.instances[0]?.matrix;
      // HostMeshLane keeps the last pose when the decoder refuses a write; nothing is drawn before the first.
      if (m) { inst.fromArray(m); decoded++; } else { refused.push(t.toFixed(1)); if (decoded === 0) continue; }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, inView = true;
      for (const v of verts) {
        p.copy(v).applyMatrix4(inst).applyMatrix4(lane.matrixWorld).project(cam);
        if (!(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && Math.abs(p.z) <= 1)) inView = false;
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      if (!inView) outside.push(t.toFixed(1));
      const h = (y1 - y0) / 2;
      if (h < minH) { minH = h; minHAt = t; }
      maxArea = Math.max(maxArea, ((x1 - x0) / 2) * h);
    }
    graph.dispose();
    const text = `${camText}; smallest height ${minH.toExponential(3)} of the view at t=${minHAt.toFixed(1)}, largest area ${maxArea.toExponential(3)}, ${refused.length}/${SWEEP.length} writes refused by the host decoder`;
    process.stdout.write(`[#195 host-mesh-demo] ${text}\n`);
    expect(refused, `clock values whose slot-${MESH_SLOT} write the host decoder refused (${text})`).toEqual([]);
    expect(decoded, "every write decodes").toBe(SWEEP.length);
    expect(outside, `samples with a vertex outside the view (${text})`).toEqual([]);
    expect(minH, `projected triangle height, fraction of the view height (${text})`).toBeGreaterThanOrEqual(MIN_HEIGHT);
    expect(maxArea, `largest projected bounds area, fraction of the view (${text})`).toBeGreaterThanOrEqual(MIN_AREA);
  });

  it("#209: at a clock where the matrix's first value s·cos rounds to 2, the host decodes the write and the drawn pose updates", async () => {
    await import("../../../plugins/src/host-mesh-demo/frontend/index");
    const present = zoto.onPresent;
    if (typeof present !== "function") throw new Error(`${PACK} frontend did not register onPresent`);
    const writeAt = (t: number): number[] => {
      written = null;
      const tick: VizPresentTick = { frameMs: t * 1000, tileId: PACK, pluginClock: t };
      present(tick);
      if (!written) throw new Error(`${PACK} onPresent wrote no slot ${MESH_SLOT} buffer at t=${t}`);
      return written;
    };
    /** The instance matrix the pack sent, in either encoding: a bare 16-float matrix, or a v2 packet's first instance. */
    const sentMatrix = (w: number[]): number[] => {
      if (w.length === 16) return w;
      if (w[0] === 2 && w.length >= 3 + 20) return w.slice(3, 19);
      throw new Error(`unrecognised ${PACK} slot write (${w.length} floats, header ${w[0]})`);
    };
    const m00 = (t: number) => sentMatrix(writeAt(t))[0]! - 2;
    // First clock where m[0] = s·cos crosses 2 going down (cos -> 0 near t = pi / 0.8), found by a
    // 0.01 s scan then bisection on the pack's own writes: deterministic, no copy of the pack's formula.
    let lo = 0, hi = NaN;
    for (let t = 0.01; t < 20; t += 0.01) {
      if (m00(lo) > 0 && m00(t) <= 0) { hi = t; break; }
      lo = t;
    }
    expect(hi, "m[0] = s·cos crosses 2 within 20 s").toBeLessThan(20);
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (m00(mid) > 0) lo = mid; else hi = mid;
    }
    const tStar = hi;
    const edge = writeAt(tStar);
    const sent = sentMatrix(edge);
    const at = `t=${tStar.toFixed(6)} s (m[0] = s·cos = ${sent[0]!.toFixed(6)}, write ${edge.length} floats)`;
    expect(Math.round(sent[0]!), `the ambiguous case: m[0] rounds to 2 at ${at}`).toBe(2);
    process.stdout.write(`[#209 host-mesh-demo] ambiguous clock ${at}\n`);

    // The host lane with the pack's real fixture asset (fetched from its /api/plugins/<id>/asset URL).
    const decls: HostMeshAssetDecl[] = (loadShippedPackSpec(REPO, PACK).assets ?? []).map((a) => ({ ...a }));
    const gltfPath = path.join(REPO, "plugins/src", PACK, decls[0]!.path);
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes(`/api/plugins/${PACK}/asset/`)) return new Response(readFileSync(gltfPath));
      return realFetch(input, init);
    });
    const lane = new HostMeshLane();
    await lane.ensureAssets(PACK, decls);
    expect(lane.allAssetsFailed(), `${PACK}'s fixture asset loads into the host lane`).toBe(false);
    // float32 as the lane stores it; `+ 0` folds -0 into 0 (the host decoder's `|| 0` does the same)
    const f32 = (m: ArrayLike<number>) => Array.from(Float32Array.from(Array.from(m)), (v) => v + 0);
    const before = writeAt(0);
    lane.applySlotBuffer(before);
    const drawnPose = () => {
      const root = lane.group.children[0];
      if (!root) throw new Error("the host lane drew no instance");
      return Array.from(root.matrix.elements, (v) => v + 0);
    };
    expect(drawnPose(), "t=0: the lane draws the pack's pose").toEqual(f32(sentMatrix(before)));
    const pkt = decodeHostMeshSlotPacket(edge);
    expect(pkt?.instances.length ?? 0, `the host decoder accepts the write at ${at}`).toBe(1);
    lane.applySlotBuffer(edge);
    expect(drawnPose(), `the drawn pose updates to the pack's matrix at ${at}`).toEqual(f32(sent));
    lane.clear();
  });
});
