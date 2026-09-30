import { describe, expect, it, vi } from "vitest";
import { TileHealthMonitor } from "./tile-health-monitor";
import { freshTileHealthState } from "./tile-health";
import type { NetScene } from "../graph/scene";
import type { RenderHost } from "../graph/render-host";
import { viewMutAsDeviceRect } from "../graph/pack-mirror-rect";
import { mockPartial } from "../../test-support/mock-partial";

describe("tile-health async readback", () => {
  it("does not advance empty streak when GL sample is pending", () => {
    const host = {
      software: false,
      canvas: document.createElement("canvas"),
      pixelRatio: 1,
      gl: { isContextLost: () => false } as WebGL2RenderingContext,
    } as RenderHost;
    const scene = mockPartial<NetScene>({
      viewEl: document.createElement("div"),
      pictureSerial: 0,
      gpuContextLost: false,
      lastViewport: viewMutAsDeviceRect({ x: 0, y: 0, w: 200, h: 120 }),
      tileHealthRgba: () => null,
    });
    const heals: string[] = [];
    const mon = new TileHealthMonitor({
      host,
      mainScene: scene,
      mosaic: null,
      paneEl: () => scene.viewEl,
      sceneFor: () => scene,
      packFor: () => null,
      mayBeStatic: () => false,
      awaitingApproval: () => false,
      isVisible: () => true,
      showErrors: () => false,
      onHeal: (_id, step) => { heals.push(step); },
    });
    const internal = mon as unknown as { states: Map<string, ReturnType<typeof freshTileHealthState>> };
    internal.states.set("main", freshTileHealthState());
    for (let i = 0; i < 5; i++) mon.tick(20_000 + i * 2500);
    expect(heals).toHaveLength(0);
    expect(mon.state("main").emptyStreak).toBe(0);
  });
});
