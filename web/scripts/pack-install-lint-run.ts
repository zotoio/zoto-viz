#!/usr/bin/env node
import path from "node:path";
import { scanPackInstallLint } from "../../plugins/sdk/pack-lint";
import { formatViolationMessage } from "../../plugins/sdk/pack-lint-hints";

const packHome = process.argv[2];
const repoRootArg = process.argv[3];
const packIdArg = process.argv[4];
const nonce = process.argv[5];
if (!packHome || !repoRootArg || !packIdArg || !nonce) {
  console.error("usage: pack-install-lint-run.ts <packHomeAbs> <repoRootAbs> <packId> <nonce>");
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
// #185: bundle-pack-entry.mjs installs only on this explicit verdict, bound to its per-run nonce and
// the pack id, as the LAST stdout line (exit 0 alone is not a pass). Nothing may be printed after it.
process.stdout.write(`${JSON.stringify({ type: "pack-install-lint-pass", nonce, pack: packIdArg })}\n`);
process.exit(0);
