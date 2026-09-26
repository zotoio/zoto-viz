#!/usr/bin/env node
/**
 * Viz dogfood runner for CI — deterministic count/work budgets (no wall-clock).
 * Set ZOTO_VIZ_PERF=1 or use `pnpm dogfood:perf` for local p50/p95 timing soak.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const perf = process.env.ZOTO_VIZ_PERF === "1";
const testName = perf ? "fat-LAN live soak" : "fat-LAN count gate";
const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "src/plugins/dogfood.test.ts", "-t", testName],
  { cwd: webRoot, stdio: "inherit", env: { ...process.env, FORCE_COLOR: "1" } },
);
process.exit(result.status ?? 1);
