/**
 * Host → pack init context (#45c). Optional fields stay v1-compatible.
 */
import {
  type ManifestWorkBudget,
  parseManifestWorkBudgetShape,
} from "./manifest-work-budget";

export const HOST_INIT_CONTEXT_VERSION = 1;

/** Caps used when the host has not delivered workBudget yet (sandbox bundle isolation). */
export const CONSERVATIVE_WORK_BUDGET: ManifestWorkBudget = {
  maxDrawCalls: 0,
  maxTriangles: 0,
  maxInstances: 0,
  maxGpuBytes: 0,
  maxSimStepsPerFrame: 1,
  maxPacketsPerFrame: 0,
};

export function parseHostInitWorkBudget(raw: unknown): ManifestWorkBudget | undefined {
  if (raw === undefined || raw === null) return undefined;
  return parseManifestWorkBudgetShape(raw);
}

export function workBudgetFromHostInit(raw: unknown): ManifestWorkBudget {
  return parseHostInitWorkBudget(raw) ?? CONSERVATIVE_WORK_BUDGET;
}
