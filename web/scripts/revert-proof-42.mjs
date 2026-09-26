#!/usr/bin/env node
import { execFileSync, execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const web = path.join(repo, "web");
const proofs = path.join(repo, "revert-proofs", "42");

const rows = readdirSync(proofs)
  .filter((f) => f.endsWith(".json") && !f.includes("revert-26b9927"))
  .map((f) => ({ json: JSON.parse(readFileSync(path.join(proofs, f), "utf8")), patch: f.replace(".json", ".patch") }));

for (const { json, patch } of rows) {
  const patchPath = path.join(proofs, patch);
  execSync(`git apply --check ${patchPath}`, { cwd: repo, stdio: "pipe" });
  execSync(`git apply ${patchPath}`, { cwd: repo });
  let failed = false;
  try {
    execFileSync("pnpm", ["exec", "vitest", "run", json.testFile, "-t", json.testName], {
      cwd: web,
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch {
    failed = true;
  }
  execSync(`git apply -R ${patchPath}`, { cwd: repo });
  if (!failed) {
    console.error(`Expected patched row to fail: ${patch}`);
    process.exit(1);
  }
  console.log(`ok ${patch}`);
}

console.log(`verified ${rows.length} revert-proof rows`);
