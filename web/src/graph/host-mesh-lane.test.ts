import * as THREE from "three";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as hostMeshLane from "./host-mesh-lane";
import { disposeHostMeshObject3D, embeddedImageTexturePlugin, HostMeshLane, normalizeSwimClipStart, showHostMeshInstance, stepAquariumDecor } from "./host-mesh-lane";

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

  it("shows live copies even though the loaded template is hidden", async () => {
    const lane = new HostMeshLane();
    const loader = (lane as unknown as { loader: { loadAsync: (url: string) => Promise<unknown> } }).loader;
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    vi.spyOn(loader, "loadAsync").mockResolvedValue(mockGltf(root));
    lane.setAssetOrder(["box"]);
    const priv = lane as unknown as LanePrivate;
    await priv.load("pack", { id: "box", path: "box.glb" });
    const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    lane.applySlotBuffer([2, 0, 1, ...ident, 0, 0, 0, 0]);
    expect(lane.group.children).toHaveLength(1);
    const live = lane.group.children[0]!;
    expect(live.visible).toBe(true);
    const mesh = live.children[0] as THREE.Mesh;
    expect(mesh.renderOrder).toBe(2);
    expect((mesh.material as THREE.Material).transparent).toBe(true);
  });

  it("pinned fish cruise forward instead of sliding back through their heading", () => {
    const pose = {
      x: 0.1, y: 0.2, z: 0, yaw: 0.4, scale: 1, phase: 0.2, speed: 0.4, homeY: 0.2,
    };
    let backward = 0;
    let forward = 0;
    for (let i = 0; i < 180; i++) {
      const prevX = pose.x;
      const prevZ = pose.z;
      const t = i / 60;
      stepAquariumDecor(pose, t, 1 / 60);
      const dx = pose.x - prevX;
      const dz = pose.z - prevZ;
      const dot = dx * Math.sin(pose.yaw) + dz * Math.cos(pose.yaw);
      if (dot < -1e-6) backward++;
      forward += Math.max(0, dot);
    }
    expect(backward).toBe(0);
    expect(forward).toBeGreaterThan(0.3);
    expect(pose.y).toBeGreaterThan(0.15);
    expect(pose.y).toBeLessThan(0.25);
  });

  it("decodes embedded glTF images without fetching blob URLs", async () => {
    const bitmap = { width: 2, height: 2, close() {} };
    const create = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", create);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;
    const parser = {
      json: {
        textures: [{ source: 0, sampler: 0, name: "body" }],
        images: [{ name: "body_basecolor", mimeType: "image/jpeg", bufferView: 3 }],
        samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
      },
      getDependency: vi.fn(async () => bytes),
    };
    const plugin = embeddedImageTexturePlugin(parser);
    const tex = await plugin.loadTexture(0);
    expect(parser.getDependency).toHaveBeenCalledWith("bufferView", 3);
    expect(create).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(tex).toBeInstanceOf(THREE.Texture);
    expect(tex?.image).toBe(bitmap);
    expect(tex?.flipY).toBe(false);
    expect(tex?.wrapS).toBe(THREE.RepeatWrapping);
    parser.json.images[0] = { uri: "external.png" };
    expect(plugin.loadTexture(0)).toBeNull();
    fetchSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("showHostMeshInstance draws a hidden template copy over the stage sky", () => {
    const mat = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    const root = new THREE.Group();
    root.visible = false;
    root.add(mesh);
    const live = root.clone(true);
    showHostMeshInstance(live);
    expect(live.visible).toBe(true);
    expect((live.children[0] as THREE.Mesh).renderOrder).toBe(2);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(true);
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

  it("normalizeSwimClipStart shifts swim tracks to t=0 without changing duration", () => {
    const leadIn = 1 / 24;
    const track = new THREE.NumberKeyframeTrack(".bones[0].position[x]", [leadIn, leadIn + 1.2], [0, 0.5]);
    const clip = new THREE.AnimationClip("swim", leadIn + 1.2, [track]);
    const beforeDuration = clip.duration;
    const norm = normalizeSwimClipStart(clip)!;
    expect(norm.duration).toBe(beforeDuration);
    expect(norm.tracks[0]!.times[0]).toBe(0);
    expect(norm.tracks[0]!.times[1]).toBeCloseTo(1.2, 6);
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
