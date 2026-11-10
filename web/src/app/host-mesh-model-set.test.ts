import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  hostMeshDeclsForSet,
  hostMeshEnvironmentDecl,
  hostMeshModelSet,
  KOI_HD_SCAPE_ID,
  KOI_HD_SCENERY_ASSETS,
  mountPaneHostMeshes,
  pinPackContents,
  type HostMeshModelSet,
} from "./host-mesh-bridge";
import { HostMeshLane, type HostMeshAssetDecl } from "../graph/host-mesh-lane";
import { decodeHostMeshSlotPacket } from "../../../plugins/sdk/host-mesh-frame";

type Decl = { id: string; path: string };

describe("host mesh model set", () => {
  const decls: Decl[] = [
    { id: "koi-a", path: "assets/koi-a.glb" },
    { id: "rocks", path: "assets/rocks.glb" },
    { id: "koi-a-hd", path: "assets/koi-a-hd.glb" },
  ];

  it("defaults to standard and only takes hd when asked", () => {
    expect(hostMeshModelSet(undefined)).toBe("standard");
    expect(hostMeshModelSet({ modelSet: "nope" })).toBe("standard");
    expect(hostMeshModelSet({ modelSet: "hd" })).toBe("hd");
  });

  it("standard drops the hd entries and keeps the slot order", () => {
    expect(hostMeshDeclsForSet(decls, "standard").map((d) => [d.id, d.path])).toEqual([
      ["koi-a", "assets/koi-a.glb"],
      ["rocks", "assets/rocks.glb"],
    ]);
  });

  it("hd loads the hd file under the standard id, and keeps assets without one", () => {
    expect(hostMeshDeclsForSet(decls, "hd").map((d) => [d.id, d.path])).toEqual([
      ["koi-a", "assets/koi-a-hd.glb"],
      ["rocks", "assets/rocks.glb"],
    ]);
  });
});

describe("host mesh environment (HD image-based lighting)", () => {
  const env: HostMeshAssetDecl = { id: "garden", path: "assets/garden.jpg", role: "environment" };
  const decls: HostMeshAssetDecl[] = [
    { id: "koi-a", path: "assets/koi-a.glb" },
    env,
    { id: "rocks", path: "assets/rocks.glb" },
    { id: "koi-a-hd", path: "assets/koi-a-hd.glb" },
  ];

  it("an environment asset never takes a mesh slot, in either set", () => {
    for (const set of ["standard", "hd"] as HostMeshModelSet[]) {
      expect(hostMeshDeclsForSet(decls, set).map((d) => d.id)).toEqual(["koi-a", "rocks"]);
    }
  });

  it("only the hd set picks the environment", () => {
    expect(hostMeshEnvironmentDecl(decls, "standard")).toBeNull();
    expect(hostMeshEnvironmentDecl(decls, "hd")).toBe(env);
    expect(hostMeshEnvironmentDecl(decls.filter((d) => d !== env), "hd")).toBeNull();
    expect(hostMeshEnvironmentDecl(undefined, "hd")).toBeNull();
  });

  function paneLane() {
    const scene = new THREE.Scene();
    const lane = new HostMeshLane();
    scene.add(lane.group);
    vi.spyOn(lane, "ensureAssets").mockResolvedValue();
    const load = vi.spyOn(lane.env, "load").mockResolvedValue(true);
    return { scene, lane, load };
  }

  it("a Standard pane builds no environment and leaves the scene's render hooks alone", async () => {
    const { scene, lane, load } = paneLane();
    const before = scene.onBeforeRender;
    const after = scene.onAfterRender;
    await mountPaneHostMeshes(lane, { id: "koi-pond", assets: decls }, () => true, "standard");
    expect(load).not.toHaveBeenCalled();
    expect(lane.env.active()).toBe(false);
    expect(lane.env.envTarget()).toBeNull();
    expect(scene.onBeforeRender).toBe(before);
    expect(scene.onAfterRender).toBe(after);
    expect(scene.environment).toBeNull();
  });

  it("an HD pane loads the pack's environment image", async () => {
    const { lane, load } = paneLane();
    await mountPaneHostMeshes(lane, { id: "koi-pond", assets: decls }, () => true, "hd");
    expect(load).toHaveBeenCalledWith("/api/plugins/koi-pond/asset/garden.jpg");
    expect(lane.ensureAssets).toHaveBeenCalledWith("koi-pond", [
      { id: "koi-a", path: "assets/koi-a-hd.glb" },
      { id: "rocks", path: "assets/rocks.glb" },
    ]);
  });

  it("an HD pane rebound while loading clears its environment again", async () => {
    const { lane } = paneLane();
    const clear = vi.spyOn(lane.env, "clear");
    await mountPaneHostMeshes(lane, { id: "koi-pond", assets: decls }, () => false, "hd");
    // once at mount start, once when the pane turned out to be rebound
    expect(clear).toHaveBeenCalledTimes(2);
  });
});

describe("koi-pond scenery pins per model set", () => {
  const KOI_BASE: HostMeshAssetDecl[] = [
    "koi-pond-scape",
    "koi-kohaku",
    "koi-showa",
    "koi-ogon",
    "lily-pads",
    "pond-rocks",
  ].map((id) => ({ id, path: `assets/${id}.glb` }));
  const hd = (ids: string[]): HostMeshAssetDecl[] => ids.map((id) => ({ id: `${id}-hd`, path: `assets/${id}-hd.glb` }));
  /** The koi HD scan set: a bed-only scape plus scanned pads and rocks. */
  const KOI_HD_SET = [...KOI_BASE, ...hd(["koi-pond-scape", "koi-kohaku", "koi-showa", "koi-ogon", "lily-pads", "pond-rocks"])];
  /** An HD set without its own scape: HD keeps the Standard scape, which embeds pads and rocks. */
  const KOI_HD_NO_SCAPE = [...KOI_BASE, ...hd(["koi-kohaku", "koi-showa", "koi-ogon", "lily-pads", "pond-rocks"])];

  function pinnedAssets(set: HostMeshModelSet, decls: HostMeshAssetDecl[]): number[] {
    const assets: number[] = [];
    pinPackContents(
      {
        applySlotBuffer: (d) => {
          const pkt = decodeHostMeshSlotPacket(Array.from(d));
          if (!pkt) return;
          for (const inst of pkt.instances) assets.push(inst.meshAssetIndex ?? pkt.assetIndex);
        },
        setScenery: () => {},
      },
      "koi-pond",
      set,
      decls,
    );
    return [...new Set(assets)].sort((a, b) => a - b);
  }

  it("Standard draws the scape and fish only; its scape already carries pads and rocks", () => {
    expect(pinnedAssets("standard", KOI_HD_SET)).toEqual([0, 1, 2, 3]);
  });

  it("HD with koi-pond-scape-hd also pins lily-pads and pond-rocks, since that scape is just the pond bed", () => {
    expect(KOI_HD_SCENERY_ASSETS).toEqual([4, 5]);
    expect(KOI_HD_SET.some((d) => d.id === KOI_HD_SCAPE_ID)).toBe(true);
    expect(pinnedAssets("hd", KOI_HD_SET)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("HD without koi-pond-scape-hd keeps the Standard pins so pads and rocks are not drawn twice", () => {
    expect(pinnedAssets("hd", KOI_HD_NO_SCAPE)).toEqual([0, 1, 2, 3]);
  });
});
