import { describe, expect, it, beforeEach } from "vitest";
import { CONSERVATIVE_WORK_BUDGET, workBudgetFromHostInit } from "../../../plugins/sdk/host-init-context";
import {
  hostWorkBudgetCeilings,
  resetHostWorkBudgetCeilingsCache,
  setHostWorkBudgetCeilingsForTests,
} from "./work-budget-policy";
import { toPluginView } from "./plugin-visualisation";
import type { ManifestWorkBudget } from "../../../plugins/sdk/manifest-work-budget";
import {
  applyPackWorkBudget,
  disposeMarblePack,
  ingestFrame,
  marbleWorkBudget,
  marbleSim,
  resetPackWorkBudget,
} from "../../../plugins/src/marble-run/frontend/pack";
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

function deliverHostWorkBudget(spec: ReturnType<typeof toPluginView>) {
  applyPackWorkBudget(workBudgetFromHostInit(spec.workBudget));
}

const frame0 = {
  t: 0,
  dt: 0.25,
  audio: 0,
  packets: [],
  rf: [],
  talkers: [],
  headlines: [],
};

describe("workBudget marble pack consumer (#45d)", () => {
  beforeEach(() => {
    disposeMarblePack();
    setHostWorkBudgetCeilingsForTests(null);
    resetHostWorkBudgetCeilingsCache();
    resetPackWorkBudget();
    applyPackWorkBudget(workBudgetFromHostInit(hostWorkBudgetCeilings()));
  });

  it("600-frame row: host clamps maxSimStepsPerFrame and integrate runs at most 4 times per frame", () => {
    disposeMarblePack();
    resetPackWorkBudget();
    expect(marbleWorkBudget()).toEqual(CONSERVATIVE_WORK_BUDGET);
    ingestFrame(frame0);
    expect(marbleWorkBudget()).toEqual(CONSERVATIVE_WORK_BUDGET);
    expect(marbleSim().integrateStepsLastFrame()).toBe(CONSERVATIVE_WORK_BUDGET.maxSimStepsPerFrame);

    const view = toPluginView(marbleCatalogRow(fullBudget({ maxSimStepsPerFrame: 99 })));
    expect(view.workBudget?.maxSimStepsPerFrame).toBe(4);
    deliverHostWorkBudget(view);
    expect(marbleWorkBudget().maxSimStepsPerFrame).toBe(4);
    const steps: number[] = [];
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
      steps.push(marbleSim().integrateStepsLastFrame());
    }
    expect(steps).toEqual(Array(600).fill(4));
  });
});
