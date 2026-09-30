/**
 * (e) A saved layout that names a removed view: that pane shows one plain notice on the theme
 * background (no stand-in Topology, no blank pane). A hidden view in a layout still opens by id.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { flagMissingLayoutViews } from "./layout-missing-views";
import { resetViewStatesForTests, viewStateOf } from "./view-state";

function mountPanes(ids: string[]): Map<string, HTMLElement> {
  document.body.innerHTML = `<div id="scene">${ids.map((id) => `<div class="mosaic-pane" data-mode="${id}"></div>`).join("")}</div>`;
  return new Map(ids.map((id) => [id, document.querySelector<HTMLElement>(`.mosaic-pane[data-mode="${id}"]`)!]));
}

describe("saved layout with a hidden or removed view", () => {
  afterEach(() => { resetViewStatesForTests(); document.body.innerHTML = ""; });

  it("removed view: plain notice, no button, stage only; a hidden view (installed) opens by id with no notice", () => {
    const tiles = ["plugin:topology", "plugin:old-pack", "plugin:tile-health-black"];
    const panes = mountPanes(tiles);
    const known = new Set(["plugin:topology", "plugin:tile-health-black"]);
    const stage = new Map<string, boolean>();
    const missing = flagMissingLayoutViews({
      tileIds: tiles,
      isKnownView: (id) => known.has(id),
      paneScene: (id) => ({ setStageOnly: (on: boolean) => { stage.set(id, on); } }),
    });
    expect(missing).toEqual(["plugin:old-pack"]);
    const pane = panes.get("plugin:old-pack")!;
    const notice = pane.querySelector<HTMLElement>(".mosaic-pane-notice");
    expect(notice?.textContent).toBe("old-pack isn't installed. Pick another view for this tile.");
    expect(notice?.querySelector("button"), "Retry cannot help: no button").toBeNull();
    expect([pane.dataset.viewState, pane.dataset.viewId]).toEqual(["couldnt-start", "plugin:old-pack"]);
    expect(stage.get("plugin:old-pack"), "theme background, not a stand-in graph").toBe(true);
    expect(panes.get("plugin:tile-health-black")!.querySelector(".mosaic-pane-notice")).toBeNull();
    expect(viewStateOf("plugin:tile-health-black")).toBeNull();
    expect(stage.has("plugin:tile-health-black")).toBe(false);
  });

  it("the notice is painted once, and goes when the view is installed again", () => {
    const tiles = ["plugin:old-pack"];
    const panes = mountPanes(tiles);
    const known = new Set<string>();
    const host = { tileIds: tiles, isKnownView: (id: string) => known.has(id) };
    flagMissingLayoutViews(host);
    const first = panes.get("plugin:old-pack")!.querySelector(".mosaic-pane-notice");
    const spy = vi.fn();
    flagMissingLayoutViews({ ...host, paneScene: () => ({ setStageOnly: spy }) });
    expect(panes.get("plugin:old-pack")!.querySelector(".mosaic-pane-notice")).toBe(first);
    known.add("plugin:old-pack");
    flagMissingLayoutViews(host);
    expect(panes.get("plugin:old-pack")!.querySelector(".mosaic-pane-notice")).toBeNull();
    expect(viewStateOf("plugin:old-pack")).toBeNull();
  });
});
