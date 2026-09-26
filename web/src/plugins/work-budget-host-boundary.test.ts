import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HOST_WORK_BUDGET_FILES = [
  "host.ts",
  "manifest-work-budget-host.ts",
  "plugin.ts",
  "plugin-visualisation.ts",
  "plugin-ui.ts",
  "sdk.ts",
  "work-budget-policy.ts",
].map((name) => resolve(import.meta.dirname, name));

describe("workBudget host boundary (#45c row vi)", () => {
  it("workBudget host modules do not import plugins/src pack sources", () => {
    const offenders: string[] = [];
    const pattern = /from\s+["'].*plugins\/src\//;
    for (const file of HOST_WORK_BUDGET_FILES) {
      const text = readFileSync(file, "utf-8");
      if (pattern.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
