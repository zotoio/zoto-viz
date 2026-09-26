import { describe, expect, it, beforeEach } from "vitest";
import { hostWorkBudgetCeilings, ingestCatalogWorkBudget, WORK_BUDGET_LIMITED_NOTE } from "./work-budget-policy";
import { toPluginView } from "./plugin-visualisation";
import { applyPluginViewWorkBudget } from "./manifest-work-budget-host";
import { applyPluginCatalog } from "./plugin";
import {
  disposeMarblePack,
  ingestFrame,
  marbleWorkBudget,
  setMarbleWorkBudgetFromHost,
} from "../../../plugins/src/marble-run/frontend/pack";
import { marbleSim } from "../../../plugins/src/marble-run/frontend/pack";
import type { ManifestWorkBudget } from "../../../plugins/sdk/manifest-work-budget";

function fullBudget(over: Partial<ManifestWorkBudget> = {}): ManifestWorkBudget {
  return { ...hostWorkBudgetCeilings(), ...over };
}

function marbleCatalogRow(workBudget: ManifestWorkBudget) {
  return {
    id: "marble-run",
    name: "Marble Run",
    version: 1,
    engine: "graph",
    base: "protocols",
    visualisation: {
      engine: "graph",
      base: "protocols",
      workBudget,
    },
  };
}

describe("workBudget catalog host path (#45)", () => {
  beforeEach(() => {
    disposeMarblePack();
    setMarbleWorkBudgetFromHost(hostWorkBudgetCeilings());
  });

  it("600-frame row: host clamps maxSimStepsPerFrame and integrate runs at most 4 times per frame", () => {
    const view = toPluginView(marbleCatalogRow(fullBudget({ maxSimStepsPerFrame: 99 })));
    expect(view.workBudget?.maxSimStepsPerFrame).toBe(4);
    applyPluginViewWorkBudget(view);
    expect(marbleWorkBudget().maxSimStepsPerFrame).toBe(4);
    let maxSteps = 0;
    for (let i = 0; i < 600; i++) {
      ingestFrame({
        t: i * 0.016,
        dt: 0.25,
        audio: 0,
        packets: [],
        rf: [],
        talkers: [],
        headlines: [],
      });
      maxSteps = Math.max(maxSteps, marbleSim().integrateStepsLastFrame());
    }
    expect(maxSteps).toBeLessThanOrEqual(4);
  });

  it("catalog load keeps over-ceiling packs with the limited note", () => {
    const view = toPluginView(marbleCatalogRow(fullBudget({ maxDrawCalls: 99 })));
    expect(view.workBudget?.maxDrawCalls).toBe(hostWorkBudgetCeilings().maxDrawCalls);
    expect(view.workBudgetLimited).toBe(WORK_BUDGET_LIMITED_NOTE);
  });

  it("applyPluginCatalog wires workBudget through toPluginView entry", () => {
    const specs = [toPluginView(marbleCatalogRow(fullBudget({ maxPacketsPerFrame: 99 })))];
    applyPluginCatalog(specs);
    expect(marbleWorkBudget().maxPacketsPerFrame).toBe(hostWorkBudgetCeilings().maxPacketsPerFrame);
  });

  it("ingestCatalogWorkBudget uses host policy path only", () => {
    const { budget } = ingestCatalogWorkBudget(fullBudget({ maxInstances: 500 }));
    expect(budget.maxInstances).toBe(hostWorkBudgetCeilings().maxInstances);
  });
});
