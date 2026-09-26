import { describe, expect, it } from "vitest";
import { RenderHost } from "./render-host";

describe("RenderHost pack mirror scope", () => {
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
});
