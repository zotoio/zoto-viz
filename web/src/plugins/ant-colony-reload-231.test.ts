import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import { modeById } from "../core/modes";
import { deliverVizPluginFrame } from "../app/viz-frame-tick";
import { normalizeVizDemoPackId } from "../ui/viz-hud";
import { PluginSandbox, setPluginModuleSandboxUrlForTests } from "./host";
import { VIZ_UBO, type VizDataFrame, type VizFrameBudgetStats } from "./viz-host";
import type { VizZoto } from "../../../plugins/sdk/viz-zoto";

/**
 * #231 (UX Pro, TSE, QE): Retry, leaving Ant and coming back, and two Ant tiles must not pick up
 * an already-grown colony or share one that grows at double speed. The pack keeps one module-level
 * colony and the host never calls antColonyTeardown, so these rows pin where a fresh colony comes
 * from today: every load boots the pack in a new sandbox iframe (a new module realm, so a new
 * colony), and one present posts one frame to the one sandbox however many tiles show Ant.
 * All three cases are green controls: the host already gives each load its own module instance.
 */

const SLOT = VIZ_UBO.slotFloats;
const ANT_CAPS = ["viz.read", "viz.write", "config.read"];

type AntInstance = { step: (f: VizDataFrame) => void; slots: () => Float32Array };

/**
 * One evaluation of the pack's frontend module, the way one sandbox iframe boots it: a fresh
 * module registry (vi.resetModules), a fresh zoto host, then the pack's own onFrame.
 */
async function bootAntModule(): Promise<AntInstance> {
  vi.resetModules();
  const slots = new Float32Array(VIZ_UBO.totalFloats);
  const zoto: VizZoto = {
    onTick: null,
    onConfig: null,
    onFrame: null,
    getConfig: () => ({}),
    writeBuffer: (slot, data) => {
      slots.fill(0, slot * SLOT, (slot + 1) * SLOT);
      slots.set(Array.from(data).slice(0, SLOT), slot * SLOT);
    },
    writeUniform: () => {},
    writeParticles: () => {},
  };
  Object.assign(globalThis, { zoto });
  await import("../../../plugins/src/ant-colony/frontend/index");
  const onFrame = zoto.onFrame;
  expect(onFrame, "ant-colony frontend registers zoto.onFrame").toBeTypeOf("function");
  return { step: (f) => onFrame!(f), slots: () => new Float32Array(slots) };
}

function lanFrame(i: number): VizDataFrame {
  const talkers = ["gateway", "lan", "internet", "lan", "lan"].map((role, k) => ({ id: `192.168.1.${10 + k}`, rate: 2 + k, role }));
  return {
    t: 1 + i / 6,
    dt: 1 / 6,
    audio: 0.1,
    packets: [{ proto: "tcp", size: 120, field: 0.3 }, { proto: "udp", size: 80, field: 0.7 }],
    rf: [],
    talkers,
    headlines: [],
  };
}

function stepN(ant: AntInstance, from: number, n: number): Float32Array {
  for (let i = from; i < from + n; i++) ant.step(lanFrame(i));
  return ant.slots();
}

function floatsDiffer(a: Float32Array, b: Float32Array): number {
  expect(a.length).toBe(b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

const N = 30;

describe("#231 Retry and leave-and-return boot Ant in a new sandbox iframe", () => {
  let packAssetFrame: typeof import("./pack-asset-frame");
  let open: ReturnType<typeof vi.spyOn>;
  let opened = 0;

  beforeEach(async () => {
    packAssetFrame = await import("./pack-asset-frame");
    opened = 0;
    open = vi.spyOn(packAssetFrame, "openPackAssetFrame").mockImplementation(async () => {
      opened += 1;
      return `${String(opened).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
    });
    vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
    setPackAssetTokenForTests("_sandbox", "test-sandbox-token");
    setPluginModuleSandboxUrlForTests(async () => `data:text/javascript,${encodeURIComponent("export {};")}`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    setPluginModuleSandboxUrlForTests(null);
    setPackAssetTokenForTests("_sandbox", "");
    packAssetFrame.resetPackAssetFrameState();
  });

  /**
   * Retry (tile-health restart-pack -> loadTsPlugin -> attachPluginFrontend) and a return to Ant
   * after another pack both end in sandbox.loadModule, which unloads first: the old iframe is
   * removed and a new one boots the module, so the colony it held goes with its realm.
   */
  it("drops the old iframe and boots a new one on Retry and on a return to Ant", async () => {
    const box = new PluginSandbox();
    await box.loadModule("ant-colony", ANT_CAPS, {}, "h-ant");
    const first = document.querySelector("iframe");
    expect(first, "first Ant load boots a sandbox iframe").not.toBeNull();

    await box.loadModule("ant-colony", ANT_CAPS, {}, "h-ant"); // Retry: same pack, same hash
    const retried = document.querySelector("iframe");
    expect(retried === first, "Retry reuses the first iframe").toBe(false);
    expect(first!.isConnected, "Retry leaves the first iframe attached").toBe(false);

    await box.loadModule("koi-pond", ["viz.write"], {}, "h-koi"); // leave Ant
    await box.loadModule("ant-colony", ANT_CAPS, {}, "h-ant"); // come back
    const back = document.querySelector("iframe");
    expect(back === retried || back === first, "the return reuses an earlier Ant iframe").toBe(false);
    expect(retried!.isConnected, "the return leaves the Retry iframe attached").toBe(false);

    expect(document.querySelectorAll("iframe"), "one live sandbox iframe").toHaveLength(1);
    expect(open, "one pack-asset frame per load").toHaveBeenCalledTimes(4);
    expect(box.readyPack).toBe("ant-colony");
    box.unload();
  });
});

describe("#231 a new module instance starts a fresh colony", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "zoto");
  });

  it("after Retry or a return, the slots match a fresh load with 0 floats different", async () => {
    const fresh = await bootAntModule();
    const firstLoad = stepN(fresh, 0, N);
    const grown = stepN(fresh, N, N);
    // Sensitivity: the colony does grow, so a reused one would show up in differing floats.
    expect(floatsDiffer(grown, firstLoad), "a colony 2N frames in differs from N frames in").toBeGreaterThan(0);

    const reloaded = await bootAntModule(); // Retry / return: a new iframe evaluates the module again
    const again = stepN(reloaded, 0, N);
    const d = floatsDiffer(again, firstLoad);
    expect(d, `after the reload ${d} of ${again.length} floats differ from a fresh load`).toBe(0);
  });
});

describe("#231 two Ant tiles", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "zoto");
  });

  /**
   * One present (main.ts addPresentListener -> tickVizPresentDeliver) delivers one frame, and
   * deliverVizPluginFrame posts it to the one sandbox once, with no demo-pack mirror for Ant.
   */
  it("posts one frame per present to the one sandbox when two mosaic tiles show Ant", () => {
    expect(normalizeVizDemoPackId("ant-colony"), "Ant has no host-realm mirror").toBeNull();
    const sent: VizDataFrame[] = [];
    const mode = modeById("ant-colony");
    const stats: VizFrameBudgetStats = { lastMs: 0, overBudget: 0, skipped: 0, total: 0 };
    for (let i = 0; i < N; i++) {
      deliverVizPluginFrame({
        frame: lanFrame(i),
        sandbox: { frame: (f) => sent.push(f), handlers: {} },
        mosaic: { on: true, tileIds: ["ant-colony", "ant-colony-2"], graphScene: () => null },
        mosaicDemoPacks: false,
        packId: normalizeVizDemoPackId("ant-colony"),
        activeMode: mode,
        modeById: () => mode,
        mosaicTileViewId: () => "ant-colony",
        pluginSpecForMode: () => null,
        optsFor: () => ({}),
        budgetStats: stats,
      });
    }
    expect(sent, `${N} presents with two Ant tiles`).toHaveLength(N);
  });

  it("two module instances stepped N frames each match one tile stepped N frames", async () => {
    const single = stepN(await bootAntModule(), 0, N);
    const tileA = stepN(await bootAntModule(), 0, N);
    const tileB = stepN(await bootAntModule(), 0, N);
    expect(floatsDiffer(tileA, single), "tile A vs one tile").toBe(0);
    expect(floatsDiffer(tileB, single), "tile B vs one tile").toBe(0);
    // Sensitivity: one colony ticked for both tiles (2 ticks per present) would not match.
    const shared = await bootAntModule();
    for (let i = 0; i < N; i++) {
      shared.step(lanFrame(i));
      shared.step(lanFrame(i));
    }
    expect(floatsDiffer(shared.slots(), single), "a shared colony ticked twice per present").toBeGreaterThan(0);
  });
});
