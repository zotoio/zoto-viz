/**
 * Settings scope resolver.
 * Precedence is tile, wall, view, the user's pack override, the pack manifest,
 * global, then the built-in default. A closer level wins.
 */

export const SCOPE_LEVELS = ["tile", "wall", "view", "pack", "manifest", "global", "builtin"] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];

/** Levels a person can write. Manifest and built-in are not. */
export type WriteLevel = "tile" | "wall" | "view" | "pack" | "global";

export type ScopeValue = string | number | boolean | null;
export type ScopeBag = Record<string, ScopeValue>;

export type ScopeStore = {
  builtin: ScopeBag;
  global: ScopeBag;
  /** Pack id → manifest defaults, including look pins. */
  manifest: Record<string, ScopeBag>;
  /** Pack id → the user's pack override. */
  pack: Record<string, ScopeBag>;
  /** View id → view override. */
  view: Record<string, ScopeBag>;
  /** Wall id → wall override. */
  wall: Record<string, ScopeBag>;
  /** Separated tile id → tile override. */
  tile: Record<string, ScopeBag>;
  /** Tile ids that no longer share the view. */
  separated: string[];
  /**
   * Session-only values. Read above the tile. Never written to a profile or a wall.
   * A reload starts without this bag.
   */
  session?: ScopeBag;
  /** Pack id → floor for `render.scale.min`. A lower override cannot go under it. */
  floor: Record<string, number>;
};

export type ScopeCtx = {
  packId: string;
  viewId: string;
  wallId: string;
  tileId: string;
};

/** Device, privacy, accessibility, agent, and server settings stay on Global. */
export const GLOBAL_ONLY_KEYS = ["device", "privacy", "accessibility", "agent", "server"] as const;

const RENDER_FLOOR_KEY = "render.scale.min";

export function emptyScopeStore(): ScopeStore {
  return {
    builtin: {},
    global: {},
    manifest: {},
    pack: {},
    view: {},
    wall: {},
    tile: {},
    separated: [],
    floor: {},
    session: {},
  };
}

export function isGlobalOnlyKey(key: string): boolean {
  return (GLOBAL_ONLY_KEYS as readonly string[]).includes(key);
}

/** `plugin:koi-pond!2` shares `plugin:koi-pond` until that tile is separated. */
export function sharedViewId(tileId: string): string {
  const i = tileId.lastIndexOf("!");
  if (i < 0) return tileId;
  const tail = tileId.slice(i + 1);
  return /^\d+$/.test(tail) ? tileId.slice(0, i) : tileId;
}

function bag(store: ScopeStore, level: WriteLevel, ctx: ScopeCtx): { id: string; bag: ScopeBag } {
  if (level === "global") return { id: "", bag: store.global };
  if (level === "pack") return { id: ctx.packId, bag: store.pack[ctx.packId] ?? {} };
  if (level === "view") return { id: ctx.viewId, bag: store.view[ctx.viewId] ?? {} };
  if (level === "wall") return { id: ctx.wallId, bag: store.wall[ctx.wallId] ?? {} };
  return { id: ctx.tileId, bag: store.tile[ctx.tileId] ?? {} };
}

function writeBag(store: ScopeStore, level: WriteLevel, id: string, next: ScopeBag): ScopeStore {
  if (level === "global") return { ...store, global: next };
  if (level === "pack") return { ...store, pack: { ...store.pack, [id]: next } };
  if (level === "view") return { ...store, view: { ...store.view, [id]: next } };
  if (level === "wall") return { ...store, wall: { ...store.wall, [id]: next } };
  return { ...store, tile: { ...store.tile, [id]: next } };
}

function readBag(map: Record<string, ScopeBag>, id: string): ScopeBag | undefined {
  return map[id];
}

export function resolve(store: ScopeStore, key: string, ctx: ScopeCtx): ScopeValue | undefined {
  const separated = store.separated.includes(ctx.tileId);
  const chain: (ScopeBag | undefined)[] = [
    store.session,
    separated ? readBag(store.tile, ctx.tileId) : undefined,
    readBag(store.wall, ctx.wallId),
    readBag(store.view, ctx.viewId),
    readBag(store.pack, ctx.packId),
    readBag(store.manifest, ctx.packId),
    store.global,
    store.builtin,
  ];
  let value: ScopeValue | undefined;
  for (const row of chain) {
    if (row && Object.prototype.hasOwnProperty.call(row, key)) {
      value = row[key];
      break;
    }
  }
  if (key === RENDER_FLOOR_KEY && typeof value === "number") {
    const floor = store.floor[ctx.packId];
    if (typeof floor === "number") return Math.max(value, floor);
  }
  return value;
}

export type SetAtResult =
  | { ok: true; store: ScopeStore; writtenLevel: WriteLevel }
  | { ok: false; reason: "global-only"; store: ScopeStore };

/**
 * Write `key` at `level`. A tile write on a shared duplicate lands on the view,
 * so every `!n` of that view sees it. A separated tile writes only its own bag.
 */
export function setAt(
  store: ScopeStore,
  level: WriteLevel,
  key: string,
  value: ScopeValue,
  ctx: ScopeCtx,
): SetAtResult {
  if (level !== "global" && isGlobalOnlyKey(key)) {
    return { ok: false, reason: "global-only", store };
  }
  let writeLevel = level;
  let writeCtx = ctx;
  if (level === "tile" && !store.separated.includes(ctx.tileId)) {
    writeLevel = "view";
    writeCtx = { ...ctx, viewId: sharedViewId(ctx.tileId) };
  }
  const slot = bag(store, writeLevel, writeCtx);
  const next = { ...slot.bag, [key]: value };
  return { ok: true, writtenLevel: writeLevel, store: writeBag(store, writeLevel, slot.id, next) };
}

/** Delete the override. The next resolve returns whatever sits behind it. */
export function resetAt(store: ScopeStore, level: WriteLevel, key: string, ctx: ScopeCtx): ScopeStore {
  let writeLevel = level;
  let writeCtx = ctx;
  if (level === "tile" && !store.separated.includes(ctx.tileId)) {
    writeLevel = "view";
    writeCtx = { ...ctx, viewId: sharedViewId(ctx.tileId) };
  }
  const slot = bag(store, writeLevel, writeCtx);
  if (!Object.prototype.hasOwnProperty.call(slot.bag, key)) return store;
  const next = { ...slot.bag };
  delete next[key];
  return writeBag(store, writeLevel, slot.id, next);
}

export function separateTile(store: ScopeStore, tileId: string): ScopeStore {
  if (store.separated.includes(tileId)) return store;
  return { ...store, separated: [...store.separated, tileId] };
}

/** Drop a separated tile's own bag so it shares the view again. */
export function shareTile(store: ScopeStore, tileId: string): { store: ScopeStore; dropped: string[] } {
  const dropped = Object.keys(store.tile[tileId] ?? {});
  const tile = { ...store.tile };
  delete tile[tileId];
  return {
    dropped,
    store: { ...store, tile, separated: store.separated.filter((id) => id !== tileId) },
  };
}

export function writeSession(store: ScopeStore, key: string, value: ScopeValue): ScopeStore {
  return { ...store, session: { ...store.session, [key]: value } };
}

export function clearSession(store: ScopeStore): ScopeStore {
  return { ...store, session: {} };
}

export type FieldOrigin = {
  level: "session" | ScopeLevel;
  value: ScopeValue;
};

/** Which bag actually supplied `key`. Session wins, then the usual chain. */
export function fieldOrigin(store: ScopeStore, key: string, ctx: ScopeCtx): FieldOrigin | null {
  const separated = store.separated.includes(ctx.tileId);
  const chain: { level: FieldOrigin["level"]; bag?: ScopeBag }[] = [
    { level: "session", bag: store.session },
    { level: "tile", bag: separated ? readBag(store.tile, ctx.tileId) : undefined },
    { level: "wall", bag: readBag(store.wall, ctx.wallId) },
    { level: "view", bag: readBag(store.view, ctx.viewId) },
    { level: "pack", bag: readBag(store.pack, ctx.packId) },
    { level: "manifest", bag: readBag(store.manifest, ctx.packId) },
    { level: "global", bag: store.global },
    { level: "builtin", bag: store.builtin },
  ];
  for (const row of chain) {
    if (row.bag && Object.prototype.hasOwnProperty.call(row.bag, key)) {
      return { level: row.level, value: row.bag[key] as ScopeValue };
    }
  }
  return null;
}

export type OverrideHit = { level: "view" | "wall" | "tile"; id: string };

export function overridesOf(store: ScopeStore, key: string): OverrideHit[] {
  const hits: OverrideHit[] = [];
  for (const level of ["view", "wall", "tile"] as const) {
    const map = store[level];
    for (const [id, row] of Object.entries(map)) {
      if (Object.prototype.hasOwnProperty.call(row, key)) hits.push({ level, id });
    }
  }
  return hits;
}

export type ClearedOverride = { level: "view" | "wall" | "tile"; id: string; key: string };

/** The view, wall, and tile overrides of `key` that Apply to all would drop. */
export function applyToAll(store: ScopeStore, key: string): {
  store: ScopeStore;
  cleared: ClearedOverride[];
  counts: { view: number; wall: number; tile: number };
} {
  const cleared: ClearedOverride[] = [];
  const drop = (level: "view" | "wall" | "tile", map: Record<string, ScopeBag>): Record<string, ScopeBag> => {
    const next: Record<string, ScopeBag> = {};
    for (const [id, row] of Object.entries(map)) {
      if (!Object.prototype.hasOwnProperty.call(row, key)) {
        next[id] = row;
        continue;
      }
      cleared.push({ level, id, key });
      const rest = { ...row };
      delete rest[key];
      next[id] = rest;
    }
    return next;
  };
  const view = drop("view", store.view);
  const wall = drop("wall", store.wall);
  const tile = drop("tile", store.tile);
  const counts = {
    view: cleared.filter((c) => c.level === "view").length,
    wall: cleared.filter((c) => c.level === "wall").length,
    tile: cleared.filter((c) => c.level === "tile").length,
  };
  return { store: { ...store, view, wall, tile }, cleared, counts };
}
