#!/usr/bin/env node
import path from "node:path";
import { scanPackInstallLint } from "../../plugins/sdk/pack-lint";
import { formatViolationMessage } from "../../plugins/sdk/pack-lint-hints";

const packHome = path.resolve(process.argv[2] ?? "");
const repoRoot = path.resolve(process.argv[3] ?? "");
if (!packHome || !repoRoot) {
  console.error("usage: pack-install-lint-run.ts <packHomeAbs> <repoRootAbs>");
  process.exit(2);
}

const { blocks, warnings } = scanPackInstallLint(packHome, repoRoot);
for (const w of warnings) {
  console.error(
    JSON.stringify({
      type: "pack-install-lint-warn",
      rule: w.rule,
      message: formatViolationMessage(w),
    }),
  );
}
if (blocks.length > 0) {
  console.error(
    JSON.stringify({
      type: "pack-install-lint-block",
      rule: blocks[0].rule,
      message: formatViolationMessage(blocks[0]),
    }),
  );
  process.exit(1);
}
process.exit(0);
