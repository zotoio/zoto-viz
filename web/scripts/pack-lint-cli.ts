#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertBaselineGuard, loadBaseline, scanPackDirectory, violationKey } from "../../plugins/sdk/pack-lint";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packArg = process.argv[2];
if (!packArg) {
  console.error("usage: pnpm pack-lint <packDir>  (e.g. plugins/src/my-pack or plugins/sdk/starter)");
  process.exit(2);
}

const abs = path.isAbsolute(packArg) ? packArg : path.resolve(process.cwd(), packArg);
let opts: { packId?: string; repoPathPrefix?: string } = {};
const rel = path.relative(repoRoot, abs).replace(/\\/g, "/");
if (rel.startsWith("plugins/sdk/starter")) {
  const yml = readFileSync(path.join(abs, "plugin.yml"), "utf8");
  const id = yml.match(/^id:\s*(\S+)/m)?.[1];
  opts = { packId: id ?? "pack-starter-template", repoPathPrefix: "plugins/sdk/starter" };
}

const { formatViolationMessage } = await import("../../plugins/sdk/pack-lint-hints");
const violations = scanPackDirectory(abs, repoRoot, opts);
// #207: apply the checked-in baseline (plugins/sdk/pack-lint-baseline.json) the way the CI guard in
// pack-lint.test.ts does. Baselined rows are reported; only new violations (and the never-baselined
// guards: off-allowlist legacy zoto, host → plugins/src, blocking uniform rules) fail.
const guard = assertBaselineGuard(violations, loadBaseline(repoRoot));
const failing = new Set(
  [
    ...guard.newViolations,
    ...guard.disallowedLegacyZoto,
    ...guard.disallowedHostPackSrc,
    ...guard.disallowedUniformBlocking,
  ].map(violationKey),
);
let newCount = 0;
for (const v of violations) {
  const isNew = failing.has(violationKey(v));
  if (isNew) newCount += 1;
  const loc = v.line != null ? `${v.file}:${v.line}` : v.file;
  console.log(`${loc} ${v.rule} — ${formatViolationMessage(v)}${isNew ? "" : " (baselined)"}`);
}
console.log(`pack-lint: ${newCount} new, ${violations.length - newCount} baselined (plugins/sdk/pack-lint-baseline.json)`);
process.exit(newCount > 0 ? 1 : 0);
