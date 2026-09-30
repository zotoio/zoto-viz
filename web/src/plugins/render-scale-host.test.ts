import { describe, expect, it } from "vitest";
import {
  RenderScaleViewState,
  sharedRenderBudgetMs,
  tickRenderScalePanes,
  visibleRenderingPaneCount,
  type RenderScalePane,
} from "./render-scale-host";

/** A hosted pane that also reports the scale it was last given. */
function pane(active: boolean, hasGov = true): RenderScalePane & { readonly applied: number } {
  const state = new RenderScaleViewState();
  if (hasGov) state.configure({ min: 0.35, steps: [1, 0.75, 0.5, 0.35] });
  let scale = 1;
  return {
    renderScaleActive: active,
    renderScaleState: state,
    applyRenderScale: (s) => { scale = s; },
    get applied() { return scale; },
  };
}

describe("visibleRenderingPaneCount", () => {
  it("counts active panes and never returns zero", () => {
    expect(visibleRenderingPaneCount([])).toBe(1);
    const a = pane(true);
    const b = pane(false);
    expect(visibleRenderingPaneCount([a, b])).toBe(1);
    expect(visibleRenderingPaneCount([pane(true), pane(true)])).toBe(2);
  });
});

describe("sharedRenderBudgetMs", () => {
  it("splits the page budget across active panes", () => {
    const panes = [pane(true), pane(true)];
    expect(sharedRenderBudgetMs(panes, 16.7)).toBeCloseTo(8.35, 2);
  });
});

describe("tickRenderScalePanes", () => {
  it("only ticks active panes with a governor", () => {
    const active = pane(true);
    const idle = pane(false);
    tickRenderScalePanes([active, idle], 0);
    expect(active.renderScaleState.renderScale).toBe(1);
  });
});
