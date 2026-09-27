import { beforeEach, describe, expect, it } from "vitest";
import { RenderHost } from "./render-host";
import { Mosaic } from "./mosaic";
import { NetScene, DEFAULT_DREAM } from "./scene";
import { themeById } from "../core/themes";
import { syncPanelPackSub } from "./panel-view-lifecycle";

describe("mosaic panel view switch teardown", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("emits no securitypolicyviolation during 20 back-and-forth pane view swaps", () => {
    const violations: Event[] = [];
    const onViolation = (e: Event) => violations.push(e);
    document.addEventListener("securitypolicyviolation", onViolation);
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(wall, "clientHeight", { value: 600, configurable: true });
    const sceneEl = document.createElement("div");
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
    mosaic.setSize("2", "plugin:topology", "off", {
      tiles: ["plugin:topology", "plugin:wifi"],
    });
    let active = "plugin:topology";
    let other = "plugin:talkers";
    for (let i = 0; i < 20; i++) {
      expect(mosaic.setPaneView(active, other)).toBe(true);
      syncPanelPackSub(other, true);
      syncPanelPackSub(active, false);
      [active, other] = [other, active];
    }
    document.removeEventListener("securitypolicyviolation", onViolation);
    expect(violations).toHaveLength(0);
    expect(host.viewCount).toBeLessThanOrEqual(2);
    host.dispose();
    main.dispose();
  });
});
