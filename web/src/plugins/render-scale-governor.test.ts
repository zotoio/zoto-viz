import { describe, expect, it } from "vitest";
import {
  DEFAULT_RENDER_SCALE_STEPS,
  RenderScaleGovernor,
  RENDER_SCALE_STEP_DOWN_MS,
  RENDER_SCALE_STEP_UP_MS,
  parseRenderScaleConfig,
} from "./render-scale-governor";
import { VIZ_FRAME_BUDGET_MS } from "./viz-host";

describe("parseRenderScaleConfig", () => {
  it("accepts min and default steps", () => {
    const c = parseRenderScaleConfig({ min: 0.35 });
    expect(c?.min).toBe(0.35);
    expect(c?.steps).toEqual([...DEFAULT_RENDER_SCALE_STEPS]);
  });

  it("clamps steps at min and sorts descending", () => {
    const c = parseRenderScaleConfig({ min: 0.4, steps: [0.5, 1, 0.35, 0.4] });
    expect(c?.steps).toEqual([1, 0.5, 0.4]);
  });

  it("rejects invalid min", () => {
    expect(parseRenderScaleConfig({ min: 0 })).toBeUndefined();
    expect(parseRenderScaleConfig({ min: 1.2 })).toBeUndefined();
  });
});

describe("RenderScaleGovernor hysteresis", () => {
  const config = { min: 0.35, steps: [1, 0.75, 0.5, 0.35] };
  const budget = VIZ_FRAME_BUDGET_MS;

  it("steps down after sustained over-budget p95", () => {
    let t = 0;
    const gov = new RenderScaleGovernor(config, { now: () => t });
    expect(gov.scale).toBe(1);
    gov.tick({ now: 100, p95Ms: budget + 4, budgetMs: budget });
    gov.tick({ now: 100 + RENDER_SCALE_STEP_DOWN_MS + 1, p95Ms: budget + 4, budgetMs: budget });
    expect(gov.scale).toBe(0.75);
  });

  it("steps up only after long comfortable under-budget window", () => {
    let t = 0;
    const gov = new RenderScaleGovernor(config, { now: () => t });
    gov.tick({ now: 100, p95Ms: budget + 2, budgetMs: budget });
    gov.tick({ now: 100 + RENDER_SCALE_STEP_DOWN_MS + 1, p95Ms: budget + 2, budgetMs: budget });
    expect(gov.scale).toBe(0.75);
    gov.tick({ now: 500, p95Ms: budget * 0.5, budgetMs: budget });
    expect(gov.scale).toBe(0.75);
    gov.tick({ now: 500 + RENDER_SCALE_STEP_UP_MS + 1, p95Ms: budget * 0.5, budgetMs: budget });
    expect(gov.scale).toBe(1);
  });

  it("does not flip-flop on noisy samples around the threshold", () => {
    let t = 0;
    const gov = new RenderScaleGovernor(config, { now: () => t });
    for (let i = 0; i < 200; i++) {
      t += 16;
      const p95 = i % 2 === 0 ? budget + 0.2 : budget - 0.2;
      gov.tick({ now: t, p95Ms: p95, budgetMs: budget });
    }
    expect(gov.scale).toBe(1);
  });

  it("respects min and steps floor", () => {
    let t = 0;
    const gov = new RenderScaleGovernor(config, { now: () => t });
    for (let i = 0; i < 10; i++) {
      t += RENDER_SCALE_STEP_DOWN_MS + 100;
      gov.tick({ now: t, p95Ms: budget + 10, budgetMs: budget });
    }
    expect(gov.scale).toBe(0.35);
  });
});
