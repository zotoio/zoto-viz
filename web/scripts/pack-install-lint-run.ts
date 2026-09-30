#!/usr/bin/env node
import path from "node:path";
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

if (blocks.length > 0) {
  const lines: string[] = [];
  for (const v of blocks) {
    const loc = v.line != null ? `${v.file}:${v.line}` : v.file;
    const line = `${loc} ${v.rule} — ${formatViolationMessage(v)}`;
    lines.push(line);
    console.error(line);
  }
  console.error(
    JSON.stringify({
      type: "pack-install-lint-block",
      message: lines.join(" "),
    }),
  );
  process.exit(1);
}
for (const v of warnings) {
  const loc = v.line != null ? `${v.file}:${v.line}` : v.file;
  console.warn(`${loc} ${v.rule} — ${formatViolationMessage(v)}`);
}
// #185: bundle-pack-entry.mjs installs only on this explicit verdict (exit 0 alone is not a pass).
process.stdout.write(`${JSON.stringify({ type: "pack-install-lint-pass" })}\n`);
process.exit(0);
