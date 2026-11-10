import { describe, expect, it } from "vitest";
import * as THREE from "three";
import FRAG from "../../../plugins/src/aurora-fjord/sky/fragment.glsl?raw";
import PLUGIN from "../../../plugins/src/aurora-fjord/plugin.yml?raw";
import KP_FIXTURE from "../../../plugins/src/aurora-fjord/frontend/fixtures/noaa-kp-headlines.json?raw";
import { parseFjordOptions } from "../../../plugins/src/aurora-fjord/frontend/config";
import {
  AF_CABIN,
  AF_CABIN_FLOATS,
  AF_CABIN_SLOT,
  AF_MAX_CABINS,
  AF_MAX_RIPPLES,
  AF_RIPPLE_SLOT,
  AF_SLOT,
  disposeFjordPack,
  ingestFrame,
  packFjordSlots,
  setFjordOptions,
} from "../../../plugins/src/aurora-fjord/frontend/fjord";
import { EMPTY_SYS_TELEMETRY, type VizDataFrame, type VizHeadline } from "../../../plugins/sdk/viz-contract";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";
import * as HOST from "../graph/aurora-fjord-scenery";
import { auroraFjordStagePose, stageMeshPose } from "../graph/stage-mesh-camera";
import { hostMeshDeclsForSet, hostMeshEnvironmentDecl, pinPackContents } from "../app/host-mesh-bridge";
import type { HostMeshAssetDecl } from "../graph/host-mesh-lane";
import { parseVizContract } from "./viz-host";

const DT = 1 / 60;
const KP_HEADLINES: VizHeadline[] = JSON.parse(KP_FIXTURE).headlines;

function frame(over: Partial<VizDataFrame> = {}): VizDataFrame {
  return { t: 0, dt: DT, audio: 0, packets: [], rf: [], talkers: [], headlines: [], sys: { ...EMPTY_SYS_TELEMETRY }, ...over };
}

const TALKERS = [
  { id: "a", rate: 300, role: "self" },
  { id: "b", rate: 120, role: "gateway" },
  { id: "c", rate: 40, role: "lan" },
  { id: "d", rate: 12, role: "internet" },
  { id: "e", rate: 3, role: "lan" },
];

function packSlots(frames: number, over: Partial<VizDataFrame> = {}): Float32Array[] {
  disposeFjordPack();
  setFjordOptions(parseFjordOptions({}));
  let slots: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const fr = frame({
      t: f * DT, talkers: TALKERS, headlines: KP_HEADLINES,
      packets: [{ proto: "TCP", size: 500, field: 0.3 }, { proto: "UDP", size: 90, field: 0.1 }], ...over,
    });
    ingestFrame(fr);
    slots = packFjordSlots(fr);
  }
  return slots;
}

/** A pinned-lane stand-in: the terrain and shore GLB roots as the lane clones them. */
function fakeLane() {
  const lane = new THREE.Group();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const node = (parent: THREE.Object3D, name: string, mat: THREE.Material) => {
    const n = new THREE.Group();
    n.name = name;
    n.add(new THREE.Mesh(geo, mat));
    parent.add(n);
  };
  const terrain = new THREE.Group();
  node(terrain, "terrain", new THREE.MeshStandardMaterial({ vertexColors: true }));
  const shore = new THREE.Group();
  node(shore, "cabins", new THREE.MeshStandardMaterial());
  node(shore, "pines", new THREE.MeshStandardMaterial({ alphaTest: 0.5 }));
  node(shore, "boulders", new THREE.MeshStandardMaterial());
  const windows = Array.from({ length: AF_MAX_CABINS }, (_, k) => {
    const m = new THREE.MeshStandardMaterial({ emissive: 0xff9e4d });
    node(shore, `cabin-window-${k}`, m);
    return m;
  });
  lane.add(terrain, shore);
  return { lane, windows };
}

describe("aurora fjord host", () => {
  it("validates plugin.yml viz contract and compiles the sky through the host wrapper", () => {
    const contract = parseVizContract({
      graphWalk: false, maxBuffers: 4, maxBufferFloats: 64, maxParticles: 0,
      uniforms: ["uTime", "uOpacity", "uBright", "uAudio", "uAccent", "uBg"],
      idle: { fixture: "host" }, hostMeshSlot: 7, hostMeshSlotCount: 1,
    });
    expect(contract?.hostMeshSlot).toBe(7);
    expect(PLUGIN).toMatch(/hostMeshSlot: 7/);
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if (!("error" in wrapped)) expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("swaps both meshes to their -hd siblings for HD and lights HD with the environment image", () => {
    const decls: HostMeshAssetDecl[] = [...PLUGIN.matchAll(/- id: (\S+)\n\s+path: (\S+)\n(?:\s+role: (\S+)\n)?/g)]
      .map(([, id, path, role]) => ({ id: id!, path: path!, ...(role ? { role } : {}) }));
    expect(decls).toHaveLength(5);
    expect(hostMeshDeclsForSet(decls, "standard").map((d) => d.path)).toEqual(["assets/fjord-terrain.glb", "assets/fjord-shore.glb"]);
    const hd = hostMeshDeclsForSet(decls, "hd");
    expect(hd.map((d) => d.id)).toEqual(["fjord-terrain", "fjord-shore"]);
    expect(hd.map((d) => d.path)).toEqual(["assets/fjord-terrain-hd.glb", "assets/fjord-shore-hd.glb"]);
    expect(hostMeshEnvironmentDecl(decls, "standard")).toBeNull();
    expect(hostMeshEnvironmentDecl(decls, "hd")?.path).toBe("assets/env-hd.jpg");
  });

  it("pins both GLBs at the origin and mounts the aurora-fjord scenery", () => {
    const packets: number[][] = [];
    let scenery: THREE.Object3D | null = null;
    pinPackContents({ applySlotBuffer: (d) => { packets.push(Array.from(d)); }, setScenery: (r) => { scenery = r; } }, "aurora-fjord");
    expect(packets.map((p) => p.slice(0, 3))).toEqual([[2, 0, 1], [2, 1, 1]]);
    expect((scenery as THREE.Object3D | null)?.name).toBe("aurora-fjord-scenery");
  });

  it("shares one slot layout with the host scenery", () => {
    const pack: Record<string, number> = AF_SLOT;
    for (const [key, index] of Object.entries(HOST.AF_SLOT)) expect(pack[key], key).toBe(index);
    expect(HOST.AF_CABIN).toEqual(AF_CABIN);
    expect(HOST.AF_CABIN_SLOT).toBe(AF_CABIN_SLOT);
    expect(HOST.AF_CABIN_FLOATS).toBe(AF_CABIN_FLOATS);
    expect(HOST.AF_MAX_CABINS).toBe(AF_MAX_CABINS);
    expect(HOST.AF_RIPPLE_SLOT).toBe(AF_RIPPLE_SLOT);
    expect(HOST.AF_MAX_RIPPLES).toBe(AF_MAX_RIPPLES);
  });

  it("lights windows, ripples and streaks from the pack's own slots", () => {
    const slots = packSlots(600);
    const read = (slot: number, i: number) => slots[slot]?.[i] ?? 0;
    const { lane, windows } = fakeLane();
    const sc = HOST.buildAuroraFjordScenery();
    lane.add(sc.root);
    sc.update(read, DT);
    expect(sc.bound).toBe(true);
    expect(sc.windows).toBe(8);
    expect(sc.mirrorMeshes).toBe(12);
    // five talkers: five lit cabins, the rest dark
    expect(windows[0]!.emissiveIntensity).toBeGreaterThan(1);
    expect(windows[4]!.emissiveIntensity).toBeGreaterThan(0.5);
    expect(windows[5]!.emissiveIntensity).toBeCloseTo(0.05, 5);
    expect(sc.streakCount).toBe(5);
    expect(sc.rippleCount).toBe(Math.round(slots[0]![AF_SLOT.ripples]!));
    expect(sc.rippleCount).toBeGreaterThan(2);
  });

  it("stage camera follows the pack and widens on narrow panes", () => {
    const slots = packSlots(30);
    const read = (slot: number, i: number) => slots[slot]?.[i] ?? 0;
    const pose = stageMeshPose("aurora-fjord", read, 32 / 9);
    expect(pose?.position[2]).toBeCloseTo(slots[0]![AF_SLOT.eyeZ]!, 5);
    expect(pose?.fov).toBeCloseTo(34, 3);
    expect(auroraFjordStagePose(read, 1).fov!).toBeGreaterThan(34);
  });
});
