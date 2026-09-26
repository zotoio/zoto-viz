#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dirname, "..");
const SIDE_DIR = join(ROOT, "revert-proofs/52");

function verifyRunsOne(testFileRel, anchored) {
  const r = spawnSync("pnpm", ["exec", "vitest", "run", testFileRel, "-t", anchored], {
    cwd: join(ROOT, "web"),
    encoding: "utf8",
  });
  const m = r.stdout.match(/Tests\s+(\d+) passed(?:\s+\|\s+(\d+) skipped)?/);
  if (!m || Number(m[1]) !== 1) {
    console.error(`FAIL ${testFileRel} -t ${anchored}\n${r.stdout}`);
    return false;
  }
  return true;
}

let fail = 0;
for (const f of readdirSync(SIDE_DIR).filter((x) => x.endsWith(".json"))) {
  const doc = JSON.parse(readFileSync(join(SIDE_DIR, f), "utf8"));
  if (!doc.testFile || !doc.testName) continue;
  const rel = doc.testFile.replace(/^web\//, "");
  const t = doc.testName;
  if (!t.startsWith("^") || !t.endsWith("$")) {
    console.error(`${f}: testName not anchored`);
    fail++;
    continue;
  }
  if (!verifyRunsOne(rel, t)) fail++;
}
if (fail) process.exit(1);
console.log("All sidecar -t filters run exactly 1 test");
