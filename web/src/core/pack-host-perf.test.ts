import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countPackPerfReads as countReads } from "../../test-support/pack-perf-read-counts";
import {
  packHostPerfIsOn,
  packHostPerfSnapshot,
  packPerfEnabled,
  refreshPackPerfEnabled,
  resetPackHostPerf,
  notePackHostGpuMs,
  notePackHostPresentInterval,
  notePackPresentDelivery,
  notePackSandboxFrame,
  notePackWriteBatch,
  PACK_PERF_STORE,
} from "./pack-host-perf";
import type { StateMsg } from "./types";
import { resetVizClockInjectors, setVizBuildCostTicksInjector } from "./viz-clock";
import { monoMs, type MonoMs } from "./viz-time";
import {
  maybeReportPackHostPerf,
  notePackPerfPresent,
  packPerfReportGateRunsForTests,
  resetPackPerfReportGateRunsForTests,
} from "../app/pack-perf-report";
import { tickVizPresentDeliver, type VizPresentDeliverHost } from "../app/viz-present-deliver";
import { NetScene } from "../graph/scene";
import { PluginSandbox } from "../plugins/host";
import type { PluginView } from "../plugins/plugin";
import { VizFrameBudget } from "../plugins/viz-host";
import { deliverPluginPresentTick, type PresentDriveBinding } from "../plugins/viz-present-tick";

/**
 * #196: the pack-perf flag is resolved once (localStorage OR boot `?packPerf`) and refreshed on
 * change, so a disabled build does 0 storage reads and 0 URL parses per frame. Counts only; no
 * wall-clock rows on the box (timing belongs to the local GPU runner, reported, never asserted).
 */

const FRAMES = 10;
const BOOT_URL = window.location.href;

/** Cross-tab change: another tab wrote the store, this tab gets a `storage` event. */
function crossTab(value: "1" | null): void {
  if (value === null) localStorage.removeItem(PACK_PERF_STORE);
  else localStorage.setItem(PACK_PERF_STORE, value);
  window.dispatchEvent(new StorageEvent("storage", { key: PACK_PERF_STORE, newValue: value }));
}

/** Same-tab change: this tab wrote the store and calls the exported refresh helper. */
function sameTab(value: "1" | null, refresh: () => boolean): void {
  if (value === null) localStorage.removeItem(PACK_PERF_STORE);
  else localStorage.setItem(PACK_PERF_STORE, value);
  refresh();
}

function emptyState(): StateMsg {
  return {
    type: "state",
    ts: 1_700_000_000,
    stats: { active_flows: 0, devices: 0, packets: 0 },
    devices: [],
    flows: [],
  } as unknown as StateMsg;
}

/** Real per-frame callers of the pack-perf gate, driven through their exported entry points. */
function perFrameCallers() {
  const spec = { id: "perf-probe", name: "perf-probe", capabilities: ["viz.read"] } as unknown as PluginView;
  let sandboxFrames = 0;
  let presentTicks = 0;
  let clock: MonoMs = monoMs(0);
  const vizHud = { syncStatusPanels() {}, clearStatus() {}, tick() {} };
  const gpuNotes: number[] = [];
  const sceneStub = {
    pulseNow: { bass: 0 },
    viewEl: document.createElement("div"),
    heardSpectrum: () => ({ spectrum: [] }),
    renderScaleActive: false,
    renderScaleState: { hasGovernor: false, noteGpuMs: (ms: number) => gpuNotes.push(ms) },
    paneFps: { noteGpu() {} },
  };
  const host = {
    modeById: () => ({ id: "perf-probe", pluginId: "perf-probe" }),
    modeSelValue: () => "perf-probe",
    pluginSpecs: [spec],
    tsWatchId: () => "",
    mosaic: null,
    scene: sceneStub,
    renderHost: { bufferPixelSize: () => ({ width: 1, height: 1 }) },
    sandbox: { frame: () => { sandboxFrames++; }, handlers: {} },
    vizBudget: new VizFrameBudget(),
    getVizWriter: () => ({}),
    bindVizWriter() {},
    vizHud,
    optsFor: () => ({}),
    mosaicTileViewId: (slot: string) => slot,
    pluginSpecForMode: () => spec,
    syncPanelPackSub() {},
    feedTitleCube: { setActive() {}, sync() {} },
    getVizFrameClockMs: () => clock,
    setVizFrameClockMs: (ms: MonoMs) => { clock = ms; },
    syncVizBudgetTileScope() {},
    renderScaleGovernor: { scene: sceneStub, mosaic: null, pluginSpecForMode: () => spec, vizHud },
  } as unknown as VizPresentDeliverHost;
  const box = new PluginSandbox();
  const boxPriv = box as unknown as { caps: string[]; dispatchPluginMsg(d: unknown): void };
  boxPriv.caps = ["viz.write"];
  let writeBatches = 0;
  box.handlers.writeBatch = () => { writeBatches++; };
  const binding: PresentDriveBinding = {
    sandbox: { deliverPresentTick: () => { presentTicks++; } } as unknown as PluginSandbox,
    contract: { presentTick: true } as PresentDriveBinding["contract"],
    tileId: "perf-probe",
    pluginClock: () => 0,
    stageAspect: () => 1,
  };
  const state = emptyState();
  return {
    /** One simulated frame through every per-frame pack-perf site. */
    frame(i: number): void {
      const ts = 1000 + i * 16;
      // app/main.ts present listener's pack-perf step (the helper main.ts calls; booted in main-entry.pack-perf).
      notePackPerfPresent(ts, () => 16.7);
      // app/pack-perf-report.ts: the report's own gate (main.ts only reaches it when perf is on).
      void maybeReportPackHostPerf(ts);
      // app/viz-present-deliver.ts: gate + notePackSandboxFrame inside onFrame.
      tickVizPresentDeliver(state, host);
      // graph/scene.ts noteFrameCost: gate + notePackHostGpuMs.
      NetScene.prototype.noteFrameCost.call(sceneStub as unknown as NetScene, 4);
      // plugins/host.ts writeBatch: notePackWriteBatch.
      boxPriv.dispatchPluginMsg({ type: "writeBatch", payload: { buffers: [{ slot: 0, data: [1, 2] }], uniforms: [] } });
      // plugins/viz-present-tick.ts: notePackPresentDelivery.
      deliverPluginPresentTick(binding, ts);
      // The raw hooks, as the callers above reach them.
      notePackWriteBatch(1, 8);
      notePackPresentDelivery("perf-probe");
      notePackSandboxFrame("perf-probe");
      notePackHostGpuMs(4);
      notePackHostPresentInterval(16.7);
      packHostPerfIsOn();
    },
    sandboxFrames: () => sandboxFrames,
    writeBatches: () => writeBatches,
    presentTicks: () => presentTicks,
    gpuNotes: () => gpuNotes.length,
    dispose: () => box.unload(),
  };
}

function expectPristineSnapshot(): void {
  const snap = packHostPerfSnapshot(5000);
  expect(snap.enabled).toBe(false);
  expect(snap.frames).toBe(0);
  expect(snap.presentTicks).toBe(0);
  expect(snap.gpuMs.samples).toBe(0);
  expect(snap.packs).toEqual({});
  expect(snap.writes.batchesPerFrame).toBe(0);
}

describe("pack-host-perf", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", BOOT_URL);
    crossTab(null);
    resetPackHostPerf();
    resetPackPerfReportGateRunsForTests();
    setVizBuildCostTicksInjector(() => 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetVizClockInjectors();
    window.history.replaceState(null, "", BOOT_URL);
    localStorage.removeItem(PACK_PERF_STORE);
  });

  it("disabled: 10 frames through the real callers do 0 storage reads, 0 URL parses, 0 location.search reads", () => {
    const callers = perFrameCallers();
    const reads = countReads();
    for (let i = 0; i < FRAMES; i++) callers.frame(i);
    const counts = {
      storageReads: reads.storageReads(),
      packStoreReads: reads.packStoreReads(),
      urlParses: reads.urlParses(),
      searchReads: reads.searchReads(),
    };
    callers.dispose();
    // The callers really ran: every frame reached each gate / hook site.
    const gates = packPerfReportGateRunsForTests();
    expect(callers.sandboxFrames(), "viz-present-deliver onFrame").toBe(FRAMES);
    expect(callers.presentTicks(), "viz-present-tick deliverPluginPresentTick").toBe(FRAMES);
    expect(callers.gpuNotes(), "scene noteFrameCost").toBe(FRAMES);
    expect(callers.writeBatches(), "host.ts writeBatch dispatch").toBe(FRAMES);
    expect(gates.present, "main.ts present step notePackPerfPresent").toBe(FRAMES);
    expect(gates.report, "maybeReportPackHostPerf gate").toBe(FRAMES);
    expect(counts.packStoreReads).toBe(0);
    expect(counts.storageReads).toBe(0);
    expect(counts.urlParses).toBe(0);
    expect(counts.searchReads).toBe(0);
    expectPristineSnapshot();
  });

  it("records frame intervals when enabled", () => {
    crossTab("1");
    notePackHostPresentInterval(16.7);
    notePackHostPresentInterval(16.8);
    notePackWriteBatch(1, 128);
    const snap = packHostPerfSnapshot(1000);
    expect(snap.enabled).toBe(true);
    expect(snap.frames).toBe(2);
    expect(snap.writes.batchesPerFrame).toBeGreaterThan(0);
  });

  it("cross-tab toggle: a storage event flips recording on the first frame after, with 0 reads per frame", () => {
    const reads = countReads();
    crossTab("1");
    const afterOn = reads.packStoreReads();
    notePackHostPresentInterval(16.7);
    expect(packPerfEnabled()).toBe(true);
    expect(packHostPerfSnapshot(1000).frames).toBe(1);
    notePackHostPresentInterval(16.7);
    notePackPresentDelivery("perf-probe");
    expect(reads.packStoreReads() - afterOn).toBe(0);

    crossTab(null);
    const afterOff = reads.packStoreReads();
    notePackHostPresentInterval(16.7);
    notePackPresentDelivery("perf-probe");
    expect(packPerfEnabled()).toBe(false);
    expectPristineSnapshot();
    expect(reads.packStoreReads() - afterOff).toBe(0);

    crossTab("1");
    notePackHostPresentInterval(16.7);
    expect(packHostPerfSnapshot(1000).frames).toBe(1);
    expect(reads.urlParses()).toBe(0);
  });

  it("same-tab toggle: refreshPackPerfEnabled() flips recording on the first frame after, with 0 reads per frame", () => {
    const reads = countReads();
    sameTab("1", refreshPackPerfEnabled);
    const afterOn = reads.packStoreReads();
    notePackHostPresentInterval(16.7);
    expect(packPerfEnabled()).toBe(true);
    expect(packHostPerfSnapshot(1000).frames).toBe(1);
    expect(reads.packStoreReads() - afterOn).toBe(0);

    sameTab(null, refreshPackPerfEnabled);
    const afterOff = reads.packStoreReads();
    notePackHostPresentInterval(16.7);
    expect(packPerfEnabled()).toBe(false);
    expectPristineSnapshot();
    expect(reads.packStoreReads() - afterOff).toBe(0);
    expect(reads.urlParses()).toBe(0);
  });

  describe("boot URL (?packPerf is read once at module init; changing it needs a reload)", () => {
    type PerfModule = typeof import("./pack-host-perf");
    async function bootWith(url: string): Promise<PerfModule> {
      window.history.replaceState(null, "", url);
      vi.resetModules();
      const mod = await import("./pack-host-perf");
      mod.resetPackHostPerf();
      return mod;
    }

    it("?packPerf in the URL at init enables recording", async () => {
      const mod = await bootWith("/?packPerf");
      mod.notePackHostPresentInterval(16.7);
      expect(mod.packHostPerfSnapshot(1000).enabled).toBe(true);
      expect(mod.packHostPerfSnapshot(1000).frames).toBe(1);
    });

    it("replaceState/pushState/back to ?packPerf without reload: next frame keeps the boot value, 0 URL parses", async () => {
      const mod = await bootWith("/");
      const reads = countReads();
      window.history.replaceState(null, "", "/?packPerf=1");
      mod.notePackHostPresentInterval(16.7);
      expect(mod.packPerfEnabled()).toBe(false);
      window.history.pushState(null, "", "/?packPerf");
      mod.notePackHostPresentInterval(16.7);
      expect(mod.packPerfEnabled()).toBe(false);
      window.history.pushState(null, "", "/");
      window.history.back();
      mod.notePackHostPresentInterval(16.7);
      expect(mod.packPerfEnabled()).toBe(false);
      expect(reads.urlParses()).toBe(0);
      expect(reads.searchReads()).toBe(0);
      expect(mod.packHostPerfSnapshot(1000).frames).toBe(0);

      const on = await bootWith("/?packPerf");
      const reads2 = countReads();
      window.history.replaceState(null, "", "/");
      on.notePackHostPresentInterval(16.7);
      expect(reads2.urlParses()).toBe(0);
      expect(reads2.searchReads()).toBe(0);
      expect(on.packPerfEnabled()).toBe(true);
      expect(on.packHostPerfSnapshot(1000).frames).toBe(1);
    });

    // #199 (UX Pro): `0` and `false` (any case) mean off; a bare `?packPerf` or any other value means on; OR with the key stays.
    for (const url of ["/?packPerf=0", "/?packPerf=false", "/?packPerf=FALSE", "/?packPerf=False"]) {
      it(`#199 ${url} with no stored key: off, 0 frames recorded`, async () => {
        localStorage.removeItem(PACK_PERF_STORE);
        const mod = await bootWith(url);
        mod.notePackHostPresentInterval(16.7);
        expect(mod.packPerfEnabled(), `${url}: flag`).toBe(false);
        expect(mod.packHostPerfSnapshot(1000).frames, `${url}: frames`).toBe(0);
      });
    }

    for (const url of ["/?packPerf", "/?packPerf=", "/?packPerf=1", "/?packPerf=true", "/?packPerf=yes"]) {
      it(`#199 ${url} with no stored key: on, 1 frame recorded`, async () => {
        localStorage.removeItem(PACK_PERF_STORE);
        const mod = await bootWith(url);
        mod.notePackHostPresentInterval(16.7);
        expect(mod.packPerfEnabled(), `${url}: flag`).toBe(true);
        expect(mod.packHostPerfSnapshot(1000).frames, `${url}: frames`).toBe(1);
      });
    }

    it("#199 ?packPerf=0 with the stored key on: on (precedence is OR), 1 frame recorded", async () => {
      localStorage.setItem(PACK_PERF_STORE, "1");
      const mod = await bootWith("/?packPerf=0");
      mod.notePackHostPresentInterval(16.7);
      expect(mod.packPerfEnabled(), "?packPerf=0 + stored on: flag").toBe(true);
      expect(mod.packHostPerfSnapshot(1000).frames, "?packPerf=0 + stored on: frames").toBe(1);
    });

    it("precedence is OR: boot ?packPerf stays on when localStorage goes off; without it, localStorage rules", async () => {
      const url = await bootWith("/?packPerf");
      sameTab("1", url.refreshPackPerfEnabled);
      sameTab(null, url.refreshPackPerfEnabled);
      url.notePackHostPresentInterval(16.7);
      expect(url.packPerfEnabled()).toBe(true);
      expect(url.packHostPerfSnapshot(1000).frames).toBe(1);
      crossTab("1");
      crossTab(null);
      url.notePackHostPresentInterval(16.7);
      expect(url.packPerfEnabled()).toBe(true);
      expect(url.packHostPerfSnapshot(1000).frames).toBe(2);

      const plain = await bootWith("/");
      sameTab("1", plain.refreshPackPerfEnabled);
      plain.notePackHostPresentInterval(16.7);
      expect(plain.packHostPerfSnapshot(1000).frames).toBe(1);
      sameTab(null, plain.refreshPackPerfEnabled);
      plain.notePackHostPresentInterval(16.7);
      expect(plain.packPerfEnabled()).toBe(false);
      expect(plain.packHostPerfSnapshot(1000).frames).toBe(0);
      crossTab("1");
      plain.notePackHostPresentInterval(16.7);
      expect(plain.packHostPerfSnapshot(1000).frames).toBe(1);
      crossTab(null);
      plain.notePackHostPresentInterval(16.7);
      expect(plain.packPerfEnabled()).toBe(false);
      expect(plain.packHostPerfSnapshot(1000).frames).toBe(0);
    });
  });
});
