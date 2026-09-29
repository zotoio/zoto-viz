import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const registered = new Set<string>();
const unregisterCalls: string[] = [];
let releaseUnregister: (() => void) | null = null;

vi.mock("../core/http", async (orig) => {
  const real = await orig<typeof import("../core/http")>();
  return {
    ...real,
    registerPackAssetFrame: vi.fn(async (id: string) => { registered.add(id); }),
    unregisterPackAssetFrame: vi.fn(async (id: string) => {
      unregisterCalls.push(id);
      if (releaseUnregister === null) {
        await new Promise<void>((r) => { releaseUnregister = r; });
      }
      registered.delete(id);
    }),
  };
});

import {
  closePackAssetFrameForTile,
  markSandboxOwnedFrame,
  openPackAssetFrame,
  packAssetFrameForTile,
  resetPackAssetFrameState,
} from "./pack-asset-frame";
import { releasePanelView } from "../graph/panel-view-lifecycle";

describe("pack-asset frame close is frame-specific", () => {
  beforeEach(() => {
    registered.clear();
    unregisterCalls.length = 0;
    releaseUnregister = null;
    resetPackAssetFrameState();
  });
  afterEach(() => resetPackAssetFrameState());

  it("frame A's delayed close does not unregister frame B opened on the same tile", async () => {
    const a = await openPackAssetFrame("main");
    const closingA = closePackAssetFrameForTile("main", a);
    const b = await openPackAssetFrame("main");
    releaseUnregister?.();
    await closingA;
    expect(unregisterCalls).toEqual([a]);
    expect(registered.has(b)).toBe(true);
    expect(packAssetFrameForTile("main")).toBe(b);
  });

  it("a stale close for A after B took the tile leaves B as the tile's frame", async () => {
    releaseUnregister = () => {};
    const a = await openPackAssetFrame("main");
    const b = await openPackAssetFrame("main");
    await closePackAssetFrameForTile("main", a);
    expect(unregisterCalls).toEqual([a]);
    expect(packAssetFrameForTile("main")).toBe(b);
    expect(registered.has(b)).toBe(true);
  });

  it("releasePanelView captures the frame now and skips a live sandbox's frame", async () => {
    releaseUnregister = () => {};
    const live = await openPackAssetFrame("main");
    markSandboxOwnedFrame(live, true);
    releasePanelView("main");
    await Promise.resolve();
    expect(unregisterCalls).toEqual([]);
    expect(packAssetFrameForTile("main")).toBe(live);
  });

  it("releasePanelView closes a non-sandbox frame, and only that one", async () => {
    releaseUnregister = () => {};
    const a = await openPackAssetFrame("pane-1");
    releasePanelView("pane-1");
    const b = await openPackAssetFrame("pane-1");
    await Promise.resolve();
    expect(unregisterCalls).toEqual([a]);
    expect(packAssetFrameForTile("pane-1")).toBe(b);
  });
});
