import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import type { ManifestWorkBudget } from "../../../plugins/sdk/manifest-work-budget";
import {
  assertWorkBudgetOverHostCeiling,
  hostWorkBudgetCeilings,
  ingestCatalogWorkBudget,
  resetHostWorkBudgetCeilingsCache,
  setHostWorkBudgetCeilingsForTests,
  WORK_BUDGET_LIMITED_NOTE,
  HOST_WORK_BUDGET_CEILINGS_PATH,
} from "./work-budget-policy";
import { toPluginView } from "./plugin-visualisation";
import { applyPluginCatalog } from "./plugin";
import { pluginPackMetaLine } from "./plugin-ui";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const POLICY_PATH = join(REPO_ROOT, HOST_WORK_BUDGET_CEILINGS_PATH);
const PARITY_FIXTURE_PATH = join(REPO_ROOT, "tests/fixtures/work-budget-policy-parity.json");

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

describe("workBudget catalog host path (#45c)", () => {
  beforeEach(() => {
    setHostWorkBudgetCeilingsForTests(null);
    resetHostWorkBudgetCeilingsCache();
  });

  it("within-ceiling pack info shows no workBudget limited note", () => {
    const spec = toPluginView(marbleCatalogRow(hostWorkBudgetCeilings()));
    expect(spec.workBudgetLimited).toBeUndefined();
    expect(pluginPackMetaLine(spec)).toBe("marble-run · v1 · graph / protocols");
  });

  it("lowered ceiling row: installed over-ceiling pack stays loaded and pack info shows the limited note", () => {
    const policy = JSON.parse(readFileSync(POLICY_PATH, "utf-8")) as ManifestWorkBudget;
    const lowered = { ...policy, maxPacketsPerFrame: 2 };
    setHostWorkBudgetCeilingsForTests(lowered);
    const spec = toPluginView(marbleCatalogRow(fullBudget({ maxPacketsPerFrame: 8 })));
    applyPluginCatalog([spec]);
    expect(spec.workBudget?.maxPacketsPerFrame).toBe(2);
    expect(pluginPackMetaLine(spec)).toBe(
      `marble-run · v1 · graph / protocols. ${WORK_BUDGET_LIMITED_NOTE}`,
    );
    setHostWorkBudgetCeilingsForTests(null);
  });

  it("parity fixture rejected by TS after raising host policy ceiling", () => {
    const fixture = JSON.parse(readFileSync(PARITY_FIXTURE_PATH, "utf-8")) as {
      workBudget: ManifestWorkBudget;
    };
    const policy = JSON.parse(readFileSync(POLICY_PATH, "utf-8")) as ManifestWorkBudget;
    const raised = { ...policy, maxDrawCalls: 128 };
    setHostWorkBudgetCeilingsForTests(raised);
    let rejected = false;
    try {
      assertWorkBudgetOverHostCeiling(fixture.workBudget);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    expect(fixture.workBudget.maxDrawCalls).toBeGreaterThan(raised.maxDrawCalls);
    setHostWorkBudgetCeilingsForTests(null);
  });

  it("catalog load keeps over-ceiling packs with the limited note", () => {
    const view = toPluginView(marbleCatalogRow(fullBudget({ maxDrawCalls: 99 })));
    expect(view.workBudget?.maxDrawCalls).toBe(hostWorkBudgetCeilings().maxDrawCalls);
    expect(view.workBudgetLimited).toBe(WORK_BUDGET_LIMITED_NOTE);
  });

  it("applyPluginCatalog wires workBudget through toPluginView entry", () => {
    const specs = [toPluginView(marbleCatalogRow(fullBudget({ maxPacketsPerFrame: 99 })))];
    applyPluginCatalog(specs);
    expect(specs[0].workBudget?.maxPacketsPerFrame).toBe(hostWorkBudgetCeilings().maxPacketsPerFrame);
  });

  it("ingestCatalogWorkBudget uses host policy path only", () => {
    const { budget } = ingestCatalogWorkBudget(fullBudget());
    expect(budget.maxDrawCalls).toBe(hostWorkBudgetCeilings().maxDrawCalls);
  });
});
