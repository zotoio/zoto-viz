import type { ManifestWorkBudget } from "../../../sdk/manifest-work-budget";
import { CONSERVATIVE_WORK_BUDGET } from "../../../sdk/host-init-context";

/** Shape of visualisation.yml → workBudget (parsed for caps). */
export type MarbleWorkBudget = ManifestWorkBudget;

const INT = /^\s*([a-zA-Z]+):\s*(\d+)\s*$/;

/** Parse the workBudget block from visualisation.yml text. */
export function parseMarbleWorkBudgetYaml(yaml: string): MarbleWorkBudget {
  const start = yaml.indexOf("workBudget:");
  if (start < 0) throw new Error("workBudget block missing");
  const end = yaml.indexOf("\nconfig:", start);
  const slice = end >= 0 ? yaml.slice(start, end) : yaml.slice(start);
  const out: Record<string, number> = {};
  for (const line of slice.split("\n")) {
    const m = line.match(INT);
    if (m) out[m[1]!] = Number(m[2]);
  }
  const req = [
    "maxDrawCalls",
    "maxTriangles",
    "maxInstances",
    "maxGpuBytes",
    "maxSimStepsPerFrame",
    "maxPacketsPerFrame",
  ] as const;
  for (const k of req) {
    if (!Number.isFinite(out[k])) throw new Error(`workBudget.${k} missing`);
  }
  return out as MarbleWorkBudget;
}

/** Shipped workBudget block — must stay in sync with visualisation.yml (tests assert parity). */
const SHIPPED_WORK_BUDGET_SNIPPET = `workBudget:
  maxDrawCalls: 64
  maxTriangles: 120000
  maxInstances: 48
  maxGpuBytes: 8388608
  maxSimStepsPerFrame: 4
  maxPacketsPerFrame: 8
`;

let hostBudget: MarbleWorkBudget | null = null;
let conservativeUntilHostInit = false;

export function applyPackWorkBudget(budget: MarbleWorkBudget): void {
  hostBudget = budget;
  conservativeUntilHostInit = false;
}

export function resetPackWorkBudget(): void {
  hostBudget = null;
  conservativeUntilHostInit = true;
}

export function marbleWorkBudget(): MarbleWorkBudget {
  if (hostBudget) return hostBudget;
  if (conservativeUntilHostInit) return CONSERVATIVE_WORK_BUDGET;
  return parseMarbleWorkBudgetYaml(SHIPPED_WORK_BUDGET_SNIPPET);
}

/** @deprecated use shipped yaml defaults until host init delivers workBudget */
export const CONSERVATIVE_MARBLE_WORK_BUDGET = parseMarbleWorkBudgetYaml(SHIPPED_WORK_BUDGET_SNIPPET);
