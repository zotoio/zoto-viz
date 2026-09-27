import type { DreamAnim } from "../graph/scene";
import { pluginWall, type PluginLook, type PluginWall } from "./plugin";

export type WallSnap = Pick<DreamAnim, "mosaic" | "hero" | "mosaicTree" | "mosaicMaxId" | "mosaicSharedTheme"> & {
  mosaicTiles: string[];
};

export type WallState = {
  owner: string | null;
  restore: WallSnap | null;
};

export type CatalogWall = {
  modeId: string;
  wall: PluginWall;
};

export function snapWall(a: WallSnap): WallSnap {
  return {
    mosaic: a.mosaic,
    hero: a.hero,
    mosaicTiles: [...(a.mosaicTiles ?? [])],
    mosaicTree: a.mosaicTree,
    mosaicMaxId: a.mosaicMaxId,
    mosaicSharedTheme: !!a.mosaicSharedTheme,
  };
}

export function soloWallSnap(sharedTheme = false): WallSnap {
  return {
    mosaic: "off",
    hero: "off",
    mosaicTiles: [],
    mosaicTree: null,
    mosaicMaxId: "",
    mosaicSharedTheme: sharedTheme,
  };
}

export function wallMatches(a: Pick<WallSnap, "mosaic" | "hero" | "mosaicTiles">, wall: PluginWall): boolean {
  const tiles = a.mosaicTiles ?? [];
  return a.mosaic === wall.mosaic
    && a.hero === wall.hero
    && tiles.length === wall.mosaicTiles.length
    && tiles.every((id, i) => id === wall.mosaicTiles[i]);
}

/** Current tiles are a 2+ subset of a catalog wall (Syscon after closes still counts). */
export function isWallRemnant(tiles: string[] | undefined, walls: CatalogWall[]): boolean {
  const ids = tiles ?? [];
  if (ids.length < 2) return false;
  return walls.some(({ wall }) => ids.every((id) => wall.mosaicTiles.includes(id)));
}

export function inferWallOwner(tiles: string[] | undefined, walls: CatalogWall[]): string | null {
  const ids = tiles ?? [];
  if (ids.length < 2) return null;
  return walls.find(({ wall }) => ids.every((id) => wall.mosaicTiles.includes(id)))?.modeId ?? null;
}

export function catalogWalls(looks: Iterable<[string, PluginLook | undefined]>): CatalogWall[] {
  const out: CatalogWall[] = [];
  for (const [modeId, look] of looks) {
    const wall = pluginWall(look);
    if (wall) out.push({ modeId, wall });
  }
  return out;
}

/**
 * Entering a wall view (Syscon) pins that mosaic. An explicit view change
 * replaces a wall or wall remnant — including when the new view is one of
 * the wall's own tiles. Re-applying the same mode (boot / profile / persist)
 * keeps a persisted remnant and operator pane picks on that wall. Tile look /
 * max passes keepLayout.
 */
export function resolvePluginWall(input: {
  modeId: string;
  prevModeId: string;
  keepLayout: boolean;
  anim: WallSnap;
  wall: PluginWall | null;
  walls: CatalogWall[];
  owner: string | null;
  restore: WallSnap | null;
  /** Stage-only / `look.mosaic: off` views own the frame — drop a live mosaic. */
  solo?: boolean;
}): { anim: WallSnap | null; state: WallState } {
  const { modeId, prevModeId, keepLayout, anim, wall, walls, owner, restore, solo } = input;
  if (keepLayout) return { anim: null, state: { owner, restore } };

  if (solo && !wall) {
    if (anim.mosaic === "off") return { anim: null, state: { owner: null, restore } };
    return {
      anim: soloWallSnap(anim.mosaicSharedTheme),
      state: { owner: null, restore: restore ?? snapWall(anim) },
    };
  }

  if (wall) {
    const remnant = isWallRemnant(anim.mosaicTiles, walls);
    const nextRestore = owner === modeId || remnant ? restore : snapWall(anim);
    if (wallMatches(anim, wall)) return { anim: null, state: { owner: modeId, restore: nextRestore } };
    // Re-applying the same wall view (persist echo, profile, pane pick) must not
    // wipe tiles the operator already changed on the wall.
    if (prevModeId === modeId) {
      return { anim: null, state: { owner: modeId, restore: nextRestore } };
    }
    return {
      anim: {
        mosaic: wall.mosaic,
        hero: wall.hero,
        mosaicTiles: wall.mosaicTiles,
        mosaicSharedTheme: wall.mosaicSharedTheme,
        mosaicTree: null,
        mosaicMaxId: "",
      },
      state: { owner: modeId, restore: nextRestore },
    };
  }

  const remnant = isWallRemnant(anim.mosaicTiles, walls);
  const inferred = owner ?? inferWallOwner(anim.mosaicTiles, walls);
  if (!inferred && !remnant) return { anim: null, state: { owner: null, restore } };

  // Boot / profile re-apply of the same tile view keeps the persisted wall.
  if (prevModeId === modeId) {
    return { anim: null, state: { owner: inferred, restore } };
  }

  const keep = restore && !isWallRemnant(restore.mosaicTiles, walls) ? restore : soloWallSnap(anim.mosaicSharedTheme);
  return { anim: keep, state: { owner: null, restore: null } };
}
