/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it } from "vitest";
import { RenderHost } from "./render-host";

describe("RenderHost pack mirror scope", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("does not allocate pack RT when duplicate tile count stays below 2", () => {
    const wall = document.createElement("div");
    wall.style.width = "200px";
    wall.style.height = "120px";
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: true });
    const before = host.packMirrors.allocationCount;
    for (let i = 0; i < 30; i++) {
      host.packMirrors.syncScopes(new Map([["plugin:x", { tileCount: 1, antialias: false }]]));
    }
    expect(host.packMirrors.allocationCount).toBe(before);
    host.dispose();
    wall.remove();
  });

  it("allocates once when count crosses 2", () => {
    const wall = document.createElement("div");
    wall.style.width = "200px";
    wall.style.height = "120px";
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: true });
    const start = host.packMirrors.allocationCount;
    host.packMirrors.syncScopes(new Map([["plugin:x", { tileCount: 2, antialias: false }]]));
    expect(host.packMirrors.allocationCount).toBe(start + 1);
    for (let i = 0; i < 60; i++) {
      host.packMirrors.syncScopes(new Map([["plugin:x", { tileCount: 2, antialias: false }]]));
    }
    expect(host.packMirrors.allocationCount).toBe(start + 1);
    host.dispose();
    wall.remove();
  });

  it("one coalesce group key shares one PackMirror session across mirror tiles", () => {
    const wall = document.createElement("div");
    wall.style.width = "200px";
    wall.style.height = "120px";
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: true });
    const el0 = document.createElement("div");
    el0.id = "tile-a";
    const el1 = document.createElement("div");
    el1.id = "tile-b";
    const packKey = "plugin:demo";
    type PackView = Parameters<RenderHost["add"]>[0] & {
      packCoalesceGroupKey?: string;
      packCoalesceTileCount?: number;
      isPackMirrorPrimary?: boolean;
    };
    const mk = (el: HTMLElement, primary: boolean): PackView => ({
      viewEl: el,
      packCoalesceGroupKey: packKey,
      packCoalesceTileCount: 2,
      isPackMirrorPrimary: primary,
      hostFrame() {},
      hostContextLost() {},
      hostContextRestored() {},
    });
    host.add(mk(el0, true));
    host.add(mk(el1, false));
    host.markMirrorScopeDirty();
    (host as unknown as { syncMirrorScopesIfNeeded(): void }).syncMirrorScopesIfNeeded();
    expect(host.packMirrors.allocationCount).toBe(1);
    host.dispose();
    wall.remove();
  });
});
