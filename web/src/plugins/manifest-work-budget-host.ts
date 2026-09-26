import type { PluginView } from "./plugin";
import { hostClampManifestWorkBudget } from "./work-budget-policy";
import { setMarbleWorkBudgetFromHost } from "../../../plugins/src/marble-run/frontend/work-budget";

export { hostClampManifestWorkBudget };

/** Push clamped workBudget from a catalog row into packs that consume it. */
export function applyPluginViewWorkBudget(spec: PluginView): void {
  if (!spec.workBudget) return;
  if (spec.id === "marble-run") {
    setMarbleWorkBudgetFromHost(spec.workBudget);
  }
}
