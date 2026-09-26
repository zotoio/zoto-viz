import { describe, expect, it } from "vitest";
import { TileHealthMonitor, writeTileHealErrors } from "./tile-health-monitor";
import { freshTileHealthState } from "./tile-health";
import type { NetScene } from "../graph/scene";
import type { RenderHost } from "../graph/render-host";

function mockScene(serial = 0, lost = false): NetScene {
  return {
    viewEl: document.createElement("div"),
    pictureSerial: serial,
    gpuContextLost: lost,
    lastViewport: { x: 0, y: 0, w: 200, h: 120 },
  } as NetScene;
}

describe("TileHealthMonitor messages", () => {
  it("hides heal text when the setting is off and shows it when on", () => {
    writeTileHealErrors(false);
    const host = {
      software: true,
      canvas: document.createElement("canvas"),
      pixelRatio: 1,
      gl: null,
    } as RenderHost;
    const scene = mockScene(1);
    const heals: string[] = [];
    const mon = new TileHealthMonitor({
      host,
      mainScene: scene,
      mosaic: null,
      paneEl: () => scene.viewEl,
      sceneFor: () => scene,
      packFor: () => null,
      mayBeStatic: () => false,
      isVisible: () => true,
      showErrors: () => localStorage.getItem("zoto-viz.tileHealErrors") === "1",
      onHeal: (id, step) => { heals.push(`${id}:${step}`); },
    });
    mon.noteVizFrameDelivered();
    const state = freshTileHealthState();
    state.lastMessage = "Tile blank for 6 s, restarted pack";
    (mon as unknown as { states: Map<string, unknown> }).states.set("main", state);
    (mon as unknown as { paintLabel: (id: string, s: unknown) => void }).paintLabel("main", state);
    const label = scene.viewEl.querySelector(".tile-heal-msg") as HTMLElement;
    expect(label.hidden).toBe(true);
    writeTileHealErrors(true);
    (mon as unknown as { paintLabel: (id: string, s: unknown) => void }).paintLabel("main", state);
    expect(label.hidden).toBe(false);
    expect(label.textContent).toContain("restarted pack");
    writeTileHealErrors(false);
  });
});
