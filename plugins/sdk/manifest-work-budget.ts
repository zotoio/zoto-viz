/**
 * Shared manifest workBudget shape (#45). Ceilings live in service/policy/work-budget-ceilings.json;
 * host validators load that file from the install root, never from a pack zip.
 */
import schema from "./manifest-work-budget.schema.json";

export const MANIFEST_WORK_BUDGET_SCHEMA_PATH = "plugins/sdk/manifest-work-budget.schema.json";

const required = schema.required as string[];

export type ManifestWorkBudgetKey =
  | "maxDrawCalls"
  | "maxTriangles"
  | "maxInstances"
  | "maxGpuBytes"
  | "maxSimStepsPerFrame"
  | "maxPacketsPerFrame";

export type ManifestWorkBudget = Record<ManifestWorkBudgetKey, number>;

export const MANIFEST_WORK_BUDGET_KEYS: readonly ManifestWorkBudgetKey[] = [
  "maxDrawCalls",
  "maxTriangles",
  "maxInstances",
  "maxGpuBytes",
  "maxSimStepsPerFrame",
  "maxPacketsPerFrame",
];

for (const key of required) {
  if (!MANIFEST_WORK_BUDGET_KEYS.includes(key as ManifestWorkBudgetKey)) {
    throw new Error(`manifest-work-budget.schema.json required key mismatch: ${key}`);
  }
}

function fieldLabel(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function plainWholeNumberReason(path: string, key: string): string {
  return `${fieldLabel(path, key)} must be a whole number that is at least 0`;
}

/**
 * Validate workBudget field shapes only (non-negative integers). Does not apply host ceilings.
 */
export function parseManifestWorkBudgetShape(raw: unknown, path = "workBudget"): ManifestWorkBudget {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${path} must be a mapping of cap names to whole numbers`);
  }
  const rec = raw as Record<string, unknown>;
  const allowed = new Set<string>(MANIFEST_WORK_BUDGET_KEYS);
  for (const key of Object.keys(rec)) {
    if (!allowed.has(key)) {
      throw new Error(`${path} does not allow ${key}`);
    }
  }
  const out: Partial<ManifestWorkBudget> = {};
  for (const key of MANIFEST_WORK_BUDGET_KEYS) {
    const value = rec[key];
    if (value === undefined) {
      throw new Error(`${fieldLabel(path, key)} is required`);
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(plainWholeNumberReason(path, key));
    }
    if (!Number.isInteger(value)) {
      throw new Error(plainWholeNumberReason(path, key));
    }
    if (value < 0) {
      throw new Error(`${fieldLabel(path, key)} must be at least 0`);
    }
    out[key] = value;
  }
  return out as ManifestWorkBudget;
}

export function workBudgetExceedsCeilings(
  budget: ManifestWorkBudget,
  ceilings: Readonly<ManifestWorkBudget>,
): boolean {
  for (const key of MANIFEST_WORK_BUDGET_KEYS) {
    if (budget[key] > ceilings[key]) return true;
  }
  return false;
}

export function clampManifestWorkBudgetToCeilings(
  budget: ManifestWorkBudget,
  ceilings: Readonly<ManifestWorkBudget>,
): ManifestWorkBudget {
  const out: Partial<ManifestWorkBudget> = {};
  for (const key of MANIFEST_WORK_BUDGET_KEYS) {
    const raw = budget[key];
    const n = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0;
    out[key] = Math.min(Math.max(0, n), ceilings[key]);
  }
  return out as ManifestWorkBudget;
}

export function workBudgetInstallBlockedReason(
  budget: ManifestWorkBudget,
  ceilings: Readonly<ManifestWorkBudget>,
  multiplier = 10,
): string | null {
  for (const key of MANIFEST_WORK_BUDGET_KEYS) {
    const limit = ceilings[key] * multiplier;
    if (budget[key] > limit) {
      return (
        `${fieldLabel("workBudget", key)} is far above what this monitor allows ` +
        `(at most ${limit}; the pack asked for ${budget[key]})`
      );
    }
  }
  return null;
}
