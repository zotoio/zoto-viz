import { describe, expect, it } from "vitest";
import { Mosaic } from "./mosaic";

describe("mosaic pane notice", () => {
  it("shows and clears inline copy on a tile", () => {
    const wall = document.createElement("div");
    const mosaic = new Mosaic({
      wall,
      sceneEl: document.createElement("div"),
      main: { currentMode: { id: "plugin:topology" }, setCompactLabels: () => {}, relayout: () => {}, setMode: () => {} } as never,
      arcade: {},
      optsFor: () => ({}),
      onFocus: () => {},
      onPromote: () => {},
      onLayout: () => {},
      onCloseLast: () => {},
      sync: () => ({
        theme: { id: "midnight" } as never,
        filters: {},
        anim: {} as never,
        dreaming: false,
        nodeFilter: () => true,
        lastMsg: null,
        aliasMap: new Map(),
      }),
    });
    const pane = document.createElement("div");
    pane.className = "mosaic-pane";
    wall.appendChild(pane);
    (mosaic as unknown as { panes: Map<string, HTMLElement> }).panes.set("plugin:topology", pane);
    mosaic.setPaneNotice("plugin:topology", "needs review");
    const notice = pane.querySelector(".mosaic-pane-notice");
    expect(Boolean(notice)).toBe(true);
    expect(notice?.textContent === "needs review").toBe(true);
    mosaic.setPaneNotice("plugin:topology", "Blob Mesh couldn't start, its sandbox didn't respond", "fail");
    const failEl = pane.querySelector(".mosaic-pane-notice-fail");
    expect(failEl).not.toBeNull();
    expect(failEl?.textContent === "Blob Mesh couldn't start, its sandbox didn't respond").toBe(true);
    mosaic.setPaneNotice("plugin:topology", null);
    expect(pane.querySelector(".mosaic-pane-notice")).toBeNull();
  });
});
