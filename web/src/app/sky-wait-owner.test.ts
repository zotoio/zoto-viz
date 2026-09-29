import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKY_WAIT_DEADLINE_MS, SkyLoads, SkyWaits } from "./sky-wait";
import { skyStartingShown } from "../graph/sky-starting-card";

/** 2x2: a superseded sync's abort must not touch the card or deadline the newest sync armed. */
function mosaic() {
  const panes = new Map(["a", "b", "c", "d"].map((k) => [k, document.createElement("div")]));
  const waits = new SkyWaits({
    hostEl: (k) => panes.get(k) ?? null,
    name: () => "Backrooms",
    skyReady: () => false,
    retry: () => {},
  });
  return { panes, waits };
}

describe("only the newest load's abort ends a tile's wait", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "info").mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("sync A aborted, sync B begins, A's cleanup runs late: B's cards stay and its deadline arms", () => {
    const { panes, waits } = mosaic();
    const a = new AbortController();
    for (const k of panes.keys()) waits.begin(k, a.signal);
    a.abort(); // mode re-apply supersedes A
    const b = new AbortController();
    for (const k of panes.keys()) waits.begin(k, b.signal);
    // A's shared fetch resolves ~0.9s later; its catch/finally tries to end the waits.
    vi.advanceTimersByTime(900);
    for (const k of panes.keys()) waits.cancelOwned(k, a.signal);
    for (const [k, el] of panes) {
      expect(waits.state(k)).toBe("starting");
      expect(skyStartingShown(el)).toBe(true);
    }
    vi.advanceTimersByTime(SKY_WAIT_DEADLINE_MS);
    for (const k of panes.keys()) expect(waits.state(k)).toBe("failed:timeout");
  });

  it("the newest sync's own abort still ends its waits", () => {
    const { panes, waits } = mosaic();
    const b = new AbortController();
    for (const k of panes.keys()) waits.begin(k, b.signal);
    b.abort();
    for (const k of panes.keys()) waits.cancelOwned(k, b.signal);
    expect(waits.keys()).toEqual([]);
  });

  it("a joining sync takes the wait over: the first caller's abort no longer ends it", () => {
    const { waits } = mosaic();
    const a = new AbortController();
    const b = new AbortController();
    waits.begin("a", a.signal);
    waits.own("a", b.signal);
    a.abort();
    waits.cancelOwned("a", a.signal);
    expect(waits.state("a")).toBe("starting");
  });

  it("SkyLoads: a sync that joins an in-flight load owns its signal; the older abort can't cancel it", async () => {
    const loads = new SkyLoads<object>();
    const tileKey = {};
    const a = new AbortController();
    const b = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let installs = 0;
    let starts = 0;
    const start = async (ctl: { current(): boolean; signal(): AbortSignal }) => {
      starts++;
      await gate;
      if (ctl.signal().aborted || !ctl.current()) return;
      installs++;
    };
    const pa = loads.share(tileKey, "backrooms:h", a.signal, start);
    const pb = loads.share(tileKey, "backrooms:h", b.signal, start);
    a.abort();
    release();
    await Promise.all([pa, pb]);
    expect(starts).toBe(1);
    expect(installs).toBe(1);
  });

  it("main wiring: sync cleanup and install failures end only their own waits", () => {
    const src = readFileSync(resolve(__dirname, "main.ts"), "utf8");
    const sync = src.slice(src.indexOf("async function syncPluginSky("), src.indexOf("function teardownMosaicPanelView("));
    expect(sync).toContain("skyWaits.cancelOwned(id, signal)");
    expect(sync).not.toMatch(/skyWaits\.cancel\(id\)/);
    const install = src.slice(src.indexOf("async function installPluginSky("), src.indexOf("const skyWaitTiles"));
    expect(install).toContain("skyWaits.cancelOwned(waitKey, owner)");
    expect(install).not.toMatch(/skyWaits\.cancel\(waitKey\)/);
    const load = src.slice(src.indexOf("async function loadPluginSkyOnto("), src.indexOf("const skyFetches"));
    expect(load).toContain("if (signal.aborted) return;");
    expect(load).toContain("skyWaits.own(waitKey, signal)");
  });
});
