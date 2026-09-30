/**
 * #216: a pack tile still drawing nothing after the one tile-heal resend-frame (frames delivered,
 * the pack never writes, the picture is not uniform: theme background plus pitch grid) shows the
 * existing "Rocket Car Soccer couldn't start." with Retry and stays on the pack. The ladder never
 * goes on to restart-pack / recreate-context / demo-snapshot / fallback-pack (Topology).
 */
import { describe, expect, it } from "vitest";
import { TileHealthMonitor, type TileHealthDeps } from "./tile-health-monitor";
import { TILE_HEAL_FALLBACK_MODE, TILE_HEALTH_PATCHES, TILE_PATCH, type TilePatchBytes } from "./tile-health";
import type { NetScene } from "../graph/scene";
import type { RenderHost } from "../graph/render-host";
import { viewMutAsDeviceRect } from "../graph/pack-mirror-rect";
import { mockPartial } from "../../test-support/mock-partial";
import type { PluginView } from "./plugin";

/** Theme background with pitch-grid lines: not uniform, so the verdict is drawing-nothing. */
function gridPatch(): TilePatchBytes {
  const b = new Uint8Array(TILE_PATCH * TILE_PATCH * 4 * TILE_HEALTH_PATCHES);
  for (let i = 0; i < b.length; i += 4) {
    const v = (i / 4) % 8 === 0 ? 120 : 30;
    b[i] = v; b[i + 1] = v; b[i + 2] = v + 40; b[i + 3] = 255;
  }
  return b;
}

describe("#216: drawing nothing after resend-frame shows couldn't-start and stays on the pack", () => {
  it("Rocket Car Soccer on main: one resend-frame, then couldn't-start once; no restart-pack, no fallback to Topology", () => {
    const scene = mockPartial<NetScene>({
      viewEl: document.createElement("div"),
      pictureSerial: 1,
      gpuContextLost: false,
      lastViewport: viewMutAsDeviceRect({ x: 0, y: 0, w: 200, h: 120 }),
    });
    const rcs: PluginView = {
      id: "rocket-car-soccer",
      name: "Rocket Car Soccer",
      version: 1,
      runtime: "typescript",
      capabilities: ["viz.read", "viz.write"],
    };
    let mode = "plugin:rocket-car-soccer";
    const heals: string[] = [];
    const cantStart: string[] = [];
    const deps: TileHealthDeps = {
      host: mockPartial<RenderHost>({ software: true, canvas: document.createElement("canvas"), pixelRatio: 1, gl: null }),
      mainScene: scene,
      mosaic: null,
      paneEl: () => scene.viewEl,
      sceneFor: () => scene,
      packFor: () => rcs,
      mayBeStatic: () => false,
      awaitingApproval: () => false,
      isVisible: () => true,
      showErrors: () => false,
      tabVisible: () => true,
      onScreen: () => true,
      // main.ts healTile: fallback-pack is applyMode(TILE_HEAL_FALLBACK_MODE).
      onHeal: (id, step) => {
        heals.push(`${id}:${step}`);
        if (step === "fallback-pack") mode = TILE_HEAL_FALLBACK_MODE;
      },
      // main.ts: a pack tile shows its couldn't-start; the tile then reads couldnt-start.
      onCantStart: (id, packId) => { cantStart.push(`${id}:${packId}`); return true; },
      couldntStart: () => cantStart.length > 0,
      packLive: () => false,
    };
    const mon = new TileHealthMonitor(deps);
    Object.defineProperty(mon, "sampleScene", { value: () => gridPatch() });

    for (let t = 0; t < 180_000; t += 700) {
      mon.noteVizFrameDelivered(); // frames keep arriving; the pack never writes
      mon.tick(t);
    }
    mon.dispose();

    expect(heals.filter((h) => h === "main:resend-frame").length, "one resend-frame").toBe(1);
    expect(heals.filter((h) => h !== "main:resend-frame"), "no later heal step").toEqual([]);
    expect(cantStart, "the existing couldn't-start, once, on the pack").toEqual(["main:rocket-car-soccer"]);
    expect(mode, "no applyMode / fallback: the view stays on the pack").toBe("plugin:rocket-car-soccer");
  });
});
