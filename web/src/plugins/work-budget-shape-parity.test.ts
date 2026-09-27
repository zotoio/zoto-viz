import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clampManifestWorkBudgetToCeilings,
  MANIFEST_WORK_BUDGET_KEYS,
  parseManifestWorkBudgetShape,
} from "../../../plugins/sdk/manifest-work-budget";
import { assertWorkBudgetOverHostCeiling, hostWorkBudgetCeilings } from "./work-budget-policy";

const REPO = resolve(import.meta.dirname, "../../..");
const SCHEMA_PATH = join(REPO, "plugins/sdk/manifest-work-budget.schema.json");

function baseBudget() {
  return { ...hostWorkBudgetCeilings() };
}

describe("workBudget shape parity (TS)", () => {
  it("schema required keys match MANIFEST_WORK_BUDGET_KEYS", () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8")) as { required: string[] };
    expect([...MANIFEST_WORK_BUDGET_KEYS]).toEqual(schema.required);
  });

  const cases: { label: string; raw: unknown; ok: boolean }[] = [
    { label: "valid", raw: baseBudget(), ok: true },
    { label: "bool", raw: { ...baseBudget(), maxDrawCalls: true }, ok: false },
    { label: "float", raw: { ...baseBudget(), maxDrawCalls: 5.5 }, ok: false },
    { label: "string", raw: { ...baseBudget(), maxDrawCalls: "5" }, ok: false },
    { label: "null root", raw: null, ok: false },
    { label: "nan", raw: { ...baseBudget(), maxDrawCalls: Number.NaN }, ok: false },
    { label: "inf", raw: { ...baseBudget(), maxDrawCalls: Number.POSITIVE_INFINITY }, ok: false },
    { label: "fraction", raw: { ...baseBudget(), maxTriangles: 1.5 }, ok: false },
    { label: "neg zero", raw: { ...baseBudget(), maxDrawCalls: -0 }, ok: true },
    { label: "extra key", raw: { ...baseBudget(), extraKey: 1 }, ok: false },
    {
      label: "missing key",
      raw: Object.fromEntries(
        Object.entries(baseBudget()).filter(([k]) => k !== "maxPacketsPerFrame"),
      ),
      ok: false,
    },
  ];

  for (const { label, raw, ok } of cases) {
    it(`parse shape: ${label}`, () => {
      if (ok) {
        expect(() => parseManifestWorkBudgetShape(raw)).not.toThrow();
      } else {
        expect(() => parseManifestWorkBudgetShape(raw)).toThrow();
      }
    });
  }

  for (const key of MANIFEST_WORK_BUDGET_KEYS) {
    for (const delta of [-1, 0, 1] as const) {
      it(`per-ceiling grid ${key} ${delta >= 0 ? "+" : ""}${delta}`, () => {
        const ceilings = hostWorkBudgetCeilings();
        const value = ceilings[key] + delta;
        if (value < 0) return;
        const budget = { ...baseBudget(), [key]: value };
        parseManifestWorkBudgetShape(budget);
        const clamped = clampManifestWorkBudgetToCeilings(budget, ceilings);
        expect(clamped[key]).toBe(Math.min(value, ceilings[key]));
        if (delta <= 0) {
          expect(() => assertWorkBudgetOverHostCeiling(budget)).not.toThrow();
        } else {
          expect(() => assertWorkBudgetOverHostCeiling(budget)).toThrow();
        }
      });
    }
  }

  it("clamp maps non-finite to zero like Python runtime_work_budget_int", () => {
    const ceilings = hostWorkBudgetCeilings();
    const clamped = clampManifestWorkBudgetToCeilings(
      { ...baseBudget(), maxDrawCalls: Number.NaN },
      ceilings,
    );
    expect(clamped.maxDrawCalls).toBe(0);
  });
});
