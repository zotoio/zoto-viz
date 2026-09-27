#!/usr/bin/env node
import { writeFileSync as wfs } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const base = "6520b014472c05f831ac5204429be2affb8473cb";
const files = ["web/src/ui/media-ask.ts", "web/src/style.css"];

function sh(args, opts = {}) {
  return execFileSync(args[0], args.slice(1), { cwd: root, encoding: "utf8", ...opts });
}

function parseHunks(file) {
  const diff = sh(["git", "diff", "-U0", base, "HEAD", "--", file]);
  const hunks = [];
  const lines = diff.split("\n");
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith("@@")) {
      i += 1;
      continue;
    }
    const header = lines[i];
    i += 1;
    const chunk = [header];
    while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff ")) {
      chunk.push(lines[i]);
      i += 1;
    }
    hunks.push({ file, header, chunk });
  }
  return hunks;
}

const all = files.flatMap(parseHunks);
const results = [];

for (let hi = 0; hi < all.length; hi += 1) {
  const { file, header, chunk } = all[hi];
  const ts = sh(["git", "show", `HEAD:${file}`]);
  const lines = ts.split("\n");
  const m = header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  const newStart = Number(m[3]);
  const removed = chunk.slice(1).filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
  let idx = newStart - 1;
  const out = [...lines];
  for (const r of removed) {
    while (idx < out.length && out[idx] !== r) idx += 1;
    if (idx < out.length) out.splice(idx, 1);
  }
  wfs(path.join(root, file), out.join("\n"));
  let vitest = "";
  try {
    vitest = execFileSync("pnpm", ["exec", "vitest", "run"], { cwd: path.join(root, "web"), encoding: "utf8" });
  } catch (e) {
    vitest = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  sh(["git", "checkout", "HEAD", "--", file]);
  const failed = vitest.match(/Tests\s+(\d+) failed/);
  const fails = [...new Set(vitest.match(/FAIL\s+[^\n]+/g) ?? [])].slice(0, 8);
  results.push({
    hunk: hi + 1,
    file,
    header,
    status: failed ? "CAUGHT" : "SURVIVED",
    failedCount: failed?.[1] ?? "0",
    fails,
  });
  process.stderr.write(`${hi + 1} ${results.at(-1).status}\n`);
}

wfs("/opt/cursor/artifacts/sweep-113.json", JSON.stringify(results, null, 2));
const survivors = results.filter((r) => r.status === "SURVIVED");
wfs("/opt/cursor/artifacts/sweep-113-survivors.txt", survivors.map((s) => `${s.hunk}\t${s.file}\t${s.header}`).join("\n"));
