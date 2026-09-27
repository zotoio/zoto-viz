#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanPackDirectory } from "../../plugins/sdk/pack-lint";

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
if (violations.length === 0) {
  process.exit(0);
}
for (const v of violations) {
  const loc = v.line != null ? `${v.file}:${v.line}` : v.file;
  console.log(`${loc} ${v.rule} — ${formatViolationMessage(v)}`);
}
process.exit(1);
