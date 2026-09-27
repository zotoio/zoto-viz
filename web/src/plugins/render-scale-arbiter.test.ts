import { describe, expect, it } from "vitest";
import {
  RenderScaleGovernor,
  RENDER_SCALE_STEP_DOWN_MS,
  RENDER_SCALE_STEP_UP_MS,
} from "./render-scale-governor";
import { arbitrateRenderScaleSteps } from "./render-scale-arbiter";
import { VIZ_FRAME_BUDGET_MS } from "./viz-host";

const CONFIG = { min: 0.35, steps: [1, 0.75, 0.5, 0.35] as const };

function arbitrateTick(
  governors: RenderScaleGovernor[],
  p95Ms: number[],
  now: number,
  budgetMs: number,
): void {
  const entries = governors.map((g, i) => ({
    governor: g,
    proposal: g.evaluate({ now, p95Ms: p95Ms[i] ?? p95Ms[0]!, budgetMs }),
  }));
  arbitrateRenderScaleSteps(entries, now);
}

describe("RenderScaleArbiter", () => {
  const pageBudget = VIZ_FRAME_BUDGET_MS;
  const share4 = pageBudget / 4;

  it("matches the plain governor with exactly one governed view", () => {
    const plain = new RenderScaleGovernor(CONFIG);
    const gated = new RenderScaleGovernor(CONFIG);
    const budget = pageBudget;
    let t = 0;
    for (let i = 0; i < 400; i++) {
      t += 16;
      const hot = i > 40 && i < 280;
      const p95 = hot ? budget + 6 : budget * 0.4;
      plain.tick({ now: t, p95Ms: p95, budgetMs: budget });
      arbitrateTick([gated], [p95], t, budget);
    }
    expect(gated.scale).toBe(plain.scale);
    expect(gated.scaleIndex).toBe(plain.scaleIndex);
  });

  it("allows at most one step-down on a shared GPU spike across four views", () => {
    const governors = Array.from({ length: 4 }, () => new RenderScaleGovernor(CONFIG));
    let now = 0;
    while (now < RENDER_SCALE_STEP_DOWN_MS + 50) {
      arbitrateTick(governors, [share4 + 20, share4 + 20, share4 + 20, share4 + 20], now, share4);
      now += 16;
    }
    const before = governors.map((g) => g.scale);
    arbitrateTick(governors, [share4 + 40, share4 + 40, share4 + 40, share4 + 40], now, share4);
    const stepped = governors.filter((g, i) => g.scale !== before[i]!).length;
    expect(stepped).toBe(1);
  });

  it("2×2 wall: only the expensive tile steps down over 10s when cheap tiles inherit GPU wait", () => {
    const expensive = new RenderScaleGovernor(CONFIG);
    const cheap = [
      new RenderScaleGovernor(CONFIG),
      new RenderScaleGovernor(CONFIG),
      new RenderScaleGovernor(CONFIG),
    ];
    const governors = [expensive, ...cheap];
    const expensiveP95 = share4 + 16;
    const inflatedCheapP95 = share4 + 7;
    let now = 0;
    while (now < 10_000) {
      arbitrateTick(
        governors,
        [expensiveP95, inflatedCheapP95, inflatedCheapP95, inflatedCheapP95],
        now,
        share4,
      );
      now += 16;
    }
    expect(expensive.scale).toBeLessThan(1);
    expect(cheap.every((g) => g.scale === 1)).toBe(true);
  });

  it("grants at most one step-up per tick, cheapest view first", () => {
    const governors = [
      new RenderScaleGovernor(CONFIG),
      new RenderScaleGovernor(CONFIG),
    ];
    let now = 0;
    while (now < RENDER_SCALE_STEP_DOWN_MS + 100) {
      arbitrateTick(governors, [share4 + 12, share4 + 4], now, share4);
      now += 16;
    }
    expect(governors[0]!.scale).toBeLessThan(1);
    expect(governors[1]!.scale).toBe(1);
    let stepsUp = 0;
    while (now < RENDER_SCALE_STEP_DOWN_MS + RENDER_SCALE_STEP_UP_MS + 400) {
      const before = governors.map((g) => g.scale);
      arbitrateTick(governors, [share4 * 0.2, share4 * 0.35], now, share4);
      if (governors.some((g, i) => g.scale > before[i]!)) stepsUp++;
      now += 16;
    }
    expect(stepsUp).toBeGreaterThanOrEqual(1);
    expect(stepsUp).toBeLessThanOrEqual(
      Math.ceil((RENDER_SCALE_STEP_UP_MS + 400) / 16) + 1,
    );
  });
});
