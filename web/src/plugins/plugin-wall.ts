import type { DreamAnim } from "../graph/scene";
import { mosaicTileViewId } from "../graph/mosaic-tile-id";
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
function wallCoversTiles(wallTiles: string[], slots: string[]): boolean {
  if (slots.length < 2 || wallTiles.length < 2) return false;
  const slotViews = slots.map(mosaicTileViewId);
  if (new Set(slotViews).size !== slotViews.length) return false;
  const want = new Set(wallTiles.map(mosaicTileViewId));
  return slotViews.every((v) => want.has(v));
}

export function isWallRemnant(tiles: string[] | undefined, walls: CatalogWall[]): boolean {
  const ids = tiles ?? [];
  if (ids.length < 2) return false;
  return walls.some(({ wall }) => wallCoversTiles(wall.mosaicTiles, ids));
}

export function inferWallOwner(tiles: string[] | undefined, walls: CatalogWall[]): string | null {
  const ids = tiles ?? [];
  if (ids.length < 2) return null;
  return walls.find(({ wall }) => wallCoversTiles(wall.mosaicTiles, ids))?.modeId ?? null;
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
 * the wall's own tiles. Re-applying the same mode (boot / profile) keeps a
 * persisted remnant. Tile look / max passes keepLayout.
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
}): { anim: WallSnap | null; state: WallState } {
  const { modeId, prevModeId, keepLayout, anim, wall, walls, owner, restore } = input;
  if (keepLayout) return { anim: null, state: { owner, restore } };

  if (wall) {
    const remnant = isWallRemnant(anim.mosaicTiles, walls);
    const nextRestore = owner === modeId || remnant ? restore : snapWall(anim);
    if (wallMatches(anim, wall)) return { anim: null, state: { owner: modeId, restore: nextRestore } };
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
