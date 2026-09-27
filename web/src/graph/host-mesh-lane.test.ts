import * as THREE from "three";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as hostMeshLane from "./host-mesh-lane";
import { disposeHostMeshObject3D, HostMeshLane } from "./host-mesh-lane";

const N_LOADED_MESHES = 3;
const M_LIVE_MIXERS = 2;

function makeSkinnedGltfRoot(name: string): THREE.Group {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.SkinnedMesh(geo, mat);
  const root = new THREE.Group();
  root.name = name;
  root.add(mesh);
  return root;
}

function mockGltf(scene: THREE.Group, animations: THREE.AnimationClip[] = []) {
  return {
    scene,
    animations,
    asset: {},
    cameras: [],
    parser: null as never,
    userData: {},
  };
}

function meshCountIn(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n += 1;
  });
  return n;
}

type LanePrivate = HostMeshLane & {
  load: (
    packId: string,
    decl: { id: string; path: string },
  ) => Promise<{ loadOk: boolean } | null>;
  templates: Map<string, unknown>;
  skinnedLive: Map<
    string,
    { root: THREE.Object3D; mixer: THREE.AnimationMixer; animOffset: number; clipDuration: number }[]
  >;
};

describe("host mesh lane", () => {
  beforeEach(() => {
    vi.spyOn(hostMeshLane, "ensureHostMeshoptDecoder").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses instance matrices from a buffer slot", async () => {
    const { parseHostMeshInstances } = await import("./host-mesh-lane");
    const data = new Array(16).fill(0);
    data[0] = 1;
    data[5] = 1;
    data[10] = 1;
    data[15] = 1;
    const frame = parseHostMeshInstances("cube", data);
    expect(frame?.assetId).toBe("cube");
    expect(frame?.matrices.length).toBe(16);
  });

  it("disposeHostMeshObject3D disposes mesh geometry and material", () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    const geoSpy = vi.spyOn(geo, "dispose");
    const matSpy = vi.spyOn(mat, "dispose");
    const n = disposeHostMeshObject3D(mesh);
    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it("clear() exact teardown counts (Performance Pedant)", async () => {
    // N_LOADED_MESHES templates + M_LIVE_MIXERS on lane.group; one GLTF still in flight.
    // Count geometry.dispose (one per template root via disposeHostMeshObject3D).
    const lane = new HostMeshLane();
    const priv = lane as unknown as LanePrivate;
    const loader = (lane as unknown as { loader: THREE.Loader & { loadAsync: (url: string) => Promise<unknown> } })
      .loader;
    const swimClip = new THREE.AnimationClip("swim", 2, []);

    let releaseInflight!: (g: ReturnType<typeof mockGltf>) => void;
    const inflightGltf = new Promise<ReturnType<typeof mockGltf>>((resolve) => {
      releaseInflight = resolve;
    });

    vi.spyOn(loader, "loadAsync").mockImplementation((url: string) => {
      if (url.includes("inflight.glb")) return inflightGltf;
      return Promise.resolve(mockGltf(makeSkinnedGltfRoot(url), [swimClip]));
    });

    const assetIds = ["mesh-a", "mesh-b", "mesh-c"];
    lane.setAssetOrder(assetIds);
    for (const id of assetIds) {
      await priv.load("pack", { id, path: `${id}.glb` });
    }
    expect(priv.templates.size).toBe(N_LOADED_MESHES);

    const liveRows: LanePrivate["skinnedLive"] extends Map<string, infer V> ? V : never = [];
    for (let i = 0; i < M_LIVE_MIXERS; i++) {
      const root = new THREE.Group();
      lane.group.add(root);
      liveRows.push({
        root,
        mixer: new THREE.AnimationMixer(root),
        animOffset: 0,
        clipDuration: 1,
      });
    }
    priv.skinnedLive.set("mesh-a", liveRows);
    expect(lane.group.children.length).toBe(M_LIVE_MIXERS);

    const inflightDone = priv.load("pack", { id: "inflight", path: "assets/inflight.glb" });

    const geoDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    geoDispose.mockClear();

    const stopSpy = vi.spyOn(THREE.AnimationMixer.prototype, "stopAllAction");

    lane.clear();

    expect(geoDispose).toHaveBeenCalledTimes(N_LOADED_MESHES);
    expect(stopSpy).toHaveBeenCalledTimes(M_LIVE_MIXERS);
    expect(lane.group.children.length).toBe(0);
    expect(priv.templates.size).toBe(0);

    releaseInflight(mockGltf(makeSkinnedGltfRoot("late-inflight")));
    await inflightDone;
    expect(priv.templates.size).toBe(0);
    expect(meshCountIn(lane.group)).toBe(0);
    expect(geoDispose).toHaveBeenCalledTimes(N_LOADED_MESHES + 1);

    const disposesAfterStale = geoDispose.mock.calls.length;
    lane.clear();
    expect(geoDispose.mock.calls.length).toBe(disposesAfterStale);
  });
});
