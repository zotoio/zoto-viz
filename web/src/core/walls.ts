import type { ScopeBag, ScopeValue } from "./settings-scope";
import { DEFAULT_WALL_NAME } from "./scope-copy";

export type WallRecord = {
  id: string;
  name: string;
  layout: Record<string, ScopeValue>;
  defaults: ScopeBag;
  tiles: Record<string, ScopeBag>;
};

export type WallFile = {
  active: string;
  walls: Record<string, WallRecord>;
};

const KEEP_OFF_WALL = ["theme", "ai", "filters"] as const;

export function emptyWallFile(): WallFile {
  const wall = defaultWall({}, {}, {});
  return { active: wall.id, walls: { [wall.id]: wall } };
}

export function defaultWall(
  layout: Record<string, ScopeValue>,
  defaults: ScopeBag,
  tiles: Record<string, ScopeBag>,
): WallRecord {
  return { id: "default", name: DEFAULT_WALL_NAME, layout: { ...layout }, defaults: { ...defaults }, tiles: { ...tiles } };
}

/** Today's wall becomes Default. Layout, defaults, and tile overrides are copied. */
export function migrateCurrentWall(
  layout: Record<string, ScopeValue>,
  defaults: ScopeBag,
  tiles: Record<string, ScopeBag>,
): WallFile {
  const wall = defaultWall(layout, defaults, tiles);
  return { active: wall.id, walls: { [wall.id]: wall } };
}

export function saveWallAs(file: WallFile, name: string, fromId = file.active): WallFile {
  const src = file.walls[fromId] ?? defaultWall({}, {}, {});
  const id = wallId(name, file);
  const next: WallRecord = {
    id,
    name: name.trim() || DEFAULT_WALL_NAME,
    layout: { ...src.layout },
    defaults: { ...src.defaults },
    tiles: structuredClone(src.tiles),
  };
  return { active: id, walls: { ...file.walls, [id]: next } };
}

export function renameWall(file: WallFile, id: string, name: string): WallFile {
  const wall = file.walls[id];
  if (!wall) return file;
  return { ...file, walls: { ...file.walls, [id]: { ...wall, name: name.trim() || wall.name } } };
}

export function deleteWall(file: WallFile, id: string): WallFile {
  if (!file.walls[id] || Object.keys(file.walls).length < 2) return file;
  const walls = { ...file.walls };
  delete walls[id];
  const active = file.active === id ? Object.keys(walls)[0]! : file.active;
  return { active, walls };
}

/** Switching walls replaces layout and wall/tile overrides. Theme, AI, and filters stay put. */
export function switchedLook(
  kept: Record<string, ScopeValue>,
  wall: WallRecord,
): { kept: Record<string, ScopeValue>; layout: Record<string, ScopeValue>; defaults: ScopeBag; tiles: Record<string, ScopeBag> } {
  const next = { ...kept };
  for (const key of KEEP_OFF_WALL) {
    if (key in kept) next[key] = kept[key]!;
  }
  return { kept: next, layout: { ...wall.layout }, defaults: { ...wall.defaults }, tiles: structuredClone(wall.tiles) };
}

/** A profile that names no wall leaves the current wall alone. */
export function wallAfterProfile(profileWallId: string | null | undefined, currentId: string, known: string[]): string {
  if (profileWallId && known.includes(profileWallId)) return profileWallId;
  return currentId;
}

export function roundTrip(file: WallFile): WallFile {
  return JSON.parse(JSON.stringify(file)) as WallFile;
}

function wallId(name: string, file: WallFile): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "wall";
  let id = base;
  let n = 2;
  while (file.walls[id]) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}
