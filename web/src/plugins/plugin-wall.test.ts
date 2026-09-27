import { describe, expect, it } from "vitest";
import type { PluginLook, PluginWall } from "./plugin";
import {
  catalogWalls, inferWallOwner, isWallRemnant, resolvePluginWall, snapWall, soloWallSnap, wallMatches,
} from "./plugin-wall";

const SYS_TILES = [
  "plugin:cores", "plugin:memory", "plugin:disk", "plugin:gpu",
  "plugin:sockets", "plugin:cgroups", "plugin:units", "plugin:udev",
];

const syscon: PluginWall = {
  mosaic: "8",
  hero: "off",
  mosaicTiles: SYS_TILES,
  mosaicSharedTheme: true,
};

const walls = [{ modeId: "plugin:syscon", wall: syscon }];

const remnant = {
  mosaic: "8" as const,
  hero: "off" as const,
  mosaicTiles: ["plugin:cores", "plugin:memory", "plugin:disk", "plugin:cgroups", "plugin:udev"],
  mosaicTree: null,
  mosaicMaxId: "",
  mosaicSharedTheme: true,
};

const custom = {
  mosaic: "4" as const,
  hero: "left" as const,
  mosaicTiles: ["plugin:talkers", "plugin:topology"],
  mosaicTree: null,
  mosaicMaxId: "",
  mosaicSharedTheme: false,
};

describe("plugin wall remnants", () => {
  it("treats a closed-tile sys mosaic as a remnant", () => {
    expect(isWallRemnant(remnant.mosaicTiles, walls)).toBe(true);
    expect(inferWallOwner(remnant.mosaicTiles, walls)).toBe("plugin:syscon");
    expect(isWallRemnant(["plugin:talkers", "plugin:topology"], walls)).toBe(false);
    expect(isWallRemnant(["plugin:cores"], walls)).toBe(false);
    expect(isWallRemnant(["plugin:air-bt!1", "plugin:air-bt!2"], walls)).toBe(false);
    expect(isWallRemnant(["plugin:cores!1", "plugin:memory"], walls)).toBe(true);
  });

  it("lists catalog walls from looks", () => {
    const looks = new Map<string, PluginLook>([
      ["plugin:syscon", { mosaic: "8", hero: "off", mosaicTiles: SYS_TILES, mosaicSharedTheme: true }],
      ["plugin:udev", { backdrop: "plugin" }],
    ]);
    expect(catalogWalls(looks).map((w) => w.modeId)).toEqual(["plugin:syscon"]);
  });

  it("matches a full wall pin", () => {
    expect(wallMatches({ mosaic: "8", hero: "off", mosaicTiles: SYS_TILES }, syscon)).toBe(true);
    expect(wallMatches(remnant, syscon)).toBe(false);
  });
});

describe("resolvePluginWall", () => {
  it("applies a wall and snapshots a custom mosaic", () => {
    const out = resolvePluginWall({
      modeId: "plugin:syscon",
      prevModeId: "plugin:topology",
      keepLayout: false,
      anim: custom,
      wall: syscon,
      walls,
      owner: null,
      restore: null,
    });
    expect(out.anim?.mosaicTiles).toEqual(SYS_TILES);
    expect(out.state.owner).toBe("plugin:syscon");
    expect(out.state.restore).toEqual(snapWall(custom));
  });

  it("does not snapshot a sys remnant as the restore target", () => {
    const out = resolvePluginWall({
      modeId: "plugin:syscon",
      prevModeId: "plugin:udev",
      keepLayout: false,
      anim: remnant,
      wall: syscon,
      walls,
      owner: null,
      restore: null,
    });
    expect(out.anim?.mosaicTiles).toEqual(SYS_TILES);
    expect(out.state.restore).toBeNull();
  });

  it("replaces a persisted sys remnant when the view changes", () => {
    const out = resolvePluginWall({
      modeId: "plugin:topology",
      prevModeId: "plugin:udev",
      keepLayout: false,
      anim: remnant,
      wall: null,
      walls,
      owner: null,
      restore: null,
    });
    expect(out.anim).toEqual(soloWallSnap(true));
    expect(out.state.owner).toBeNull();
  });

  it("replaces sys splits when selecting a tile from the view menu", () => {
    const out = resolvePluginWall({
      modeId: "plugin:udev",
      prevModeId: "plugin:syscon",
      keepLayout: false,
      anim: { ...remnant, mosaicTiles: SYS_TILES },
      wall: null,
      walls,
      owner: "plugin:syscon",
      restore: snapWall(custom),
    });
    expect(out.anim).toEqual(snapWall(custom));
    expect(out.state.owner).toBeNull();
    expect(out.state.restore).toBeNull();
  });

  it("keeps a persisted remnant when re-applying the same tile view", () => {
    const out = resolvePluginWall({
      modeId: "plugin:udev",
      prevModeId: "plugin:udev",
      keepLayout: false,
      anim: remnant,
      wall: null,
      walls,
      owner: null,
      restore: null,
    });
    expect(out.anim).toBeNull();
    expect(out.state.owner).toBe("plugin:syscon");
  });

  it("leaves the wall alone when layout is locked", () => {
    const out = resolvePluginWall({
      modeId: "plugin:topology",
      prevModeId: "plugin:udev",
      keepLayout: true,
      anim: remnant,
      wall: null,
      walls,
      owner: "plugin:syscon",
      restore: snapWall(custom),
    });
    expect(out.anim).toBeNull();
    expect(out.state.owner).toBe("plugin:syscon");
    expect(out.state.restore).toEqual(snapWall(custom));
  });

  it("drops a restore that is itself a sys remnant", () => {
    const out = resolvePluginWall({
      modeId: "plugin:topology",
      prevModeId: "plugin:syscon",
      keepLayout: false,
      anim: { ...remnant, mosaicTiles: SYS_TILES },
      wall: null,
      walls,
      owner: "plugin:syscon",
      restore: remnant,
    });
    expect(out.anim).toEqual(soloWallSnap(true));
  });
});
