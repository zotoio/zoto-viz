/**
 * Test-only pack lint helpers (baseline guard, full-tree scan, fixture lint).
 */

import fs from "node:fs";
import path from "node:path";
import { legacyZotoViolationsOnDisallowedPacks } from "./legacy-zoto-pack-allowlist";
import { hostTransportViolations, lintPackSource, scanPluginsSrc } from "./pack-lint";
import { scanWebSrc } from "./pack-lint-host";
import type { PackLintBaseline, PackLintRule, PackLintViolation } from "./pack-lint-types";
import { violationKey } from "./pack-lint-types";

const SDK_ROOT = "plugins/sdk";

const SDK_SKIP_DIRS = new Set([
  "pack-lint-fixtures",
  "host-lint-fixtures",
  "pack-bundle-fixtures",
  "fixtures",
  "starter-regression",
]);

function listSdkModuleTsFiles(sdkRoot: string, rel = ""): string[] {
  const dir = path.join(sdkRoot, rel);
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SDK_SKIP_DIRS.has(ent.name)) continue;
    const sub = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (sub === "starter") {
        out.push(...listSdkModuleTsFiles(sdkRoot, `${sub}/frontend`));
        continue;
      }
      out.push(...listSdkModuleTsFiles(sdkRoot, sub));
      continue;
    }
    if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts") && !ent.name.endsWith(".test.ts")) {
      out.push(sub);
    }
  }
  return out;
}

function scanSdkGuardrails(repoRoot: string): PackLintViolation[] {
  const sdkRoot = path.join(repoRoot, SDK_ROOT);
  const violations: PackLintViolation[] = [];
  for (const rel of listSdkModuleTsFiles(sdkRoot)) {
    const repoRel = `${SDK_ROOT}/${rel}`.replace(/\\/g, "/");
    const abs = path.join(sdkRoot, rel);
    const text = fs.readFileSync(abs, "utf8");
    violations.push(...hostTransportViolations(repoRel, text));
  }
  return violations;
}

export function scanAllGuardrails(repoRoot: string): PackLintViolation[] {
  const merged = [...scanPluginsSrc(repoRoot), ...scanSdkGuardrails(repoRoot), ...scanWebSrc(repoRoot)];
  merged.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.rule !== b.rule) return a.rule.localeCompare(b.rule);
    return a.target.localeCompare(b.target);
  });
  return merged;
}

export function scanPackLintFixture(
  repoRel: string,
  text: string,
  packId: string,
  repoRoot: string,
  importerFileAbs?: string,
): PackLintViolation[] {
  const m = repoRel.match(/^(plugins\/(?:src|sdk)\/[^/]+)/);
  const packRepoPrefix = m?.[1] ?? `plugins/src/${packId}`;
  const importerDirAbs = path.join(repoRoot, path.dirname(repoRel));
  const packRootAbs = path.join(repoRoot, packRepoPrefix);
  const packDirAbs = fs.existsSync(packRootAbs) ? packRootAbs : undefined;
  return lintPackSource(repoRel, text, packRepoPrefix, repoRoot, importerDirAbs, packDirAbs);
}

export function loadBaseline(repoRoot: string): PackLintBaseline {
  const p = path.join(repoRoot, SDK_ROOT, "pack-lint-baseline.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as PackLintBaseline;
}

export function assertBaselineGuard(
  current: PackLintViolation[],
  baseline: PackLintBaseline,
): {
  newViolations: PackLintViolation[];
  staleViolations: PackLintViolation[];
  disallowedLegacyZoto: PackLintViolation[];
  ok: boolean;
} {
  const disallowedLegacyZoto = legacyZotoViolationsOnDisallowedPacks(current);
  const baseSet = new Set(baseline.violations.map(violationKey));
  const curSet = new Set(current.map(violationKey));
  const newViolations = current.filter((v) => !baseSet.has(violationKey(v)));
  const staleViolations = baseline.violations.filter((v) => !curSet.has(violationKey(v)));
  return {
    newViolations,
    staleViolations,
    disallowedLegacyZoto,
    ok:
      disallowedLegacyZoto.length === 0 &&
      newViolations.length === 0 &&
      staleViolations.length === 0,
  };
}

export function baselineCountsByPack(
  baseline: PackLintBaseline,
): Record<string, Partial<Record<PackLintRule, number>>> {
  const out: Record<string, Partial<Record<PackLintRule, number>>> = {};
  for (const v of baseline.violations) {
    const m = v.file.match(/^plugins\/src\/([^/]+)\//);
    if (!m) continue;
    const pack = m[1]!;
    out[pack] ??= {};
    out[pack][v.rule] = (out[pack][v.rule] ?? 0) + 1;
  }
  return out;
}

export function baselineCountsByRule(baseline: PackLintBaseline): Partial<Record<PackLintRule, number>> {
  const out: Partial<Record<PackLintRule, number>> = {};
  for (const v of baseline.violations) {
    out[v.rule] = (out[v.rule] ?? 0) + 1;
  }
  return out;
}
