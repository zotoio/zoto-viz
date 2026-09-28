import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetVizClockInjectors, setVizClockInjector } from "../core/viz-clock";
import { monoMs } from "../core/viz-time";
import { fatLanFixture } from "../plugins/fixtures/fat-lan-state";
import { handleSandboxHostMessage, type SandboxZoto } from "../plugins/sandbox-frame";
import {
  VizBufferWriter,
  VizFrameBudget,
  defaultVizContract,
} from "../plugins/viz-host";
import { syncVizTileScope } from "../plugins/viz-tile-budget";
import { mainVizBuildFrame, mainVizDeliver } from "./viz-main-deliver";
import { deliverVizPluginFrame } from "./viz-frame-tick";
import { setVoxConfig, tickVoxelWorld } from "../../../plugins/src/voxel-world/frontend/engine";
import { VOX_SLOT } from "../../../plugins/src/voxel-world/frontend/slots";

const VOXEL_FLY_CFG = {
  preset: "classic",
  camera: "fly",
  cameraSpeed: "1",
  reducedMotion: "0",
};

/** Revert row: viz deliver only inside websocket feed() — sandbox camera UBO freezes between state ticks. */
export const VOXEL_CAMERA_FEED_ONLY_DELIVER_BUG = "deliverVizPluginFrame({";

describe("voxel world camera via host viz loop", () => {
  beforeEach(() => {
    setVoxConfig(VOXEL_FLY_CFG);
  });

  afterEach(() => {
    resetVizClockInjectors();
    vi.restoreAllMocks();
  });

  it("advances camX and camZ over 90 mainVizDeliver frames (present cadence)", () => {
    const contract = defaultVizContract({ maxBuffers: 2, maxBufferFloats: 64 });
    const writer = new VizBufferWriter(contract);
    const caps = new Set(["viz.read", "viz.write", "config.read"]);
    const api: SandboxZoto = {
      onTick: null,
      onConfig: (cfg) => setVoxConfig(cfg),
      onFrame: (frame) => {
        const out = tickVoxelWorld(
          {
            t: frame.t,
            demo: frame.demo,
            packets: frame.packets,
            talkers: frame.talkers,
            headlines: frame.headlines,
            sys: frame.sys,
          },
          1.6,
          frame.dt > 0 ? frame.dt : 1 / 60,
        );
        writer.writeBuffer(0, out.slot0);
        writer.writeBuffer(1, out.slot1);
      },
      onPresent: null,
      setStyle: () => {},
      setNodeColor: () => {},
      writeBuffer: (slot, data) => { writer.writeBuffer(slot, data); },
      writeUniform: () => {},
      writeParticles: () => {},
      getConfig: () => VOXEL_FLY_CFG,
    };
    handleSandboxHostMessage(
      { source: "zoto-viz-host", type: "config", config: VOXEL_FLY_CFG },
      caps,
      api,
    );

    const sandbox = {
      frame: (frame: unknown) => {
        handleSandboxHostMessage(
          { source: "zoto-viz-host", type: "frame", frame },
          caps,
          api,
        );
      },
      handlers: {
        writeBuffer: (slot: number, data: number[]) => { writer.writeBuffer(slot, data); },
        writeUniform: () => {},
        writeParticles: () => {},
      },
    };

    const clocks = Array.from({ length: 91 }, (_, i) => i * 16);
    let buildIdx = 0;
    setVizClockInjector(() => clocks[buildIdx] ?? clocks[clocks.length - 1]!);
    syncVizTileScope(["main"]);
    const budget = new VizFrameBudget(() => clocks[buildIdx] ?? clocks[clocks.length - 1]!, "main");
    const state = fatLanFixture();
    let prevClockMs = monoMs(0);
    const camX: number[] = [];
    const camZ: number[] = [];

    for (let i = 0; i < 90; i++) {
      buildIdx = i + 1;
      const { nextClockMs } = mainVizDeliver({
        budget,
        prevClockMs,
        state,
        audio: 0,
        buildFrame: (s, pt, a) => mainVizBuildFrame(s, pt, a, { fixture: "host" }),
        onFrame: (f) => {
          deliverVizPluginFrame({
            frame: f,
            sandbox,
            mosaic: null,
            mosaicDemoPacks: false,
            packId: null,
            activeMode: { id: "plugin:voxel-world", pluginId: "voxel-world" } as never,
            modeById: () => ({ id: "plugin:voxel-world", pluginId: "voxel-world" }) as never,
            mosaicTileViewId: (s) => s,
            pluginSpecForMode: () => null,
            optsFor: () => ({}),
            budgetStats: budget.stats,
          });
        },
      });
      prevClockMs = nextClockMs;
      camX.push(writer.ubo[VOX_SLOT.camX]!);
      camZ.push(writer.ubo[VOX_SLOT.camZ]!);
    }

    expect(camX[89]! - camX[0]!).not.toBeCloseTo(0, 1);
    expect(camZ[89]! - camZ[0]!).not.toBeCloseTo(0, 1);
  });

  it("revert row: present deliver wired outside websocket feed()", () => {
    const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "main.ts"), "utf8");
    expect(main).toContain("tickVizPresentDeliver(shown, vizPresentHost)");
    expect(main).toContain("get pluginSpecs() { return pluginSpecs; }");
    expect(main).not.toMatch(/function feed\([\s\S]*deliverVizPluginFrame\(/);
  });
});
