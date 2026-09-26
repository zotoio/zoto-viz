#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dirname, "..");
const SIDE_DIR = join(ROOT, "revert-proofs/52");

function escapeRegex(s) {
  return s.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function listTests(testFileRel) {
  const r = spawnSync("pnpm", ["exec", "vitest", "list", testFileRel], {
    cwd: join(ROOT, "web"),
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`vitest list failed for ${testFileRel}: ${r.stderr}`);
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(" > ");
      return idx < 0 ? line : line.slice(idx + 3);
    });
}

function unanchor(s) {
  if (s.startsWith("^") && s.endsWith("$")) return s.slice(1, -1).replace(/\\(.)/g, "$1");
  return s;
}

function resolveFullName(names, partial) {
  const p = unanchor(partial);
  if (names.includes(p)) return p;
  const byEnd = names.filter((n) => n.endsWith(` > ${p}`) || n === p);
  if (byEnd.length === 1) return byEnd[0];
  const byInclude = names.filter((n) => n.includes(p));
  if (byInclude.length === 1) return byInclude[0];
  throw new Error(`ambiguous (${byInclude.length || byEnd.length}) for "${p}" in:\n${(byInclude.length ? byInclude : byEnd).join("\n")}`);
}

function verifyRunsOne(testFileRel, anchored) {
  const r = spawnSync("pnpm", ["exec", "vitest", "run", testFileRel, "-t", anchored], {
    cwd: join(ROOT, "web"),
    encoding: "utf8",
  });
  const m = r.stdout.match(/Tests\s+(\d+) passed(?:\s+\|\s+(\d+) skipped)?/);
  if (!m) throw new Error(`no test summary for ${testFileRel} -t ${anchored}\n${r.stdout}`);
  if (Number(m[1]) !== 1) throw new Error(`expected 1 passed, got ${m[1]} for ${testFileRel}`);
}

const files = readdirSync(SIDE_DIR).filter((f) => f.endsWith(".json"));
for (const f of files) {
  const path = join(SIDE_DIR, f);
  const doc = JSON.parse(readFileSync(path, "utf8"));
  if (!doc.testFile) continue;
  const rel = doc.testFile.replace(/^web\//, "");
  const names = listTests(rel);
  const full = resolveFullName(names, doc.testName);
  const anchored = `^${escapeRegex(full)}$`;
  verifyRunsOne(rel, anchored);
  doc.testName = anchored;
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`ok ${f}`);
}
console.log(`Updated ${files.length} sidecars`);
