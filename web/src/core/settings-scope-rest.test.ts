import { afterEach, describe, expect, it } from "vitest";
import {
  applyToAll,
  clearSession,
  emptyScopeStore,
  fieldOrigin,
  overridesOf,
  resolve,
  separateTile,
  setAt,
  shareTile,
  writeSession,
} from "./settings-scope";
import {
  applyAllConfirm,
  agentChangeLine,
  CLEAR_AND_APPLY,
  deleteWallConfirm,
  KEEP_THEIRS,
  overrideWarning,
  SEPARATE_TILE,
  shareWithPack,
  sourceConsentPrompt,
  TILE_OWN_SETTINGS,
} from "./scope-copy";
import { applyAgentChange, applyDiceChange, agentAnimForScope, reloadDice } from "./dice-agent-scope";
import { packReducedMotion, REDUCED_MOTION_PACKS, reducedMotionEnabled } from "./reduced-motion";
import { deleteWall, migrateCurrentWall, renameWall, roundTrip, saveWallAs, switchedLook, wallAfterProfile } from "./walls";
import { hostSkyForFailedTile } from "../graph/tile-sky-fallback";
import type { DreamAnim } from "../graph/scene";

const ctx = { packId: "koi-pond", viewId: "plugin:koi-pond", wallId: "default", tileId: "plugin:koi-pond!2" };

describe("wall defaults, separate tiles, and a failed sky", () => {
  it("a wall default applies to every tile, and a tile override applies to that tile only", () => {
    let store = emptyScopeStore();
    store = setAt(store, "wall", "partCap", 40, ctx).store;
    const other = { ...ctx, tileId: "plugin:koi-pond!1" };
    expect(resolve(store, "partCap", ctx)).toBe(40);
    expect(resolve(store, "partCap", other)).toBe(40);
    store = separateTile(store, ctx.tileId);
    store = setAt(store, "tile", "partCap", 12, ctx).store;
    expect(resolve(store, "partCap", ctx)).toBe(12);
    expect(resolve(store, "partCap", other)).toBe(40);
  });

  it("a tile floor below the pack min is clamped", () => {
    let store = separateTile(emptyScopeStore(), ctx.tileId);
    store = { ...store, floor: { "koi-pond": 0.35 } };
    store = setAt(store, "tile", "render.scale.min", 0.1, ctx).store;
    expect(resolve(store, "render.scale.min", ctx)).toBe(0.35);
  });

  it("separating !2 leaves !1 unchanged, and sharing drops !2 after confirm", () => {
    let store = setAt(emptyScopeStore(), "tile", "theme", "shared", { ...ctx, tileId: "plugin:koi-pond!1" }).store;
    store = separateTile(store, "plugin:koi-pond!2");
    store = setAt(store, "tile", "theme", "only-2", ctx).store;
    expect(resolve(store, "theme", { ...ctx, tileId: "plugin:koi-pond!1" })).toBe("shared");
    expect(resolve(store, "theme", ctx)).toBe("only-2");
    expect(SEPARATE_TILE).toBe("Separate this tile");
    expect(TILE_OWN_SETTINGS).toBe("This tile has its own settings");
    const shared = shareTile(store, "plugin:koi-pond!2");
    expect(shareWithPack("Koi Pond")).toBe("Share with other Koi Pond tiles");
    expect(shared.dropped).toEqual(["theme"]);
    expect(resolve(shared.store, "theme", ctx)).toBe("shared");
  });

  it("a failed sky falls back to the recovered host sky", () => {
    expect(hostSkyForFailedTile("plugin", "matrix")).toBeNull();
    expect(hostSkyForFailedTile(undefined, "matrix")).toBe("matrix");
  });
});

describe("override warning, apply to all, and reduced motion", () => {
  it("the warning count matches the overrides that exist", () => {
    let store = emptyScopeStore();
    store = setAt(store, "view", "theme", "a", ctx).store;
    store = setAt(store, "wall", "theme", "b", { ...ctx, wallId: "other" }).store;
    store = separateTile(store, ctx.tileId);
    store = setAt(store, "tile", "theme", "c", ctx).store;
    const hits = overridesOf(store, "theme");
    expect(hits).toHaveLength(3);
    expect(overrideWarning(hits.length, "theme")).toBe("3 views or tiles set their own theme, so they won't change.");
  });

  it("Clear and apply drops the listed overrides, and Keep theirs drops none", () => {
    let store = emptyScopeStore();
    store = setAt(store, "view", "theme", "a", ctx).store;
    store = separateTile(store, ctx.tileId);
    store = setAt(store, "tile", "theme", "c", ctx).store;
    const hits = overridesOf(store, "theme");
    expect(applyAllConfirm(1, 1, "theme")).toBe("1 tiles and 1 views set their own theme. Clear them?");
    expect(KEEP_THEIRS).toBe("Keep theirs");
    expect(overridesOf(store, "theme")).toEqual(hits);
    const cleared = applyToAll(store, "theme");
    expect(CLEAR_AND_APPLY).toBe("Clear and apply");
    expect(overridesOf(cleared.store, "theme")).toEqual([]);
    expect(cleared.store.global.theme).toBeUndefined();
  });

  it("Match system follows the media query, and On reaches all 6 pack fields", () => {
    expect(reducedMotionEnabled("match", true)).toBe(true);
    expect(reducedMotionEnabled("match", false)).toBe(false);
    expect(REDUCED_MOTION_PACKS).toHaveLength(6);
    const store = emptyScopeStore();
    for (const id of REDUCED_MOTION_PACKS) {
      expect(packReducedMotion(store, id, "on", false)).toBe(true);
    }
    const held = setAt(store, "pack", "reducedMotion", false, { ...ctx, packId: "koi-pond" }).store;
    expect(packReducedMotion(held, "koi-pond", "on", false)).toBe(false);
    expect(packReducedMotion(held, "aquarium", "on", false)).toBe(true);
  });
});

describe("dice and agent scope", () => {
  afterEach(() => localStorage.clear());

  it("a session-only roll is gone after a reload, and the saved look comes back", () => {
    let store = setAt(emptyScopeStore(), "wall", "backdrop", "grid", ctx).store;
    store = applyDiceChange(store, "session", "backdrop", "nebula", "default");
    expect(resolve(store, "backdrop", ctx)).toBe("nebula");
    store = reloadDice(store);
    expect(resolve(store, "backdrop", ctx)).toBe("grid");
  });

  it("Save to this wall survives a reload and does not touch another wall", () => {
    let store = applyDiceChange(emptyScopeStore(), "wall", "backdrop", "nebula", "default");
    store = reloadDice(store);
    expect(resolve(store, "backdrop", ctx)).toBe("nebula");
    expect(resolve(store, "backdrop", { ...ctx, wallId: "other" })).toBeUndefined();
  });

  it("an agent patch at View does not write Global", () => {
    const before = emptyScopeStore();
    const after = applyAgentChange(before, "view", "theme", "aurora", ctx);
    expect(after.view[ctx.viewId]?.theme).toBe("aurora");
    expect(after.global.theme).toBeUndefined();
    expect(fieldOrigin(after, "theme", ctx)?.level).toBe("view");
  });

  it("the chat line names the field and the scope", () => {
    expect(agentChangeLine("sky", "session", "Tile 3")).toBe("Changed sky for Tile 3 (this session only).");
    expect(agentChangeLine("sky", "view")).toContain("sky");
    expect(agentChangeLine("sky", "view")).toContain("view");
  });

  it("the layout lock blocks agent layout changes in all three modes", () => {
    const anim: Partial<DreamAnim> = { mosaic: "8", backdrop: "matrix" };
    for (const _scope of ["session", "view", "global"] as const) {
      const next = agentAnimForScope(anim, false);
      expect(next?.mosaic).toBeUndefined();
      expect(next?.backdrop).toBe("matrix");
      expect(agentAnimForScope(anim, true)?.mosaic).toBe("8");
    }
  });

  it("a session value sits above the tile and is not the wall", () => {
    let store = separateTile(emptyScopeStore(), ctx.tileId);
    store = setAt(store, "tile", "theme", "tile", ctx).store;
    store = writeSession(store, "theme", "session");
    expect(resolve(store, "theme", ctx)).toBe("session");
    expect(clearSession(store).tile[ctx.tileId]?.theme).toBe("tile");
  });
});

describe("named walls", () => {
  it("save as, rename, and delete name the wall", () => {
    let file = migrateCurrentWall({ mosaic: "4" }, { partCap: 20 }, {});
    expect(file.walls.default?.name).toBe("Default");
    expect(file.walls.default?.layout.mosaic).toBe("4");
    file = saveWallAs(file, "Night");
    expect(file.walls[file.active]?.name).toBe("Night");
    file = renameWall(file, file.active, "Dawn");
    expect(file.walls[file.active]?.name).toBe("Dawn");
    const id = file.active;
    expect(deleteWallConfirm("Dawn")).toBe("Delete Dawn?");
    file = deleteWall(file, id);
    expect(file.walls[id]).toBeUndefined();
    expect(file.active).toBe("default");
  });

  it("switching walls changes layout only, and a profile with no wall keeps the current one", () => {
    const file = migrateCurrentWall({ mosaic: "8" }, { partCap: 8 }, { a: { theme: "zen" } });
    const night = saveWallAs(file, "Night");
    const look = switchedLook({ theme: "midnight", ai: "gemma", filters: "lan" }, night.walls[night.active]!);
    expect(look.kept.theme).toBe("midnight");
    expect(look.kept.ai).toBe("gemma");
    expect(look.layout.mosaic).toBe("8");
    expect(wallAfterProfile(null, "default", ["default"])).toBe("default");
    expect(wallAfterProfile("missing", "default", ["default"])).toBe("default");
    expect(wallAfterProfile(night.active, "default", Object.keys(night.walls))).toBe(night.active);
  });

  it("a round trip keeps the layout", () => {
    const file = migrateCurrentWall({ mosaic: "16" }, { quality: "low" }, { t: { sky: "grid" } });
    expect(roundTrip(file)).toEqual(file);
  });
});

describe("source host prompt", () => {
  it("names the view and the host", () => {
    expect(sourceConsentPrompt("HN Rain", "news.ycombinator.com")).toBe(
      "HN Rain wants to load data from news.ycombinator.com.",
    );
  });
});
