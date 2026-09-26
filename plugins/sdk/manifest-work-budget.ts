/**
 * Shared manifest workBudget schema (#45). Edit manifest-work-budget.schema.json only;
 * TypeScript and Python validators both read that file.
 */
import schema from "./manifest-work-budget.schema.json";

export const MANIFEST_WORK_BUDGET_SCHEMA_PATH = "plugins/sdk/manifest-work-budget.schema.json";

const props = schema.properties as Record<string, { maximum: number }>;
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

/** Host-owned per-field ceilings (from manifest-work-budget.schema.json). */
export function manifestWorkBudgetCeilings(): Readonly<ManifestWorkBudget> {
  const out: Partial<ManifestWorkBudget> = {};
  for (const key of MANIFEST_WORK_BUDGET_KEYS) {
    out[key] = props[key]!.maximum;
  }
  return out as ManifestWorkBudget;
}

function fieldLabel(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function plainRangeReason(path: string, key: string, ceiling: number): string {
  return `${fieldLabel(path, key)} must be a whole number from 0 to ${ceiling}`;
}

/**
 * Validate a visualisation.yml workBudget object. Throws Error with a plain-language reason.
 */
export function validateManifestWorkBudget(raw: unknown, path = "workBudget"): ManifestWorkBudget {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${path} must be a mapping of cap names to whole numbers`);
  }
  const rec = raw as Record<string, unknown>;
  const ceilings = manifestWorkBudgetCeilings();
  const allowed = new Set<string>(MANIFEST_WORK_BUDGET_KEYS);
  for (const key of Object.keys(rec)) {
    if (!allowed.has(key)) {
      throw new Error(`${path} does not allow ${key}`);
    }
  }
  const out: Partial<ManifestWorkBudget> = {};
  for (const key of MANIFEST_WORK_BUDGET_KEYS) {
    const ceiling = ceilings[key];
    const value = rec[key];
    if (value === undefined) {
      throw new Error(`${fieldLabel(path, key)} is required`);
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(plainRangeReason(path, key, ceiling));
    }
    if (!Number.isInteger(value)) {
      throw new Error(plainRangeReason(path, key, ceiling));
    }
    if (value < 0) {
      throw new Error(`${fieldLabel(path, key)} must be at least 0`);
    }
    if (value > ceiling) {
      throw new Error(`${fieldLabel(path, key)} must be at most ${ceiling} (got ${value})`);
    }
    out[key] = value;
  }
  return out as ManifestWorkBudget;
}

/** Runtime host clamp so older manifests cannot exceed host ceilings. */
export function clampManifestWorkBudgetAtRuntime(budget: ManifestWorkBudget): ManifestWorkBudget {
  const ceilings = manifestWorkBudgetCeilings();
  const out: Partial<ManifestWorkBudget> = {};
  for (const key of MANIFEST_WORK_BUDGET_KEYS) {
    const raw = budget[key];
    const n = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0;
    out[key] = Math.min(Math.max(0, n), ceilings[key]);
  }
  return out as ManifestWorkBudget;
}
