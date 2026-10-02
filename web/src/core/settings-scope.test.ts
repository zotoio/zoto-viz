/**
 * #259: the scope resolver is pure. Nothing in the app reads it yet.
 * Precedence: tile, wall, view, user pack, manifest, global, built-in.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyToAll,
  emptyScopeStore,
  resolve,
  resetAt,
  separateTile,
  setAt,
  type ScopeCtx,
  type ScopeStore,
  type WriteLevel,
} from "./settings-scope";

const ctx: ScopeCtx = {
  packId: "koi-pond",
  viewId: "plugin:koi-pond",
  wallId: "wall-a",
  tileId: "plugin:koi-pond!1",
};

const LEVELS: { level: WriteLevel | "manifest" | "builtin"; value: string }[] = [
  { level: "builtin", value: "built" },
  { level: "global", value: "glob" },
  { level: "manifest", value: "pin" },
  { level: "pack", value: "user-pack" },
  { level: "view", value: "view" },
  { level: "wall", value: "wall" },
  { level: "tile", value: "tile" },
];

function put(store: ScopeStore, level: (typeof LEVELS)[number]["level"], value: string): ScopeStore {
  if (level === "builtin") return { ...store, builtin: { ...store.builtin, theme: value } };
  if (level === "manifest") {
    return { ...store, manifest: { ...store.manifest, [ctx.packId]: { theme: value } } };
  }
  const wrote = setAt(store, level, "theme", value, ctx);
  if (!wrote.ok) throw new Error(wrote.reason);
  return wrote.store;
}

describe("#259 settings scope resolver", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("(1) a closer level wins, one key at a time", () => {
    let store = emptyScopeStore();
    store = separateTile(store, ctx.tileId);
    for (const step of LEVELS) {
      store = put(store, step.level, step.value);
      expect(resolve(store, "theme", ctx)).toBe(step.value);
    }
    expect(resolve(store, "theme", ctx)).toBe("tile");
  });

  it("(2) a user pack or view override beats a manifest look pin", () => {
    let store = emptyScopeStore();
    store = { ...store, manifest: { [ctx.packId]: { theme: "pinned" } } };
    expect(resolve(store, "theme", ctx)).toBe("pinned");
    const pack = setAt(store, "pack", "theme", "mine", ctx);
    if (!pack.ok) throw new Error("pack");
    expect(resolve(pack.store, "theme", ctx)).toBe("mine");
    const view = setAt(pack.store, "view", "theme", "local", ctx);
    if (!view.ok) throw new Error("view");
    expect(resolve(view.store, "theme", ctx)).toBe("local");
  });

  it("(3) the floor clamp beats a lower tile override", () => {
    let store = separateTile(emptyScopeStore(), ctx.tileId);
    store = { ...store, floor: { [ctx.packId]: 0.35 }, manifest: { [ctx.packId]: { "render.scale.min": 0.35 } } };
    const wrote = setAt(store, "tile", "render.scale.min", 0.1, ctx);
    if (!wrote.ok) throw new Error("tile");
    expect(resolve(wrote.store, "render.scale.min", ctx)).toBe(0.35);
  });

  it("(4) resetAt deletes, and resolve returns the inherited value", () => {
    let store = emptyScopeStore();
    store = { ...store, builtin: { theme: "built" } };
    const view = setAt(store, "view", "theme", "local", ctx);
    if (!view.ok) throw new Error("view");
    expect(resolve(view.store, "theme", ctx)).toBe("local");
    const cleared = resetAt(view.store, "view", "theme", ctx);
    expect(cleared.view[ctx.viewId]?.theme).toBeUndefined();
    expect(resolve(cleared, "theme", ctx)).toBe("built");
  });

  it("(5) applyToAll reports the overrides it clears", () => {
    let store = separateTile(emptyScopeStore(), ctx.tileId);
    for (const level of ["view", "wall", "tile"] as const) {
      const wrote = setAt(store, level, "theme", level, ctx);
      if (!wrote.ok) throw new Error(level);
      store = wrote.store;
    }
    const other = setAt(store, "view", "bright", 2, { ...ctx, viewId: "plugin:other" });
    if (!other.ok) throw new Error("other");
    const out = applyToAll(other.store, "theme");
    expect(out.counts).toEqual({ view: 1, wall: 1, tile: 1 });
    expect(out.cleared).toEqual([
      { level: "view", id: ctx.viewId, key: "theme" },
      { level: "wall", id: ctx.wallId, key: "theme" },
      { level: "tile", id: ctx.tileId, key: "theme" },
    ]);
    expect(out.store.view["plugin:other"]?.bright).toBe(2);
    expect(resolve(out.store, "theme", ctx)).toBeUndefined();
  });

  it("(6) a global-only key refuses setAt below Global", () => {
    const store = emptyScopeStore();
    for (const level of ["tile", "wall", "view", "pack"] as const) {
      const wrote = setAt(store, level, "privacy", true, ctx);
      expect(wrote.ok).toBe(false);
      if (!wrote.ok) expect(wrote.reason).toBe("global-only");
      expect(wrote.store).toBe(store);
    }
    const global = setAt(store, "global", "privacy", true, ctx);
    expect(global.ok).toBe(true);
    if (global.ok) expect(resolve(global.store, "privacy", ctx)).toBe(true);
  });

  it("(7) !1 and !2 share until !2 is separated", () => {
    const a: ScopeCtx = { ...ctx, tileId: "plugin:koi-pond!1" };
    const b: ScopeCtx = { ...ctx, tileId: "plugin:koi-pond!2" };
    const shared = setAt(emptyScopeStore(), "tile", "theme", "shared", a);
    if (!shared.ok) throw new Error("shared");
    expect(shared.writtenLevel).toBe("view");
    expect(resolve(shared.store, "theme", a)).toBe("shared");
    expect(resolve(shared.store, "theme", b)).toBe("shared");
    const split = separateTile(shared.store, b.tileId);
    const own = setAt(split, "tile", "theme", "only-2", b);
    if (!own.ok) throw new Error("own");
    expect(own.writtenLevel).toBe("tile");
    expect(resolve(own.store, "theme", a)).toBe("shared");
    expect(resolve(own.store, "theme", b)).toBe("only-2");
  });
});
