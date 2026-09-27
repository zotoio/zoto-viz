#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanPackInstallLint } from "../../plugins/sdk/pack-lint";
import { formatViolationMessage } from "../../plugins/sdk/pack-lint-hints";

const packHome = process.argv[2];
const repoRootArg = process.argv[3];
if (!packHome || !repoRootArg) {
  console.error("usage: pack-install-lint-run.ts <packHomeAbs> <repoRootAbs>");
  process.exit(2);
}

const repoRoot = path.resolve(repoRootArg);
const packDirAbs = path.resolve(packHome);
const { blocks, warnings } = scanPackInstallLint(packDirAbs, repoRoot);

for (const v of blocks) {
  const loc = v.line != null ? `${v.file}:${v.line}` : v.file;
  console.error(`${loc} ${v.rule} — ${formatViolationMessage(v)}`);
}
if (blocks.length > 0) {
  process.exit(1);
}
for (const v of warnings) {
  const loc = v.line != null ? `${v.file}:${v.line}` : v.file;
  console.warn(`${loc} ${v.rule} — ${formatViolationMessage(v)}`);
}
process.exit(0);
