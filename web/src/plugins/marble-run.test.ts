import { describe, expect, it } from "vitest";
import * as THREE from "three";
import FRAG from "../../../plugins/src/marble-run/sky/fragment.glsl?raw";
import VIS from "../../../plugins/src/marble-run/visualisation.yml?raw";
import PLUGIN from "../../../plugins/src/marble-run/plugin.yml?raw";
import { MARBLE_DATA_MAPPING, parseMarbleOptions } from "../../../plugins/src/marble-run/frontend/config";
import {
  MR_SLOT,
  disposeMarblePack,
  ingestFrame,
  marbleWorkBudget,
  packMarbleSlots,
  parseMarbleWorkBudgetYaml,
  setMarbleOptions,
} from "../../../plugins/src/marble-run/frontend/pack";
import { EMPTY_SYS_TELEMETRY, type VizDataFrame } from "../../../plugins/sdk/viz-contract";
import { SIM_DT } from "../../../plugins/src/marble-run/frontend/sim";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";
import { buildMarbleRunScenery, decodeLook } from "../graph/marble-run-scenery";
import { marbleRunStagePose, stageMeshPose } from "../graph/stage-mesh-camera";
import { pinPackContents } from "../app/host-mesh-bridge";
import { toPluginView } from "./plugin-visualisation";
import { parseVizContract } from "./viz-host";

const TRADEMARKS = ["minecraft", "mojang", "rocket league", "psyonix"];

function liveFrame(over: Partial<VizDataFrame> = {}): VizDataFrame {
  return { t: 0, dt: SIM_DT, audio: 0, packets: [], rf: [], talkers: [], headlines: [], sys: { ...EMPTY_SYS_TELEMETRY, failed: 0 }, ...over };
}

describe("marble-run pack", () => {
  it("validates plugin.yml viz contract and catalog row", () => {
    const contract = parseVizContract({
      graphWalk: false,
      maxBuffers: 4,
      maxBufferFloats: 64,
      maxParticles: 0,
      uniforms: ["uTime", "uOpacity", "uBright", "uAudio", "uAccent", "uBg"],
      idle: { fixture: "host" },
      hostMeshSlot: 7,
    });
    expect(contract?.maxBuffers).toBe(4);
    expect(contract?.hostMeshSlot).toBe(7);
    expect(PLUGIN).toMatch(/hostMeshSlot: 7/);
    expect(PLUGIN).toMatch(/path: assets\/marble-track\.glb/);
    const view = toPluginView({
      id: "marble-run",
      name: "Marble Run",
      version: 1,
      capabilities: ["viz.read", "viz.write", "config.read"],
      viz: {
        graphWalk: false,
        maxBuffers: 4,
        maxBufferFloats: 64,
        maxParticles: 0,
        idle: { fixture: "host" },
      },
      visualisation: {
        engine: "graph",
        base: "protocols",
        idle: { fixture: "host" },
        config: [
          { key: "preset", label: "preset", type: "select", default: "workshop", values: [["workshop", "Workshop"]] },
        ],
      },
    });
    expect(view.id).toBe("marble-run");
    expect(view.config?.length).toBeGreaterThan(0);
    expect(view.viz?.idle).toEqual({ fixture: "host" });
  });


  it("declares mapping and work budget in shipped yaml", () => {
    expect(VIS).toMatch(/dataMapping/);
    expect(VIS).toMatch(/workBudget/);
    expect(MARBLE_DATA_MAPPING.length).toBe(4);
    const fromYaml = parseMarbleWorkBudgetYaml(VIS);
    expect(fromYaml).toEqual(marbleWorkBudget());
    expect(fromYaml.maxInstances).toBe(48);
    for (const row of MARBLE_DATA_MAPPING) expect(VIS).toContain(row.effect);
  });

  it("passes trademark name check on pack text", () => {
    const blob = `${PLUGIN}\n${VIS}\n${FRAG}`.toLowerCase();
    for (const mark of TRADEMARKS) expect(blob.includes(mark)).toBe(false);
  });

  it("wraps and compiles the sky shader", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });
  it("clamps options from config.read strings only", () => {
    const o = parseMarbleOptions({
      preset: "calm-spiral",
      seed: "9999999",
      complexity: "9",
      maxMarbles: "100",
      jarCount: "2",
      failThreshold: "2",
      destField: "talker",
      colorField: "service",
    });
    expect(o.preset).toBe("calm-spiral");
    expect(o.seed).toBe(999_999);
    expect(o.complexity).toBe(5);
    expect(o.maxMarbles).toBe(48);
    expect(o.jarCount).toBe(3);
    expect(o.failThreshold).toBe(0.95);
    expect(o.destField).toBe("proto");
  });


  it("host scenery draws the pack's marbles from the slots without reallocating", () => {
    disposeMarblePack();
    setMarbleOptions(parseMarbleOptions({ maxMarbles: "20" }));
    for (let f = 0; f < 120; f++) ingestFrame(liveFrame({ t: f * SIM_DT, packets: [{ proto: "dns", size: 90, field: 0.2 }] }));
    const slots = packMarbleSlots(liveFrame());
    const read = (slot: number, i: number) => slots[slot]?.[i] ?? 0;
    const sc = buildMarbleRunScenery();
    const lane = new THREE.Group();
    lane.add(sc.root);
    sc.update(read, SIM_DT);
    expect(sc.count).toBe(20);
    const meshes = sc.root.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[];
    expect(meshes).toHaveLength(2);
    const m = new THREE.Matrix4();
    meshes[0]!.getMatrixAt(19, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    expect(p.length()).toBeGreaterThan(0.05);
    const before = meshes[0]!.instanceMatrix.array;
    sc.update(read, SIM_DT);
    expect(meshes[0]!.instanceMatrix.array).toBe(before);
    expect(decodeLook(17.5)).toEqual({ radius: 0.017, hue: 0.5 });
  });

  it("stage camera follows the pack's slot camera and fits portrait panes", () => {
    disposeMarblePack();
    ingestFrame(liveFrame());
    const slots = packMarbleSlots(liveFrame());
    const read = (slot: number, i: number) => slots[slot]?.[i] ?? 0;
    const pose = stageMeshPose("marble-run", read, 32 / 9);
    expect(pose?.position[2]).toBeCloseTo(slots[0]![MR_SLOT.camZ]!, 5);
    expect(pose?.fov).toBe(36);
    const tall = marbleRunStagePose(read, 0.5);
    expect(tall.fov!).toBeGreaterThan(36);
    const before = marbleRunStagePose(() => 0, 2);
    expect(before.position[2]).toBeGreaterThan(3);
  });

  it("pins the track GLB at the origin and mounts the marble scenery", () => {
    const packets: number[][] = [];
    let scenery: THREE.Object3D | null = null;
    pinPackContents({ applySlotBuffer: (d) => { packets.push(Array.from(d)); }, setScenery: (r) => { scenery = r; } }, "marble-run");
    expect(packets).toHaveLength(1);
    expect(packets[0]!.slice(0, 3)).toEqual([2, 0, 1]);
    expect(packets[0]!.slice(3, 19)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect((scenery as THREE.Object3D | null)?.name).toBe("marble-run-scenery");
  });
});
