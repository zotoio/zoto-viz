import { describe, expect, it } from "vitest";
import { inspectPaneStartup, nextGraphTile, nextHostSky, paneRecovery, type PaneStartupSnap } from "./pane-health";

function snap(over: Partial<PaneStartupSnap> = {}): PaneStartupSnap {
  return {
    id: "plugin:talkers",
    kind: "graph",
    bound: true,
    stageOnly: false,
    backdrop: "aurora",
    pluginSkyId: null,
    pluginSkyWanted: false,
    nodes: 4,
    hasSnapshot: true,
    ...over,
  };
}

describe("inspectPaneStartup", () => {
  it("passes a bound graph with a host sky and nodes", () => {
    expect(inspectPaneStartup(snap())).toBeNull();
  });

  it("flags chrome-only and unbound arcade tiles", () => {
    expect(inspectPaneStartup(snap({ bound: false }))).toBe("unbound");
    expect(inspectPaneStartup(snap({ kind: "empty", bound: false }))).toBe("unbound");
  });

  it("waits while a plugin sky is still compiling", () => {
    expect(inspectPaneStartup(snap({
      pluginSkyWanted: true, backdrop: "plugin", skyPending: true,
    }))).toBeNull();
  });

  it("flags a plugin backdrop that never bound a shader", () => {
    expect(inspectPaneStartup(snap({
      pluginSkyWanted: true, backdrop: "plugin", pluginSkyId: null,
    }))).toBe("no-sky");
    expect(inspectPaneStartup(snap({
      backdrop: "plugin", pluginSkyWanted: false, pluginSkyId: null,
    }))).toBe("no-sky");
  });

  it("accepts a landed plugin sky", () => {
    expect(inspectPaneStartup(snap({
      pluginSkyWanted: true, backdrop: "plugin", pluginSkyId: "hn-rain",
    }))).toBeNull();
  });

  it("flags a graph that ingested a snapshot with no nodes", () => {
    expect(inspectPaneStartup(snap({ nodes: 0, hasSnapshot: true }))).toBe("no-data");
    expect(inspectPaneStartup(snap({ nodes: 0, hasSnapshot: false }))).toBeNull();
    expect(inspectPaneStartup(snap({ nodes: 0, hasSnapshot: true, stageOnly: true }))).toBeNull();
  });
});

describe("paneRecovery", () => {
  it("rematches an unbound tile and falls back sky on a missing shader", () => {
    expect(paneRecovery("unbound")).toEqual({ rematch: true, hostSky: false, flush: false });
    expect(paneRecovery("no-sky")).toEqual({ rematch: false, hostSky: true, flush: false });
    expect(paneRecovery("no-data")).toEqual({ rematch: false, hostSky: true, flush: true });
  });
});

describe("nextGraphTile / nextHostSky", () => {
  it("picks the next unused graph id", () => {
    expect(nextGraphTile(
      ["plugin:talkers"],
      ["plugin:talkers", "plugin:memory", "plugin:pacman"],
      (id) => id !== "plugin:pacman",
    )).toBe("plugin:memory");
    expect(nextGraphTile(["a", "b"], ["a", "b"], () => true)).toBeNull();
  });

  it("picks an unused host sky and skips plugin/none", () => {
    expect(nextHostSky(["aurora"], ["plugin", "aurora", "space", "fire"], "aurora")).toBe("space");
    expect(nextHostSky(["aurora", "space", "fire"], ["aurora", "space", "fire"], "aurora")).toBe("space");
  });
});
