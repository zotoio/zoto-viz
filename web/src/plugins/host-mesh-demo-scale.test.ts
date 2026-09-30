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
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeHostMeshSlotPacket } from "../../../plugins/sdk/host-mesh-frame";
import type { VizZoto } from "../../../plugins/sdk/viz-zoto";
import type { VizPresentTick } from "../../../plugins/sdk/viz-contract";
import { frameTsFromRaf } from "../core/time-ms";
import { resetVizClockInjectors, setVizClockInjector } from "../core/viz-clock";
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
    let held = 0, drawn = 0;
    let minH = Infinity, minHAt = NaN, maxArea = 0;
    const outside: string[] = [];
    for (const t of SWEEP) {
      written = null;
      const tick: VizPresentTick = { frameMs: t * 1000, tileId: PACK, pluginClock: t };
      present(tick);
      if (!written) throw new Error(`${PACK} onPresent wrote no slot ${MESH_SLOT} buffer at t=${t}`);
      const pkt = decodeHostMeshSlotPacket(written);
      const m = pkt?.instances[0]?.matrix;
      if (m) inst.fromArray(m);
      else if (drawn === 0) throw new Error(`host decoder refused ${PACK}'s first slot write at t=${t}`);
      else held++;
      drawn++;
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
    const text = `${camText}; smallest height ${minH.toExponential(3)} of the view at t=${minHAt.toFixed(1)}, largest area ${maxArea.toExponential(3)}, ${held}/${drawn} writes held (decoder refused)`;
    process.stdout.write(`[#195 host-mesh-demo] ${text}\n`);
    expect(outside, `samples with a vertex outside the view (${text})`).toEqual([]);
    expect(minH, `projected triangle height, fraction of the view height (${text})`).toBeGreaterThanOrEqual(MIN_HEIGHT);
    expect(maxArea, `largest projected bounds area, fraction of the view (${text})`).toBeGreaterThanOrEqual(MIN_AREA);
  });
});
