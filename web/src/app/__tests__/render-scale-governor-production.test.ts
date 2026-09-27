import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RenderHost } from "../../graph/render-host";
import { NetScene } from "../../graph/scene";
import {
  pluginRenderScaleCommitCountForTests,
  resetPluginRenderScaleCommitCountForTests,
} from "../../graph/backdrop";
import { VIZ_FRAME_BUDGET_MS } from "../../plugins/viz-host";
import { RENDER_SCALE_GOVERNOR_TUNING } from "../../plugins/render-scale-governor";
import {
  hostRenderScaleGovernorEnabled,
  refreshHostRenderScaleGovernorEnabled,
  resolveVizGovernorEnabled,
  setVizGovernorSetting,
} from "../../plugins/render-scale-governor-enable";
import { toPluginView } from "../../plugins/plugin-visualisation";
import { formatVizBudgetOverlay } from "../../plugins/viz-budget-overlay";
import type { StateMsg } from "../../core/types";
import { VizHud } from "../../ui/viz-hud";

function minimalState(): StateMsg {
  return {
    type: "state",
    ts: 100,
    iface: "wlan0",
    interfaces: [],
    network: "192.168.1.0/24",
    local_ip: "192.168.1.2",
    gateway: "192.168.1.1",
    uptime: 10,
    stats: {
      pps: 10,
      bps: 1000,
      devices: 2,
      online: 2,
      flows: 5,
      active_flows: 3,
      packets: 100,
      bytes: 1000,
    },
    devices: [],
    flows: [],
  };
}
import {
  applyHostRenderScaleGovernor,
  resetRenderScaleGovernorWiringForTests,
  renderScaleGovernorEnabledTickCountForTests,
  runRenderScaleGovernorPresentTick,
  syncHostRenderGovernorForSpec,
  type RenderScaleGovernorHost,
} from "../render-scale-governor-wiring";
import { loadVizGovernorSetting } from "../../plugins/render-scale-governor-enable";

const RENDER_SCALE_SPEC = toPluginView({
  id: "packet-tunnel",
  name: "Packet Tunnel",
  version: 1,
  render: { scale: { min: 0.35, steps: [1, 0.75, 0.5, 0.35] } },
});

const FRAME_MS = 16;
const FRAMES = 600;
const OVER_MS = VIZ_FRAME_BUDGET_MS + 20;
const IN_BUDGET_MS = 5;

/** Step-down commits when p95 stays over budget for stepDownSustainMs (500 ms) at 16 ms/frame. */
const EXPECTED_STEP_DOWN_COMMITS = 3;

function mountScene(): { scene: NetScene; host: RenderScaleGovernorHost } {
  const wall = document.createElement("div");
  wall.style.width = "640px";
  wall.style.height = "360px";
  document.body.append(wall);
  const sceneEl = document.createElement("div");
  sceneEl.className = "scene";
  sceneEl.style.width = "100%";
  sceneEl.style.height = "100%";
  wall.append(sceneEl);
  const renderHost = new RenderHost(wall);
  const scene = new NetScene(sceneEl, { host: renderHost });
  scene.setActive(true);
  const vizHud = new VizHud(sceneEl, () => {});
  const host: RenderScaleGovernorHost = {
    scene,
    mosaic: null,
    pluginSpecForMode: () => RENDER_SCALE_SPEC,
    vizHud,
  };
  syncHostRenderGovernorForSpec(host, RENDER_SCALE_SPEC);
  scene.renderScaleState.setGpuTimerAvailable(true);
  resetPluginRenderScaleCommitCountForTests();
  return { scene, host };
}

function runFrames(
  host: RenderScaleGovernorHost,
  scene: NetScene,
  frames: number,
  gpuMs: number,
  startNow = 0,
): void {
  let ts = startNow;
  let now = startNow;
  for (let i = 0; i < frames; i++) {
    scene.noteFrameCost(gpuMs);
    runRenderScaleGovernorPresentTick(host, ts, now);
    ts += FRAME_MS;
    now += FRAME_MS;
  }
}

describe("render-scale governor production wiring", () => {
  beforeEach(() => {
    localStorage.clear();
    refreshHostRenderScaleGovernorEnabled("");
    resetRenderScaleGovernorWiringForTests();
    resetPluginRenderScaleCommitCountForTests();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("flag off: no enabled governor ticks and no render-scale commits over 600 frames", () => {
    const { scene, host } = mountScene();
    refreshHostRenderScaleGovernorEnabled("");
    expect(hostRenderScaleGovernorEnabled()).toBe(false);
    runFrames(host, scene, FRAMES, OVER_MS);
    expect(renderScaleGovernorEnabledTickCountForTests()).toBe(0);
    expect(pluginRenderScaleCommitCountForTests()).toBe(0);
  });

  it("flag on with over-budget GPU samples: commits lower scale per step-down rule", () => {
    const { scene, host } = mountScene();
    refreshHostRenderScaleGovernorEnabled("?vizGovernor=1");
    runFrames(host, scene, FRAMES, OVER_MS);
    expect(renderScaleGovernorEnabledTickCountForTests()).toBe(FRAMES);
    expect(pluginRenderScaleCommitCountForTests()).toBe(EXPECTED_STEP_DOWN_COMMITS);
    expect(scene.renderScaleState.renderScale).toBeLessThan(1);
  });

  it("600 in-budget frames with governor on produce no scale commits", () => {
    const { scene, host } = mountScene();
    refreshHostRenderScaleGovernorEnabled("?vizGovernor=1");
    runFrames(host, scene, FRAMES, IN_BUDGET_MS);
    expect(pluginRenderScaleCommitCountForTests()).toBe(0);
  });

  it("HUD shows gov on with flag on and gov off with flag off", () => {
    const hostEl = document.createElement("div");
    const hud = new VizHud(hostEl, () => {});
    hud.setBudgetOverlayVisible(true);
    hud.setActive("packet-tunnel", "Packet Tunnel");
    const stats = {
      skipped: 0, overBudget: 0, lastMs: 12, p95Ms: 12, total: 1, timingSource: "gpu" as const, hasSamples: true,
    };
    hud.tick({
      packId: "packet-tunnel",
      packName: "Packet Tunnel",
      stats,
      frame: null,
      state: minimalState(),
      now: 1000,
      renderScale: 0.75,
      governorEnabled: true,
    });
    expect(hud.root.querySelector(".viz-hud-budget")?.textContent).toBe(formatVizBudgetOverlay({
      timingSource: "gpu",
      lastMs: 12,
      p95Ms: 12,
      renderScale: 0.75,
      governorEnabled: true,
    }));
    hud.tick({
      packId: "packet-tunnel",
      packName: "Packet Tunnel",
      stats,
      frame: null,
      state: minimalState(),
      now: 2000,
      renderScale: 1,
      governorEnabled: false,
    });
    const off = hud.root.querySelector(".viz-hud-budget")?.textContent ?? "";
    expect(off.startsWith("gov off ·")).toBe(true);
  });

  it("?vizGovernor=1 and profile flag enable host; settings toggle round-trips profile", () => {
    expect(resolveVizGovernorEnabled("?vizGovernor=1")).toBe(true);
    refreshHostRenderScaleGovernorEnabled("?vizGovernor=1");
    expect(hostRenderScaleGovernorEnabled()).toBe(true);

    localStorage.clear();
    setVizGovernorSetting(true);
    expect(resolveVizGovernorEnabled("")).toBe(true);

    const wall = document.createElement("div");
    const sceneEl = document.createElement("div");
    wall.append(sceneEl);
    const scene = new NetScene(sceneEl, { host: new RenderHost(wall) });
    const vizHud = new VizHud(sceneEl, () => {});
    const host: RenderScaleGovernorHost = { scene, mosaic: null, pluginSpecForMode: () => null, vizHud };
    applyHostRenderScaleGovernor(false, host);
    expect(loadVizGovernorSetting()).toBe(false);
    applyHostRenderScaleGovernor(true, host);
    expect(loadVizGovernorSetting()).toBe(true);
    refreshHostRenderScaleGovernorEnabled("");
    expect(hostRenderScaleGovernorEnabled()).toBe(true);
  });

  it("step-down sustain matches RENDER_SCALE_GOVERNOR_TUNING", () => {
    expect(RENDER_SCALE_GOVERNOR_TUNING.stepDownSustainMs).toBe(500);
    expect(EXPECTED_STEP_DOWN_COMMITS).toBe(3);
  });
});
