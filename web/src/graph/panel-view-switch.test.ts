import { afterEach, describe, expect, it } from "vitest";
import { RenderHost } from "./render-host";
import { Mosaic } from "./mosaic";
import { NetScene, DEFAULT_DREAM } from "./scene";
import { themeById } from "../core/themes";
import {
  panelPackCount,
  panelRafCount,
  releasePanelView,
  resetPanelViewLifecycle,
  syncPanelPackSub,
} from "./panel-view-lifecycle";

describe("mosaic panel view switch teardown", () => {
  afterEach(() => {
    resetPanelViewLifecycle();
  });

  it("emits no securitypolicyviolation during 20 back-and-forth pane view swaps", () => {
    const violations: Event[] = [];
    const onViolation = (e: Event) => violations.push(e);
    document.addEventListener("securitypolicyviolation", onViolation);
    const contextLost: Event[] = [];
    const onContextLost = (e: Event) => contextLost.push(e);
    document.addEventListener("webglcontextlost", onContextLost);
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(wall, "clientHeight", { value: 600, configurable: true });
    const sceneEl = document.createElement("div");
    Object.defineProperty(sceneEl, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(sceneEl, "clientHeight", { value: 300, configurable: true });
    const host = new RenderHost(wall, { software: true });
    const main = new NetScene(sceneEl, { host });
    main.retargetPanel("plugin:topology");
    const mosaic = new Mosaic({
      wall,
      sceneEl,
      main,
      host,
      arcade: {},
      optsFor: () => ({}),
      onFocus: () => {},
      onPromote: () => {},
      onLayout: () => {},
      onCloseLast: () => {},
      sync: () => ({
        theme: themeById("midnight"),
        filters: {},
        anim: DEFAULT_DREAM,
        dreaming: false,
        nodeFilter: () => true,
        lastMsg: null,
        aliasMap: new Map(),
      }),
    });
    mosaic.setSize("4", "plugin:topology", "off", {
      tiles: ["plugin:topology", "plugin:wifi"],
    });
    let active = "plugin:topology";
    let other = "plugin:talkers";
    for (let i = 0; i < 20; i++) {
      mosaic.setPaneView(active, other);
      [active, other] = [other, active];
    }
    for (const id of mosaic.tileIds) {
      expect(panelRafCount(id), `rAF lease for ${id}`).toBe(1);
    }
    expect(host.viewCount).toBeLessThanOrEqual(mosaic.tileIds.length);
    document.removeEventListener("securitypolicyviolation", onViolation);
    document.removeEventListener("webglcontextlost", onContextLost);
    expect(violations).toHaveLength(0);
    expect(contextLost).toHaveLength(0);
    host.dispose();
    main.dispose();
    wall.remove();
  });

  it("keeps one rAF lease on the active tile after 20 back-and-forth view swaps", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(wall, "clientHeight", { value: 600, configurable: true });
    const sceneEl = document.createElement("div");
    Object.defineProperty(sceneEl, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(sceneEl, "clientHeight", { value: 300, configurable: true });
    const host = new RenderHost(wall, { software: true });
    const main = new NetScene(sceneEl, { host });
    main.retargetPanel("plugin:topology");
    const mosaic = new Mosaic({
      wall,
      sceneEl,
      main,
      host,
      arcade: {},
      optsFor: () => ({}),
      onFocus: () => {},
      onPromote: () => {},
      onLayout: () => {},
      onCloseLast: () => {},
      sync: () => ({
        theme: themeById("midnight"),
        filters: {},
        anim: DEFAULT_DREAM,
        dreaming: false,
        nodeFilter: () => true,
        lastMsg: null,
        aliasMap: new Map(),
      }),
    });
    mosaic.setSize("4", "plugin:topology", "off", {
      tiles: ["plugin:topology", "plugin:wifi"],
    });
    let active = "plugin:topology";
    let other = "plugin:talkers";
    for (let i = 0; i < 20; i++) {
      expect(mosaic.setPaneView(active, other)).toBe(true);
      syncPanelPackSub(other, true);
      for (const id of [active, other]) {
        expect(panelRafCount(id), `raf leak on ${id} after switch to ${other}`).toBe(id === other ? 1 : 0);
        expect(panelPackCount(id), `pack leak on ${id}`).toBe(id === other ? 1 : 0);
      }
      releasePanelView(active);
      syncPanelPackSub(active, false);
      [active, other] = [other, active];
    }
    expect(host.viewCount).toBeLessThanOrEqual(2);
    host.dispose();
    main.dispose();
    wall.remove();
  });
});

describe("syncPanelPackSub", () => {
  afterEach(() => resetPanelViewLifecycle());

  it("replaces the pack lease instead of stacking on the same panel", () => {
    syncPanelPackSub("plugin:a", true);
    expect(panelPackCount("plugin:a")).toBe(1);
    syncPanelPackSub("plugin:a", true);
    expect(panelPackCount("plugin:a")).toBe(1);
    syncPanelPackSub("plugin:a", false);
    expect(panelPackCount("plugin:a")).toBe(0);
  });
});
