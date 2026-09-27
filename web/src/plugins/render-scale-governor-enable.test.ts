import { describe, expect, it, beforeEach } from "vitest";
import {
  refreshHostRenderScaleGovernorEnabled,
  resolveVizGovernorEnabled,
  setVizGovernorSetting,
  hostRenderScaleGovernorEnabled,
} from "./render-scale-governor-enable";
import { RENDER_SCALE_GOVERNOR_TUNING } from "./render-scale-governor";
import { RenderScaleViewState, tickRenderScalePanes, type RenderScalePane } from "./render-scale-host";
import { VIZ_FRAME_BUDGET_MS } from "./viz-host";

describe("resolveVizGovernorEnabled", () => {
  beforeEach(() => {
    localStorage.clear();
    refreshHostRenderScaleGovernorEnabled("");
  });

  it("is off by default", () => {
    expect(resolveVizGovernorEnabled("")).toBe(false);
    expect(hostRenderScaleGovernorEnabled()).toBe(false);
  });

  it("enables from settings or ?vizGovernor=1", () => {
    setVizGovernorSetting(true);
    expect(resolveVizGovernorEnabled("")).toBe(true);
    localStorage.clear();
    expect(resolveVizGovernorEnabled("?vizGovernor=1")).toBe(true);
    refreshHostRenderScaleGovernorEnabled("?vizGovernor=1");
    expect(hostRenderScaleGovernorEnabled()).toBe(true);
  });

  it("?vizGovernor=0 overrides a saved on setting", () => {
    setVizGovernorSetting(true);
    expect(resolveVizGovernorEnabled("?vizGovernor=0")).toBe(false);
  });
});

describe("host governor gate", () => {
  const config = { min: 0.35, steps: [1, 0.75, 0.5, 0.35] };
  const budget = VIZ_FRAME_BUDGET_MS;

  it("keeps scale at 1.0 when the host governor is off", () => {
    const state = new RenderScaleViewState();
    state.configure(config);
    const gov = state.governorForArbiter()!;
    for (let t = 0; t < RENDER_SCALE_GOVERNOR_TUNING.stepDownSustainMs + 100; t += 16) {
      gov.tick({ now: t, p95Ms: budget + 20, budgetMs: budget });
    }
    expect(gov.scale).toBeLessThan(1);
    let applied = 1;
    const p: RenderScalePane = {
      renderScaleActive: true,
      renderScaleState: state,
      applyRenderScale: (s) => { applied = s; },
    };
    tickRenderScalePanes([p], 5000, false);
    expect(applied).toBe(1);
    expect(state.renderScale).toBe(1);
  });

  it("allows stepping when the host governor is on", () => {
    const state = new RenderScaleViewState();
    state.configure(config);
    state.setGpuTimerAvailable(true);
    let applied = 1;
    const p: RenderScalePane = {
      renderScaleActive: true,
      renderScaleState: state,
      applyRenderScale: (s) => { applied = s; },
    };
    for (let t = 0; t <= RENDER_SCALE_GOVERNOR_TUNING.stepDownSustainMs + 50; t += 16) {
      for (let i = 0; i < 8; i++) state.frameBudget.noteGpuMs(budget + 20);
      tickRenderScalePanes([p], t, true);
    }
    expect(applied).toBeLessThan(1);
  });
});
